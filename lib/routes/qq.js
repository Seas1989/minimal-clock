/* ---------- lib/routes/qq.js：QQ 音乐只读代理 ----------
 * 只有单曲搜索与播放地址。没有歌单类路由不是偷懒：那几个接口在没有 QQ 音乐登录态时
 * 全部回错误（实测记录写在 lib/music/qqmusic.js 顶部），所以这个平台的“来源”只有
 * 内置轻音乐，其余靠搜索自己搭列表。
 */
const qq = require('../music/qqmusic')
const { musicRowOf } = require('../db')
const { sendJSON, query } = require('../http')

module.exports = async function qqRoute(req, res, seg, user) {
  const q = query(req)
  const remote = (e) => sendJSON(res, 502, { error: e.message })

  if (req.method === 'GET' && seg[2] === 'search') {
    const kw = String(q.get('q') || '').trim()
    if (kw.length > 60) return sendJSON(res, 400, { error: '搜索词太长了' })
    const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 30))
    const page = Math.max(1, Number(q.get('page')) || 1)
    try {
      const list = await qq.search(kw || '轻音乐', { limit, page })
      // 免费歌排前面：付费歌在 QQ 音乐这边一定拿不到地址，排在前面只会让用户一上手就连着播放失败
      return sendJSON(res, 200, qq.sortByPlayable(list))
    } catch (e) { return remote(e) }
  }

  if (req.method === 'GET' && seg[2] === 'url') {
    const id = String(q.get('id') || '').trim()
    // 坏 id 拦在门口，不往 QQ 音乐发请求（它的 vkey 接口对非法 songmid 会直接返空）
    if (!qq.isMid(id)) return sendJSON(res, 400, { error: '歌曲 ID 不对（QQ 音乐用的是 songmid）' })
    try {
      const r = await qq.songUrl(id)
      // 与网易云同一形状：取不到地址也回 200，用 r.reason 说清楚原因
      return sendJSON(res, 200, r)
    } catch (e) { return remote(e) }
  }

  // 当前的播放列表：QQ 音乐这边就是“把几个搜索词里的免费单曲攒起来”
  if (req.method === 'GET' && seg[2] === 'queue') {
    const row = musicRowOf(user.id)
    try {
      const r = await qq.buildQueue(row.source)
      return sendJSON(res, 200, Object.assign({}, r, {
        offset: Math.floor(Math.random() * r.tracks.length), // 每次进来换个开头，不然休息总是从第一首开始
        playable: r.tracks.length, // 攒进队列的已经是全部能播的那部分
      }))
    } catch (e) { return remote(e) }
  }

  return sendJSON(res, 404, { error: 'not found' })
}
