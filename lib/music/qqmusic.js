/* ---------- lib/music/qqmusic.js：QQ 音乐的只读代理 ----------
 * 只用 node:https，不引第三方 SDK。下面的结论都是拿探测脚本实测出来的（2026-10）：
 *   - 搜索：c.y.qq.com/soso/fcgi-bin/client_search_cp 不需要任何登录态
 *   - 地址：u.y.qq.com/cgi-bin/musicu.fcg 的 vkey.GetVkeyServer / CgiGetVkey，
 *           参数名是 songmid（数组），结果在 req_0.data.midurlinfo[].purl 里，
 *           purl 自带 guid 与 vkey，拼上 sip 给的域名就是能播的直链
 *   - 付费歌的 purl 是空串，且与搜索里的 pay.payplay=1 一一对应 —— 所以只做“免费优先”排序，
 *           不需要（也拿不到）用户的 QQ 音乐 cookie
 *   - 歌单类接口在没有 QQ 音乐登录态时全灭（client_music_search_songlist 回 -3002，
 *           music.playlist.* / playlist.fcg.PlaylistSvc 回 500003），所以这个平台只有单曲，没有歌单
 *
 * 分层与 lib/music/netease.js 一致：parse* 全是纯函数（喂 JSON 就出结果，断网也能单测），
 * 网络只集中在 qqFetch 一处，路由层不碰 http。
 */
const https = require('https')

const SEARCH_HOST = 'c.y.qq.com'
const CGI_HOST = 'u.y.qq.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT = 8000
// 一首歌的 songmid 实测是 14 位字母数字；留出余量，别让接口哪天变成 16 位就把用户挡住
const MID_RE = /^[A-Za-z0-9]{8,20}$/
// 每个进程固定一个 guid：vkey 是按 guid 算的，换来换去只会让地址更容易被判过期
const GUID = String(Math.floor(1e9 + Math.random() * 9e9))

const str = (v) => (v == null ? '' : String(v))

/* ---------- 纯解析 ---------- */

// http 升到 https：部署在 https 下时，http 的音频直链会被浏览器当混合内容拦掉
function upgradeHttps(url) {
  return str(url).replace(/^http:\/\//i, 'https://')
}

// songmid 是唯一标识（网易云用数字 id，这里用字符串，前端只当不透明的 key 用）
function isMid(v) {
  return MID_RE.test(str(v))
}

function normalizeTrack(x) {
  const mid = str(x && x.songmid)
  if (!isMid(mid)) return null
  const sg = Array.isArray(x.singer) ? x.singer : x.singer ? [x.singer] : []
  return {
    id: mid,
    name: str(x.songname),
    artists: sg.map((s) => str(s && s.name)).filter(Boolean).join(' / '),
    album: str(x.albumname),
    cover: x.albummid ? upgradeHttps(`https://y.gtimg.cn/music/photo_new/T002R300x300M000${x.albummid}.jpg`) : '',
    duration: Number(x.interval || 0) * 1000, // QQ 给的是秒，前端统一按毫秒显示
    free: !Number(((x.pay || {}).payplay) || 0), // payplay=0 才有免费播放地址（实测与 purl 完全对应）
  }
}

function normalizeList(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeTrack).filter(Boolean)
}

// client_search_cp 的曲目在 data.song.list；接口挂了就整个当成空结果，别把 undefined 传下去
function parseSearch(json) {
  return normalizeList((((json || {}).data || {}).song || {}).list)
}

// 地址取不到时的说法：QQ 音乐这边没有“填 cookie 就好”这条路，所以直接把原因说成版权
const NO_URL = '这首要 QQ 音乐会员或受版权限制（会自动换下一首）'

// 直链 = sip 给的域名 + purl（purl 已带 guid/vkey/fromtag，再自己拼参数会算出错的 vkey）
function parseVkey(json, id) {
  const data = (((json || {}).req_0 || {}).data) || {}
  const rows = Array.isArray(data.midurlinfo) ? data.midurlinfo : []
  const row = rows.find((r) => str(r.songmid) === str(id)) || rows[0] || {}
  const host = upgradeHttps((data.sip || [])[0] || 'http://ws.stream.qqmusic.qq.com/').replace(/\/$/, '')
  const url = row.purl ? `${host}/${row.purl}` : ''
  return {
    id: str(id),
    url,
    filename: str(row.filename),
    reason: url ? '' : row.purl === '' || row.purl == null ? NO_URL : '地址已过期，重试',
  }
}

/* 队列顺序：从 offset 起环形取 n 首，随机由外部传入的 rnd 决定，
 * 纯函数便于测试（否则每次都要造一堆随机数才能断言）。 */
function rotate(list, offset) {
  const n = list.length
  if (!n) return []
  const start = ((Math.trunc(offset) % n) + n) % n
  return list.slice(start).concat(list.slice(0, start))
}

