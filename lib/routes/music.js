/* ---------- lib/routes/music.js：播放配置（两个平台共用一条记录） ----------
 * 平台 / 来源 / MUSIC_U 都在 settings.json 的同一条记录上，所以读写只留一个入口，
 * 免得两边各改一半互相覆盖。MUSIC_U 永不回传明文，只给打码指纹。
 */
const ne = require('../music/netease')
const { musicRowOf, musicView, MUSIC_PLATFORMS, saveSettings } = require('../db')
const { sendJSON, readBody } = require('../http')

module.exports = async function musicRoute(req, res, seg, user) {
  if (seg[2] !== 'config') return sendJSON(res, 404, { error: 'not found' })

  const row = musicRowOf(user.id)
  if (req.method === 'GET') {
    return sendJSON(res, 200, musicView(row))
  }
  // POST {platform?, musicU?, kind?, value?, label?} —— 空串 musicU 表示清除
  const body = await readBody(req)
  const p = 'platform' in body ? (MUSIC_PLATFORMS.includes(body.platform) ? body.platform : 'netease') : row.platform
  const u = 'musicU' in body ? (body.musicU ? ne.extractMusicU(body.musicU) : '') : row.musicU
  /* 先全部校验、再一次性落笔：这张 row 是内存里的活引用，
   * 中途 return 400 却已经改了一半，下一次请求写盘就会把那个半截状态存下来 */
  if (body.musicU && !u) return sendJSON(res, 400, { error: 'MUSIC_U 看着不对（长度不在 20–4000），重新从网易云网页端复制' })
  const kinds = p === 'qq' ? ['light'] : ['light', 'playlist', 'mine'] // QQ 音乐只认「轻音乐」这一种来源（实测读不到歌单）
  let source = row.source
  if ('kind' in body || 'value' in body) {
    const kind = 'kind' in body ? (kinds.includes(body.kind) ? body.kind : 'light') : row.source.kind
    const raw = String('value' in body ? body.value : row.source.value || '').trim()
    // 只切来源、还没填链接时先存空：拉队列时会说“还没选歌单”，比在这儿报 400 卡住用户顺手
    const value = kind === 'playlist' ? ne.extractPlaylistId(raw) : ''
    if (kind === 'playlist' && raw && !value) return sendJSON(res, 400, { error: '歌单链接或 ID 提取不出来' })
    source = { kind, value, label: String(body.label || '').slice(0, 60) }
  } else if (p !== row.platform) {
    // 换平台就把来源复位成轻音乐：QQ 音乐读不到歌单，把网易云的「我的歌单」带过去只会得到一句报错
    source = { kind: 'light', value: '', label: '' }
  } else if (p === 'qq' && row.source.kind !== 'light') {
    source = { kind: 'light', value: '', label: '' }
  }
  row.platform = p
  row.musicU = u
  row.source = source
  row.updatedAt = Date.now()
  saveSettings()
  return sendJSON(res, 200, musicView(row))
}
