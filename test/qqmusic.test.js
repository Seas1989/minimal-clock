/* ---------- test/qqmusic.test.js：QQ 音乐代理的解析与平台配置测试 ----------
 * 跑法：node test/qqmusic.test.js
 * 与网易云那份一样刻意不碰真实网络：QQ 音乐的 vkey 规则随时会改，联网断言等于埋一个必红的雷。
 * 覆盖两块：
 *   1. 纯解析：搜索字段映射（songmid / singer[] / interval 秒→毫秒 / pay.payplay→free）、
 *      直链拼接（sip + purl）、免费优先排序、去重
 *   2. HTTP：/api/qq/* 的参数校验与鉴权，以及 /api/music/config 里“换平台”那套状态迁移
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const qq = require('../lib/qqmusic')

const PORT = 3715
const DATA = path.join(os.tmpdir(), `clock-qq-test-${process.pid}`)
const SERVER = path.join(__dirname, '..', 'server.js')
const PASS = 'test-pass-1234'

let passed = 0
let failed = 0
function ok(cond, label) {
  if (cond) { passed++; console.log(`  OK   ${label}`) }
  else { failed++; console.log(`  FAIL ${label}`) }
}

function api(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) } },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(raw || '{}'), raw }) }
          catch { resolve({ status: res.statusCode, json: null, raw }) }
        })
      }
    )
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function startServer() {
  return new Promise((resolve, reject) => {
    const lines = []
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const onData = (buf) => { lines.push(String(buf)); if (String(buf).includes('时钟已启动')) resolve({ child, lines }) }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    setTimeout(() => reject(new Error('启动超时：' + lines.join(''))), 8000).unref()
  })
}
const reg = async (name) => (await api('POST', '/api/register', { username: name, password: PASS })).json.token

/* 搜索结果的一条：真实字段名（songmid / songname / singer[] / interval 秒 / pay.payplay） */
const ROW = {
  songmid: '003NXnKE1PW5kE',
  songname: '轻音乐纯音乐',
  singer: [{ name: '钢琴曲' }, { name: '治愈系' }],
  albumname: '舒缓钢琴',
  albummid: '002s1sjg0lZI5O',
  interval: 192,
  pay: { payplay: 0 },
}