// 免费歌排前面：QQ 音乐这边付费歌一定拿不到地址，排在前面就等于让用户一上手就连着播放失败
function sortByPlayable(list) {
  return list.slice().sort((a, b) => (a.free ? 0 : 1) - (b.free ? 0 : 1))
}

// 搜索结果里可能反复出现同一首歌（翻唱、同名纯音乐），按 songmid 去重
function dedupe(list) {
  const seen = new Set()
  return list.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)))
}

/* ---------- 网络层 ---------- */

function qqFetch({ host, pathname, method = 'GET', body = '' }) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': UA,
      Referer: 'https://y.qq.com/',
      Origin: 'https://y.qq.com',
      Accept: 'application/json, text/plain, */*',
    }
    if (body) headers['Content-Type'] = 'application/json'
    const req = https.request({ host, path: pathname, method, headers, timeout: TIMEOUT }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => {
        text += c
        if (text.length > 4e6) { req.destroy(); reject(new Error('QQ 音乐返回过大')) }
      })
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`QQ 音乐返回 ${res.statusCode}`))
        try { resolve(JSON.parse(text)) } catch { reject(new Error('QQ 音乐返回不是 JSON，接口可能改版了')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('QQ 音乐请求超时，检查本机网络')) })
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || /getaddrinfo|ECONN/.test(e.message) ? '连不上 QQ 音乐（网络或 DNS 不可用）' : e.message)))
    if (body) req.write(body)
    req.end()
  })
}

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

async function search(q, { limit = 30, page = 1 } = {}) {
  const n = Math.min(50, Math.max(1, Number(limit) || 30))
  const json = await qqFetch({
    host: SEARCH_HOST,
    pathname: `/soso/fcgi-bin/client_search_cp?${qs({ format: 'json', w: q, p: Math.max(1, Number(page) || 1), n })}`,
  })
  return dedupe(parseSearch(json)).slice(0, n)
}

/* vkey.GetVkeyServer 的入参名是 songmid（不是 songmidlist，那个属于另一个接口），
 * 传一首也能传一批，返回顺序与传入顺序一致 */
async function songUrl(mid, { fetcher = null } = {}) {
  const id = str(mid).trim()
  if (!isMid(id)) throw new Error('歌曲 ID 不对（QQ 音乐用的是 songmid）')
  const call = fetcher || qqFetch
  const json = await call({
    host: CGI_HOST,
    pathname: '/cgi-bin/musicu.fcg?format=json&inutf8=1',
    method: 'POST',
    body: JSON.stringify({
      comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
      req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid: GUID, songmid: [id], songtype: [0], uin: '0', loginflag: 0, platform: '20' } },
    }),
  })
  return parseVkey(json, id)
}

/* 轻音乐：这个平台读不到歌单，就靠几个搜索词把免费单曲攒成一串
 * （网易云那边是“找一个还在的歌单”，这边只能是“攒一批能播的歌”）。
 * 只留 free 的：付费歌在 QQ 音乐这边一定拿不到地址，混进来等于让休息时每两首就跳一次。 */
const LIGHT_WORDS = ['轻音乐 纯音乐', '纯音乐 钢琴 治愈', '班得瑞 纯音乐']
const LIGHT_PAGES = [1, 2] // 一个词只翻两页：再往后就是凑数，翻到第三页搜出来的和轻音乐没关系了

async function lightQueue({ limit = 60 } = {}, fetcher = null) {
  const s = fetcher || search
  const picked = []
  /* 同一页的几个关键词并发拉：串行跑六个请求要把界面卡住三四秒，
   * 而休息自动放歌正好走这里，慢就等于“点了没反应” */
  for (const page of LIGHT_PAGES) {
    const rounds = await Promise.all(LIGHT_WORDS.map((word) => s(word, { limit: 30, page }).catch(() => [])))
    rounds.forEach((r) => picked.push(...r))
    if (dedupe(picked).filter((t) => t.free).length >= limit) break
  }
  const tracks = dedupe(picked).filter((t) => t.free).slice(0, limit)
  if (!tracks.length) throw new Error('QQ 音乐那边没搜到能免费播的轻音乐，换个搜索词或切回网易云')
  return { kind: 'light', name: '轻音乐 · QQ 音乐', playlistId: 0, tracks }
}

// 按用户配置组装队列：QQ 音乐只有内置轻音乐这一种来源（歌单接口在没有登录态时读不到）
async function buildQueue(cfg, { limit = 60 } = {}) {
  if (cfg && (cfg.kind === 'playlist' || cfg.kind === 'mine')) {
    throw new Error('QQ 音乐的网页接口读不到歌单，换成网易云或用搜索自己攒列表')
  }
  return lightQueue({ limit })
}

module.exports = {
  SEARCH_HOST, CGI_HOST, TIMEOUT, GUID, MID_RE, LIGHT_WORDS,
  upgradeHttps, isMid, normalizeTrack, normalizeList, parseSearch, parseVkey, rotate, sortByPlayable, dedupe,
  qqFetch, qs, search, songUrl, lightQueue, buildQueue,
}
