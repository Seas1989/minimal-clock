/* ---------- lib/routes/friends.js：好友关系 ----------
 * 一条 friends.json 记录 = 两人之间的一段关系（a 发起、b 接收），status 只有
 * pending / accepted 两种活状态，拒绝就直接删掉这条记录。
 * 解除好友时会顺手撤掉相互的任务共享残留，并作废两人在挑战里互相的待处理邀请。
 */
const {
  loadUsers, loadFriends, saveFriends, loadTasks, saveTasks,
  loadChallenges, saveChallenges, friendIdsOf, genId,
} = require('../db')
const { sendJSON, readBody } = require('../http')

module.exports = async function friendsRoute(req, res, seg, user) {
  const users = loadUsers()
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).username || '未知用户'
  const rels = loadFriends()

  // GET /api/friends —— 好友列表 + 待处理申请
  if (req.method === 'GET') {
    const friends = friendIdsOf(user.id, rels).map((id) => ({ id, username: nameOf(id) }))
    const incoming = rels
      .filter((r) => r.status === 'pending' && r.b === user.id)
      .map((r) => ({ reqId: r.id, username: nameOf(r.a) }))
    const outgoing = rels
      .filter((r) => r.status === 'pending' && r.a === user.id)
      .map((r) => ({ reqId: r.id, username: nameOf(r.b) }))
    return sendJSON(res, 200, { friends, incoming, outgoing })
  }

  // POST /api/friends/request  { username } —— 加好友（对方已申请则直接成为好友）
  if (req.method === 'POST' && seg[2] === 'request') {
    const body = await readBody(req)
    const target = users.find((u) => u.username === String(body.username || '').trim())
    if (!target) return sendJSON(res, 404, { error: '用户不存在' })
    if (target.id === user.id) return sendJSON(res, 400, { error: '不能添加自己' })
    const exists = rels.find(
      (r) => (r.a === user.id && r.b === target.id) || (r.a === target.id && r.b === user.id)
    )
    if (exists && exists.status === 'accepted') return sendJSON(res, 409, { error: '已经是好友了' })
    if (exists && exists.status === 'pending') {
      if (exists.b === user.id) {
        exists.status = 'accepted'
        saveFriends()
        return sendJSON(res, 200, { ok: true, accepted: true })
      }
      return sendJSON(res, 409, { error: '申请已发送，等待对方同意' })
    }
    rels.push({ id: genId(), a: user.id, b: target.id, status: 'pending', createdAt: Date.now() })
    saveFriends()
    return sendJSON(res, 200, { ok: true })
  }

  // POST /api/friends/respond  { reqId, accept } —— 同意 / 拒绝
  if (req.method === 'POST' && seg[2] === 'respond') {
    const body = await readBody(req)
    const rel = rels.find((r) => r.id === body.reqId && r.b === user.id && r.status === 'pending')
    if (!rel) return sendJSON(res, 404, { error: '申请不存在' })
    if (body.accept) rel.status = 'accepted'
    else rels.splice(rels.indexOf(rel), 1)
    saveFriends()
    return sendJSON(res, 200, { ok: true })
  }

  // DELETE /api/friends/:friendId —— 解除好友，并撤回相互的任务共享
  if (req.method === 'DELETE' && seg.length === 3) {
    const fid = seg[2]
    const idx = rels.findIndex(
      (r) => r.status === 'accepted' && ((r.a === user.id && r.b === fid) || (r.a === fid && r.b === user.id))
    )
    if (idx === -1) return sendJSON(res, 404, { error: '好友不存在' })
    rels.splice(idx, 1)
    saveFriends()
    const tasks = loadTasks()
    let changed = false
    tasks.forEach((t) => {
      if (Array.isArray(t.shareWith) && t.shareWith.includes(fid)) {
        t.shareWith = t.shareWith.filter((x) => x !== fid)
        changed = true
      }
    })
    if (changed) saveTasks()
    // 解除好友后，两人在挑战里互相的待处理邀请一并作废（已加入的历史进度保留）
    const challenges = loadChallenges()
    let chChanged = false
    challenges.forEach((c) => {
      const before = (c.invites || []).length
      c.invites = (c.invites || []).filter((i) => !((i.user === fid || i.user === user.id) && i.status === 'pending'))
      if (c.invites.length !== before) chChanged = true
    })
    if (chChanged) saveChallenges()
    return sendJSON(res, 200, { ok: true })
  }

  return sendJSON(res, 404, { error: 'not found' })
}