;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })

  console.log('1) 纯解析（喂假 JSON，不联网）')
  const t = qq.normalizeTrack(ROW)
  ok(t && t.id === '003NXnKE1PW5kE' && t.name === '轻音乐纯音乐', 'songmid 当 id、songname 当曲名')
  ok(t.artists === '钢琴曲 / 治愈系' && t.album === '舒缓钢琴', '两个歌手用 / 连（与网易云那侧同一个显示格式）')
  ok(t.duration === 192000, 'interval 是秒，转成毫秒才能让前端算进度')
  ok(t.free === true && qq.normalizeTrack({ ...ROW, pay: { payplay: 1 } }).free === false, 'pay.payplay 翻成 free（实测它决定能不能拿到地址）')
  ok(t.cover.startsWith('https://y.gtimg.cn/') && t.cover.includes('002s1sjg0lZI5O'), '封面按 albummid 拼出来')
  ok(qq.normalizeTrack({ songname: '没有 mid' }) === null, '缺 songmid 的记录丢掉')
  ok(qq.normalizeTrack({ ...ROW, singer: { name: '单人' } }).artists === '单人', 'singer 不是数组时也吃得下')
  ok(qq.normalizeTrack({ ...ROW, interval: undefined }).duration === 0, '没有时长不会写成 NaN')

  ok(qisMidOK(), 'songmid 形状校验：14 位字母数字收，太短或带符号不收')
  const sr = qq.parseSearch({ data: { song: { list: [ROW, { ...ROW, songmid: '000bGesT43dj5L' }, { songname: '残' }] } } })
  ok(sr.length === 2 && sr[1].id === '000bGesT43dj5L', '搜索取 data.song.list，残记录不进列表')
  ok(qq.parseSearch({}).length === 0 && qq.parseSearch(null).length === 0, '接口空返回不会崩')

  console.log('2) 播放地址（喂 CgiGetVkey 的返回）')
  const VK = {
    req_0: {
      data: {
        sip: ['http://aqqmusic.tc.qq.com/', 'http://sjy6.stream.qqmusic.qq.com/'],
        midurlinfo: [
          { songmid: '003NXnKE1PW5kE', filename: 'C400003NXnKE1PW5kE.m4a', purl: 'C400003NXnKE1PW5kE.m4a?guid=1&vkey=ABC123&uin=&fromtag=1' },
          { songmid: '000bGesT43dj5L', filename: 'C400000bGesT43dj5L.m4a', purl: '' },
        ],
      },
    },
  }
  const good = qq.parseVkey(VK, '003NXnKE1PW5kE')
  ok(good.url.startsWith('https://aqqmusic.tc.qq.com/') && good.url.includes('vkey=ABC123'), 'sip 给的 http 域名升 https，purl 原样接上（它自带 vkey）')
  ok(good.reason === '' && good.filename === 'C400003NXnKE1PW5kE.m4a', '拿到地址时不写原因')
  const paid = qq.parseVkey(VK, '000bGesT43dj5L')
  ok(paid.url === '' && paid.reason.includes('会员'), `付费歌 purl 为空时说清原因（${paid.reason}）`)
  ok(qq.parseVkey({}, '003NXnKE1PW5kE').url === '', '整个 midurlinfo 都没了也返回空地址，不抛')
  ok(qq.parseVkey(VK, '不存在').url.startsWith('https://'), '按 songmid 找，找不到时退回第一条而不是报错')

  console.log('3) 排序与去重')
  const mixed = [{ id: 'a', free: false }, { id: 'b', free: true }, { id: 'c', free: false }, { id: 'd', free: true }]
  const sorted = qq.sortByPlayable(mixed)
  ok(sorted[0].id === 'b' && sorted[1].id === 'd', '免费歌排前面，且原有相对顺序不乱（稳定排序才敢直接给用户看）')
  ok(sorted[2].id === 'a' && sorted[3].id === 'c', '要会员的排在后面，而不是被丢掉——用户得知道搜索结果里有这些')
  ok(mixed.length === 4 && mixed[0].id === 'a', '排序不改动原数组')
  ok(qq.dedupe([{ id: 'a' }, { id: 'a' }, { id: 'b' }]).length === 2, '同 songmid 只留一条（翻唱与同名纯音乐在搜索里反复出现）')
  ok(qq.rotate([1, 2, 3, 4], 6).join('') === '3412' && qq.rotate([], 5).length === 0, 'offset 取模与空列表（与网易云那侧同一套语义）')

  console.log('4) 攒内置轻音乐（把 search 换成假的，不联网）')
  const fake = async (word) => [
    { id: 'x' + word, name: word, free: true },
    { id: 'y' + word, name: word + '（会员）', free: false },
    { id: 'x' + word, name: word + ' 重复', free: true }, // 同一个 mid 再来一次
  ]
  const lq = await qq.lightQueue({ limit: 4 }, fake)
  ok(lq.tracks.length === 3 && lq.tracks.every((x) => x.free), `只把免费曲目攒进队列（${lq.tracks.length} 首，全是 free）`)
  ok(new Set(lq.tracks.map((x) => x.id)).size === lq.tracks.length, '跨关键词也去重')
  ok(lq.kind === 'light' && lq.name.includes('QQ'), '形状与网易云那侧一致，前端不用区分')
  const noLight = await qq.lightQueue({ limit: 4 }, async () => [{ id: 'z1', name: '全是会员', free: false }]).catch((e) => e.message)
  ok(typeof noLight === 'string' && noLight.includes('免费'), `一首免费都搜不到时报出原因（${noLight}）`)
  const badSource = await qq.buildQueue({ kind: 'playlist' }, { limit: 4 }).catch((e) => e.message)
  ok(typeof badSource === 'string' && badSource.includes('歌单'), `QQ 音乐收到歌单类来源时直接说明白（${badSource}）`)

  console.log('5) 路由与平台配置（不联网）')
  const s = await startServer()
  ok((await api('GET', '/api/qq/search?q=abc')).status === 401, '搜索要登录本应用（免得本机沦为公开代理）')
  ok((await api('GET', '/api/qq/url?id=003NXnKE1PW5kE')).status === 401, '取地址同样要登录')
  ok((await api('GET', '/api/qq/queue')).status === 401, '拉队列也要登录')
  const mine = await reg('QQ甲')
  ok((await api('GET', '/api/qq/search?q=' + encodeURIComponent('x'.repeat(61)), null, mine)).status === 400, '搜索词超长被挡住')
  ok((await api('GET', '/api/qq/url?id=' + encodeURIComponent('短'), null, mine)).status === 400, '坏 songmid 拦在门口，不发远端请求')
  ok((await api('GET', '/api/qq/playlist', null, mine)).status === 404, 'QQ 这边没有歌单路由（接口在无登录态下读不到）')
  ok((await api('GET', '/api/qq/playlists', null, mine)).status === 404, '也没有「我的歌单」路由')
  ok((await api('GET', '/api/netease/config', null, mine)).status === 404, '配置改到 /api/music/config 后，旧路径不再接（两个平台共用一条记录）')

  let cfg = (await api('GET', '/api/music/config', null, mine)).json
  ok(cfg.platform === 'netease' && cfg.source.kind === 'light', `新账号默认网易云 + 轻音乐（${cfg.platform}/${cfg.source.kind}）`)

  // 先设成网易云的“我的歌单”，再切到 QQ：来源必须复位，否则休息时拿着 mine 去敲 QQ 的接口
  await api('POST', '/api/music/config', { kind: 'mine' }, mine)
  cfg = (await api('POST', '/api/music/config', { platform: 'qq' }, mine)).json
  ok(cfg.platform === 'qq' && cfg.source.kind === 'light', `切平台时来源复位成轻音乐（${cfg.source.kind}）`)
  cfg = (await api('POST', '/api/music/config', { kind: 'mine' }, mine)).json
  ok(cfg.source.kind === 'light', 'QQ 平台下「我的歌单」被服务端挡回轻音乐，不留下一个必然失败的状态')
  cfg = (await api('POST', '/api/music/config', { platform: 'bogus' }, mine)).json
  ok(cfg.platform === 'netease', '非法平台名回落到网易云')
  /* 坏 MUSIC_U 与切平台写在同一个请求里：必须整笔不生效。
   * 内存里那条记录会被下一次请求顺手提盘，留下半截状态比返错更难查 */
  ok((await api('POST', '/api/music/config', { platform: 'qq', musicU: 'short' }, mine)).status === 400, 'MUSIC_U 坏串时先挡住，平台也不许偷偷改掉')
  cfg = (await api('GET', '/api/music/config', null, mine)).json
  ok(cfg.platform === 'netease' && cfg.hasCookie === false, '那个 400 没留下半截状态')
  cfg = (await api('POST', '/api/music/config', { platform: 'qq' }, mine)).json
  ok(cfg.platform === 'qq', '再切回 QQ 音乐')

  const other = await reg('QQ乙')
  cfg = (await api('GET', '/api/music/config', null, other)).json
  ok(cfg.platform === 'netease', '平台选择按用户隔离，乙不受甲的影响')

  const rows = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'))
  ok(rows.some((r) => r.platform === 'qq') && rows.some((r) => r.platform === 'netease'), 'platform 落盘，重启后还是原来那个平台')
  ok(s.lines.join('').includes('settings.json'), '启动自检里报得出 settings.json')

  await new Promise((res) => { s.child.on('exit', res); s.child.kill() })
  fs.rmSync(DATA, { recursive: true, force: true })
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('测试异常：', e.message)
  process.exit(1)
})

// songmid 的形状校验：14 位收，太短 / 带符号不收
function qisMidOK() {
  return qq.isMid('003NXnKE1PW5kE') && qq.isMid('000bGesT43dj5L') && !qq.isMid('abc') && !qq.isMid('带中文的名字') && !qq.isMid('') && !qq.isMid(null)
}
