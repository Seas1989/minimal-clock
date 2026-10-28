/* ---------- test/netease.test.js：网易云代理的解析与配置测试 ----------
 * 跑法：node test/netease.test.js
 * 刻意不碰真实网络：网易云接口随时会改版或限流，把它写进断言里等于埋一个每次都要红的雷。
 * 覆盖两块能确定的东西：
 *   1. 纯解析：字段兼容（ar/al 与 artists/album）、地址升级、付费原因、队列环形取数
 *   2. HTTP 配置：MUSIC_U 只存不打回、歌单链接提取 ID、按用户隔离、非法输入挡住
 * 配置路由是 /api/music/config（网易云与 QQ 音乐共用同一条记录）
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ne = require('../lib/music/netease')

const PORT = 3713
const DATA = path.join(os.tmpdir(), `clock-netease-test-${process.pid}`)
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

;(async () => {
  fs.rmSync(DATA, { recursive: true, force: true })

  console.log('1) 纯解析（喂假 JSON，不联网）')
  // 网页端两处字段名不一致：搜索给 artists/album，批量详情给 ar/al
  const a = ne.normalizeTrack({ id: 1001, name: 'Rain', artists: [{ name: 'X' }], album: { name: 'A1', picUrl: 'http://p1.music.126.net/a.jpg' }, duration: 200000, fee: 0 })
  const b = ne.normalizeTrack({ id: 1002, name: 'Snow', ar: [{ name: 'Y' }, { name: 'Z' }], al: { name: 'A2', picUrl: 'https://p2.music.126.net/b.jpg' }, dt: 300000, fee: 8 })
  ok(a.artists === 'X' && a.album === 'A1' && a.duration === 200000, 'artists / album / duration 一路（搜索接口）')
  ok(b.artists === 'Y / Z' && b.cover === 'https://p2.music.126.net/b.jpg' && b.duration === 300000, 'ar / al / dt 一路（批量详情接口），两歌手用 / 连')
  ok(ne.normalizeTrack({ name: '残记录' }) === null && ne.normalizeList([null, { id: 0 }, { id: 5 }]).length === 1, '缺 id 的记录被丢掉而不是渲染出 NaN')
  ok(ne.upgradeHttps('http://m801.music.126.net/x.mp3') === 'https://m801.music.126.net/x.mp3', '播放地址升到 https，https 站点下不算混合内容')
  ok(ne.upgradeHttps('') === '' && ne.upgradeHttps(null) === '', '空地址不会抛')

  const search = ne.parseSearch({ result: { songs: [{ id: 1, name: 's', artists: [{ name: 'x' }], album: {}, duration: 1 }] }, code: 200 }, 'song')
  ok(search.length === 1 && search[0].name === 's', '单曲搜索结果取成曲目列表')
  const pls = ne.parseSearch({ result: { playlists: [{ id: 9, name: 'p', coverImgUrl: 'http://c/x', trackCount: 30, creator: { nickname: ' someone ' } }, { name: '没 id' }] } }, 'playlist')
  ok(pls.length === 1 && pls[0].trackCount === 30 && ne.upgradeHttps(pls[0].cover).startsWith('https://'), '歌单搜索结果带曲目数，用于挑“最大的那个”')
  ok(ne.parseSearch({}, 'song').length === 0 && ne.parseSearch(null, 'playlist').length === 0, '接口空返回不会崩')

  const pl = ne.parsePlaylist({ result: { id: 7, name: '轻音乐', coverImgUrl: 'http://c/7', trackCount: 10, tracks: [{ id: 1, name: 't', ar: [{ name: 'x' }], al: {} }] } })
  ok(pl.id === 7 && pl.tracks.length === 1, '老详情接口够用的那部分照常解析')
  const ids = ne.parseTrackIds({ playlist: { trackCount: 3, trackIds: [{ id: 1 }, { id: 2 }, 3] } })
  ok(ids.trackCount === 3 && ids.ids.join(',') === '1,2,3', 'v6 的 trackIds 对象与裸数字两种形态都吃')
  ok(ne.parseSongDetail({ songs: [{ id: 1, ar: [], al: {} }, { name: '缺 id' }] }).length === 1, '批量详情过滤残记录')

  const good = ne.parseUrl({ data: [{ id: 1, url: 'http://m/x.mp3', code: 200, br: 320000, size: 100, level: 'exhigh' }] }, 1)
  ok(good.url === 'https://m/x.mp3' && good.reason === '' && good.level === 'exhigh', '拿到地址时给 https 直链，不写原因')
  const vip = ne.parseUrl({ data: [{ id: 1, url: null, code: -110 }] }, 1)
  ok(vip.url === '' && vip.reason.includes('MUSIC_U'), `未登录取不到地址时说清原因（${vip.reason}）`)
  ok(ne.parseUrl({}, 1).reason !== '', '整条 data 都没了也有兜底原因，不会显示空白')

  ok(ne.extractPlaylistId('https://music.163.com/#/playlist?id=2392709157') === '2392709157', '从网页地址栏提取歌单 ID')
  ok(ne.extractPlaylistId(' 3778678 ') === '3778678', '直接给数字也行')
  ok(ne.extractPlaylistId('随便说点什么') === '', '提取不出来时返回空串，交给路由报 400')

  const U = 'ABCD'.repeat(20) // 真实 MUSIC_U 是千字级 base64
  ok(ne.extractMusicU(`MUSIC_U=${U}; OTHER=1`) === U, '粘整条 Cookie 时只挑 MUSIC_U')
  ok(ne.extractMusicU(U) === U, '只粘值也认')
  ok(ne.extractMusicU('too-short') === '' && ne.extractMusicU('') === '', '长度不合的直接判为无效')

  const list = [1, 2, 3, 4]
  ok(ne.rotate(list, 2).join('') === '3412', '队列从 offset 环形取，换开头不换内容')
  ok(ne.rotate(list, -1).join('') === '4123' && ne.rotate(list, 6).join('') === '3412', 'offset 越界与负数都取模，不数组越界')
  ok(ne.rotate([], 5).length === 0, '空队列不炸')
  const mixed = [{ id: 1, fee: 1 }, { id: 2, fee: 8 }, { id: 3, fee: 0 }, { id: 4, fee: 4 }]
  const noCookie = ne.sortByPlayable(mixed, false)
  ok(noCookie[0].fee === 8 && noCookie[1].fee === 0, '没 cookie 时 fee=8（实测能播）与免费歌排前面')
  ok(!noCookie.some((x, i) => x.fee === 1 && i < 2), 'fee=1 的 VIP 歌沉到底，避免一上手就播放失败')
  ok(ne.sortByPlayable(mixed, true).every((x, i) => x.id === mixed[i].id), '有 cookie 时保持原顺序，不多管闲事')

  console.log('2) 配置接口（不联网）')
  const s = await startServer()
  ok((await api('GET', '/api/music/config')).status === 401, '没登录不给用（免得本机沦为公开代理）')

  const mine = await reg('音乐甲')
  const other = await reg('音乐乙')
  let cfg = (await api('GET', '/api/music/config', null, mine)).json
  ok(cfg.hasCookie === false && cfg.source.kind === 'light', `默认来源是轻音乐（${cfg.source.kind}）`)

  cfg = (await api('POST', '/api/music/config', { kind: 'playlist', value: 'https://music.163.com/#/playlist?id=2392709157', label: '我的轻音乐' }, mine)).json
  ok(cfg.source.value === '2392709157' && cfg.source.label === '我的轻音乐', '粘贴歌单链接后存的是纯 ID')
  ok((await api('POST', '/api/music/config', { kind: 'playlist', value: '这串不是歌单' }, mine)).status === 400, '提取不出 ID 时报 400，不写坏配置')
  cfg = (await api('POST', '/api/music/config', { kind: 'playlist', value: '   ' }, mine)).json
  ok(cfg.source.kind === 'playlist' && cfg.source.value === '', '只切来源、链接还没粘时先收下（拉队列时才提示），不半路卡住用户')
  cfg = (await api('POST', '/api/music/config', { kind: 'bogus' }, mine)).json
  ok(cfg.source.kind === 'light', '非法 kind 回落到轻音乐，不留下没人认识的状态')
  cfg = (await api('POST', '/api/music/config', { kind: 'mine' }, mine)).json
  ok(cfg.source.kind === 'mine' && cfg.source.value === '', '切到「我的歌单」会把残留的歌单 ID 清空')

  const saved = (await api('POST', '/api/music/config', { musicU: `MUSIC_U=${U}; sid=1` }, mine)).json
  ok(saved.hasCookie === true && saved.cookieMask === `${U.slice(0, 6)}…${U.slice(-4)}`, `MUSIC_U 存下并给出打码指纹（${saved.cookieMask}）`)
  ok(!JSON.stringify(saved).includes(U), '响应里搜不到 MUSIC_U 明文')
  ok((await api('POST', '/api/music/config', { musicU: 'short' }, mine)).status === 400, '明显不是 MUSIC_U 的短串被挡住')
  ok((await api('GET', '/api/music/config', null, other)).json.hasCookie === false, '两个账号的配置互相隔离，乙看不到甲的 cookie')

  // 落盘的应该是真值（下次请求要拿它去访问网易云），但不能串到别人的记录上
  const rows = JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'))
  ok(rows.length === 2 && rows.some((r) => r.musicU === U), 'settings.json 里存了原值供服务端使用')
  ok(rows.every((r) => r.user), '每条都绑定用户 id')

  ok((await api('POST', '/api/music/config', { musicU: '' }, mine)).json.hasCookie === false, '空串表示清除')
  ok((await api('GET', '/api/netease/nope', null, mine)).status === 404, '未知子路由 404，不会误命中')
  ok((await api('GET', '/api/music/nope', null, mine)).status === 404, '配置路由也只接 config，多余子路径不命中')

  // 新加的“直接播某个歌单”与搜索的 limit 参数：坏请求要挡在门口，不能打到网易云去
  ok((await api('GET', '/api/netease/playlist', null, mine)).status === 400, '取歌单缺 id 直接 400，不发远端请求')
  ok((await api('GET', '/api/netease/playlist?id=' + encodeURIComponent('这不是歌单'), null, mine)).status === 400, 'id 提取不出来也是 400')
  ok((await api('GET', '/api/netease/playlist?id=123')).status === 401, '取歌单同样要登录本应用')
  ok((await api('GET', '/api/netease/search?q=' + encodeURIComponent('x'.repeat(61)), null, mine)).status === 400, '搜索词超长被挡住')
  ok(s.lines.join('').includes('settings.json'), '启动自检里报得出 settings.json')

  await new Promise((res) => { s.child.on('exit', res); s.child.kill() })
  fs.rmSync(DATA, { recursive: true, force: true })
  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error('测试异常：', e.message)
  process.exit(1)
})
