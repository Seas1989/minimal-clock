/* ---------- lib/routes/netease.js：网易云只读代理 ----------
 * 这一层只做参数校验 + 调 lib/music/netease.js，解析与取地址的细节都在适配层里。
 * 全部要登录（见 lib/api.js），免得本机沦为公开代理。
 */
const ne = require('../music/netease')
const { musicRowOf } = require('../db')
const { sendJSON, query } = require('../http')

module.exports = async function neteaseRoute(req, res, seg, user) {
  const q = query(req)
  const rowOf = () => musicRowOf(user.id)

  // 远端失败统一报 502：与自己的数据出错区分开，前端只提示“这次没拿到”，不把弹窗打碎
  // neteaseFetch 的错误消息已经自带“网易云 / 连不上”字样，再加前缀就变成两句重复的话
  const remote = (e) => sendJSON(res, 502, { error: e.message })

  if (req.method === 'GET' && seg[2] === 'playlists') {
    try {
      const r = await ne.myPlaylists({ cookie: rowOf().musicU })
      return sendJSON(res, 200, r)
    } catch (e) { return remote(e) }
  }

  if (req.method === 'GET' && seg[2] === 'search') {
    const kw = String(q.get('q') || '').trim()
    if (kw.length > 60) return sendJSON(res, 400, { error: '搜索词太长了' })
    const isPl = q.get('kind') === 'playlist'
    const limit = Math.min(isPl ? 20 : 50, Math.max(1, Number(q.get('limit')) || 20))
    try {
      const list = await ne.search(kw || '轻音乐', { kind: isPl ? 'playlist' : 'song', limit })
      // 单曲结果按“取不取到地址”稳排一遍：没 cookie 时付费歌沉底，
      // 否则用户搜个歌手连播，前 5 首全是播不了的，看起来就像功能坏了
      return sendJSON(res, 200, isPl ? list : ne.sortByPlayable(list, !!rowOf().musicU))
    } catch (e) { return remote(e) }
  }

  // 任意歌单的曲目：搜索结果里点「播放」就直接成队列，不必先把这个歌单设成来源
  if (req.method === 'GET' && seg[2] === 'playlist') {
    const row = rowOf()
    const id = ne.extractPlaylistId(q.get('id') || '')
    if (!id) return sendJSON(res, 400, { error: '歌单 ID 不对' })
    const limit = Math.min(300, Math.max(1, Number(q.get('limit')) || 120))
    try {
      const pl = await ne.playlist(id, { cookie: row.musicU, limit })
      if (!pl.tracks.length) return sendJSON(res, 502, { error: '这个歌单里没有能读的曲目' })
      return sendJSON(res, 200, {
        id: pl.id,
        name: pl.name,
        trackCount: pl.trackCount,
        tracks: ne.sortByPlayable(pl.tracks, !!row.musicU),
      })
    } catch (e) { return remote(e) }
  }

  // 当前的播放列表：按用户配置拼好，前端拿到就是一串可直接播的曲目
  if (req.method === 'GET' && seg[2] === 'queue') {
    const row = rowOf()
    try {
      const r = await ne.buildQueue(row.source, { cookie: row.musicU })
      return sendJSON(res, 200, Object.assign({}, r, {
        offset: Math.floor(Math.random() * r.tracks.length), // 每次进来换个开头，不然休息总是从第一首开始
        playable: ne.sortByPlayable(r.tracks, !!row.musicU).length,
      }))
    } catch (e) { return remote(e) }
  }

  if (req.method === 'GET' && seg[2] === 'url') {
    const row = rowOf()
    try {
      const r = await ne.songUrl(q.get('id'), { cookie: row.musicU })
      // 取不到地址也回 200：r.url 为空 + r.reason 说明原因，比一个没有响应体的 204 好处理
      return sendJSON(res, 200, r)
    } catch (e) { return remote(e) }
  }

  return sendJSON(res, 404, { error: 'not found' })
}
