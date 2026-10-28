/* ---------- lib/music/netease.js：网易云音乐的只读代理 ----------
 * 只用 node:https，不引第三方 SDK：走的是网页端一直在用的几个开放 JSON 接口，
 * 带上 UA + Referer 就能取数据；付费/VIP 曲目需要用户自己的 MUSIC_U cookie。
 *
 * 分层原则：parse* 全是纯函数（喂 JSON 就出结果，断网也能单测），
 * 网络只集中在 neteaseFetch 一处，路由层不碰 http。
 */
const https = require('https')

const HOST = 'music.163.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT = 8000

/* ---------- 纯解析 ---------- */

const str = (v) => (v == null ? '' : String(v))

// http 升到 https：部署在 https 下时，http 的音频直链会被浏览器当混合内容拦掉
function upgradeHttps(url) {
  return str(url).replace(/^http:\/\//i, 'https://')
}

// 歌手可能是 artists / ar，专辑可能是 album / al，两个接口的字段名不一致，这里统一掉
// 歌曲 id 不会为 0，用 !x.id 一并挡掉 null / undefined / 0，免得背 NaN 进界面
function normalizeTrack(x) {
  if (!x || !x.id) return null
  const ar = x.ar || x.artists || x.artist || []
  const al = x.al || x.album || {}
  return {
    id: Number(x.id),
    name: str(x.name),
    artists: (Array.isArray(ar) ? ar : [ar]).map((a) => str(a && a.name)).filter(Boolean).join(' / '),
    album: str(al.name),
    cover: upgradeHttps(al.picUrl || ''),
    duration: Number(x.dt || x.duration || 0),
    fee: Number(x.fee || 0), // 0 免费 / 1 VIP / 4 专辑付费 / 8 低质免费试用
  }
}

function normalizeList(raw) {
  return (Array.isArray(raw) ? raw : []).map(normalizeTrack).filter(Boolean)
}

// /api/search/get/web：type=1 单曲，type=1000 歌单
function parseSearch(json, kind) {
  const r = (json || {}).result || {}
  if (kind === 'playlist') {
    return (r.playlists || []).map((p) => ({
      id: Number(p.id),
      name: str(p.name),
      cover: upgradeHttps(p.coverImgUrl),
      trackCount: Number(p.trackCount || 0),
      creator: str((p.creator || {}).nickname),
    })).filter((p) => p.id)
  }
  return normalizeList(r.songs || [])
}

// /api/playlist/detail：老接口把完整曲目放在 result.tracks 里，不必再二次批量查
function parsePlaylist(json) {
  const r = (json || {}).result || (json || {}).playlist || {}
  return {
    id: Number(r.id || 0),
    name: str(r.name),
    cover: upgradeHttps(r.coverImgUrl),
    trackCount: Number(r.trackCount || 0),
    tracks: normalizeList(r.tracks || []),
  }
}

// /api/v6/playlist/detail 只给 id 清单，拿总数与完整曲目靠它
function parseTrackIds(json) {
  const p = (json || {}).playlist || {}
  return {
    trackCount: Number(p.trackCount || 0),
    ids: (p.trackIds || []).map((x) => Number(x && x.id != null ? x.id : x)).filter(Boolean),
  }
}

// /api/v3/song/detail：c=[{id:1},{id:2}] 批量回详情，一次 50 首实测没问题
function parseSongDetail(json) {
  return normalizeList((json || {}).songs || [])
}

// 用户歌单：/api/user/playlist，cookie 有效时返回这个人的歌单，第一份通常就是「我喜欢的音乐」
function parseUserPlaylists(json) {
  return ((json || {}).playlist || []).map((p) => ({
    id: Number(p.id),
    name: str(p.name),
    cover: upgradeHttps(p.coverImgUrl),
    trackCount: Number(p.trackCount || 0),
    owned: !!p.owned,
    subscribed: !!p.subscribed,
  })).filter((p) => p.id)
}

function parseAccount(json) {
  const a = (json || {}).account
  return a && a.id != null ? { uid: Number(a.id), name: str((json.profile || {}).nickname || a.name) } : null
}

/* 播放地址：/api/song/enhance/player/url 每条给 code，
 * 拿不到 url 时把原因说清楚，前端才能提示「这首需要 MUSIC_U」而不是「播放失败」。 */
const URL_REASON = {
  '-110': '需要登录网易云账号（填入 MUSIC_U）',
  '-201': '版权限制，无法播放（试下一首）',
  '-460': '该歌曲仅在网易云客户端播放',
  '403': '需要 VIP 或已过期',
}

function parseUrl(json, id) {
  const row = (((json || {}).data || [])[0]) || {}
  const url = upgradeHttps(row.url || '')
  const canPlay = !!url && row.code === 200
  return {
    id: Number(id),
    url: canPlay ? url : '',
    size: Number(row.size || 0),
    br: Number(row.br || 0),
    level: str(row.level),
    code: Number(row.code || 0),
    reason: canPlay ? '' : URL_REASON[String(row.code)] || (row.url ? '地址已过期，重试' : '取不到播放地址'),
  }
}

// 用户可能直接粘贴网页地址栏，也可能只给一串数字
function extractPlaylistId(input) {
  const s = str(input).trim()
  const m = s.match(/(?:playlist|list)[/?=&#]*id=(\d{3,20})/i) || s.match(/^(\d{3,20})$/)
  return m ? m[1] : ''
}

// 粘贴整条 Cookie 也能用：只把 MUSIC_U 挑出来
function extractMusicU(input) {
  const s = str(input).trim()
  const m = s.match(/(?:^|[;\s])MUSIC_U=([^;\s]+)/i)
  const v = m ? m[1] : s
  return v.length >= 20 && v.length <= 4000 ? v : ''
}

/* 队列顺序：从 offset 起环形取 n 首，随机由外部传入的 rnd 决定，
 * 纯函数便于测试（否则每次都要造一堆随机数才能断言）。 */
function rotate(list, offset) {
  const n = list.length
  if (!n) return []
  const start = ((Math.trunc(offset) % n) + n) % n
  return list.slice(start).concat(list.slice(0, start))
}

// 没有 cookie 时 fee=1/4 的歌大概率取不到地址，排到后面；
// fee=8（免费试听/低质）实测能直接播，归到可播一档，别把它误当成付费歌沉底
const freeWithoutCookie = (fee) => fee === 0 || fee === 8

function sortByPlayable(list, hasCookie) {
  if (hasCookie) return list.slice()
  return list.slice().sort((a, b) => (freeWithoutCookie(a.fee) ? 0 : 1) - (freeWithoutCookie(b.fee) ? 0 : 1))
}

/* ---------- 网络层 ---------- */

function neteaseFetch(pathname, { method = 'GET', body = '', cookie = '' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': UA,
      Referer: `https://${HOST}/`,
      Accept: 'application/json, text/plain, */*',
    }
    if (cookie) headers.Cookie = `MUSIC_U=${cookie}`
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const req = https.request(
      { host: HOST, path: pathname, method, headers, timeout: TIMEOUT },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          text += c
          if (text.length > 4e6) { req.destroy(); reject(new Error('网易云返回过大')) }
        })
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`网易云返回 ${res.statusCode}`))
          try { resolve(JSON.parse(text)) } catch { reject(new Error('网易云返回不是 JSON，接口可能改版了')) }
        })
      }
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('网易云请求超时，检查本机网络')) })
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || /getaddrinfo|ECONN/.test(e.message) ? '连不上网易云（网络或 DNS 不可用）' : e.message)))
    if (body) req.write(body)
    req.end()
  })
}

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

async function search(q, { kind = 'song', limit = 30, offset = 0, cookie = '' } = {}) {
  const type = kind === 'playlist' ? 1000 : 1
  const json = await neteaseFetch(`/api/search/get/web?${qs({ csrf_token: '', s: q, type, offset, total: 'true', limit })}`, { method: 'POST', body: qs({ s: q, type, offset, limit }) })
  return parseSearch(json, kind)
}

async function playlist(id, { cookie = '', limit = 80 } = {}) {
  if (!id) throw new Error('缺少歌单 ID')
  const head = parsePlaylist(await neteaseFetch(`/api/playlist/detail?${qs({ id })}`))
  let tracks = head.tracks
  let count = head.trackCount
  if (tracks.length < limit) {
    /* 网页端现在只吐前 10 首（trackCount 也跟着只报 10），
     * 剩下的靠 v6 的 id 清单 + v3 的批量详情补齐；补齐失败就退回已有的，别让整个队列拿不到 */
    try {
      const v6 = parseTrackIds(await neteaseFetch(`/api/v6/playlist/detail?${qs({ id, n: 1000 })}`, { method: 'POST' }))
      count = Math.max(count, v6.trackCount, v6.ids.length)
      const more = v6.ids.filter((x) => !tracks.some((t) => t.id === x)).slice(0, limit - tracks.length)
      for (let i = 0; i < more.length; i += 50) {
        const c = more.slice(i, i + 50)
        const json = await neteaseFetch('/api/v3/song/detail', { method: 'POST', cookie, body: `c=${encodeURIComponent(JSON.stringify(c.map((x) => ({ id: x }))))}` })
        tracks = tracks.concat(parseSongDetail(json))
      }
    } catch { /* 保持已有曲目 */ }
  }
  return Object.assign(head, { trackCount: count, tracks: tracks.slice(0, limit) })
}

async function account({ cookie = '' } = {}) {
  if (!cookie) return null
  return parseAccount(await neteaseFetch('/api/nuser/account/get'))
}

async function myPlaylists({ cookie = '' } = {}) {
  if (!cookie) throw new Error('先填入 MUSIC_U 才能读你自己的歌单')
  const acc = await account({ cookie })
  if (!acc) throw new Error('MUSIC_U 无效或已过期，去网易云网页端重新登录后再复制')
  const json = await neteaseFetch(`/api/user/playlist?${qs({ uid: acc.uid, s: 0, limit: 100 })}`, { cookie })
  return { uid: acc.uid, name: acc.name, playlists: parseUserPlaylists(json) }
}

async function songUrl(id, { cookie = '' } = {}) {
  const one = Number(Array.isArray(id) ? id[0] : id)
  if (!one) throw new Error('缺少歌曲 ID')
  const json = await neteaseFetch(`/api/song/enhance/player/url?${qs({ ids: JSON.stringify([one]), br: 320000 })}`, { method: 'POST', cookie })
  return parseUrl(json, one)
}

/* 轻音乐：不写死歌单 ID（网易云说下线就下线），
 * 先用「歌单搜索」找一个还在的轻音乐歌单，退一步才用单曲搜索兜底。 */
const LIGHT_WORDS = ['轻音乐 纯音乐', '纯音乐 钢琴 治愈', '轻音乐']

async function lightQueue({ cookie = '' } = {}, fetcher = null) {
  const s = fetcher || search
  for (const word of LIGHT_WORDS) {
    try {
      const lists = await s(word, { kind: 'playlist', limit: 8 })
      // 候选里挑曲目最多的：只有 10 首的列表听两轮就到底了
      const hit = (lists || []).filter((p) => p.trackCount >= 8).sort((a, b) => b.trackCount - a.trackCount)[0]
      if (hit) {
        const pl = await playlist(hit.id)
        if (pl.tracks.length) return { kind: 'light', name: `轻音乐 · ${pl.name}`, playlistId: pl.id, tracks: sortByPlayable(pl.tracks, !!cookie).slice(0, 60) }
      }
    } catch { /* 换下一个关键字 */ }
  }
  const songs = await s('轻音乐 纯音乐', { kind: 'song', limit: 30 })
  return { kind: 'light', name: '轻音乐 · 搜索兜底', playlistId: 0, tracks: songs.slice(0, 30) }
}

/* 按用户配置组装队列：light 内置轻音乐 / playlist 指定歌单 / mine 自己收藏的第一份 */
async function buildQueue(cfg, { cookie = '' } = {}) {
  const kind = cfg.kind === 'playlist' || cfg.kind === 'mine' ? cfg.kind : 'light'
  if (kind === 'playlist') {
    const id = cfg.value ? String(cfg.value) : ''
    if (!id) throw new Error('还没选歌单，在「音乐」里粘一个歌单链接')
    const pl = await playlist(id, { cookie, limit: 100 })
    if (!pl.tracks.length) throw new Error('这个歌单里没有能读的曲目')
    return { kind, name: pl.name, playlistId: pl.id, tracks: sortByPlayable(pl.tracks, !!cookie).slice(0, 100) }
  }
  if (kind === 'mine') {
    const r = await myPlaylists({ cookie })
    const p = r.playlists[0]
    if (!p) throw new Error('你的网易云账号下没有歌单')
    const pl = await playlist(p.id, { cookie, limit: 100 })
    return { kind, name: `${r.name} · ${p.name}`, playlistId: pl.id, tracks: sortByPlayable(pl.tracks, !!cookie).slice(0, 100) }
  }
  return lightQueue({ cookie })
}

module.exports = {
  HOST, TIMEOUT,
  upgradeHttps, normalizeTrack, normalizeList, parseSearch, parsePlaylist, parseUserPlaylists,
  parseAccount, parseUrl, parseTrackIds, parseSongDetail, extractPlaylistId, extractMusicU, rotate, sortByPlayable, freeWithoutCookie,
  neteaseFetch, qs, search, playlist, account, myPlaylists, songUrl, lightQueue, buildQueue,
  LIGHT_WORDS,
}
