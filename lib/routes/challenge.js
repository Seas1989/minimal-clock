/* ---------- lib/routes/challenge.js：同任务挑战 ----------
 * 同一个目标、各自打卡、按进度排行：挑战记录只存成员 id 名单与邀请，
 * 每个人的计时仍在自己那份任务上（challenge 字段指回挑战 id），
 * 所以谁也不能改谁的进度 —— 排行由 lib/challenges.js 的纯计算现算。
 */
const { CYCLE, challengeView } = require('../challenges')
const {
  loadTasks, saveTasks, loadChallenges, saveChallenges, friendIdsOf, nameOf, genId,
} = require('../db')
const { sendJSON, readBody } = require('../http')

module.exports = async function challengeRoute(req, res, seg, user) {
  const tasks = loadTasks()
  const challenges = loadChallenges()
  const findChallenge = () => challenges.find((c) => c.id === seg[2])

  // 邀请名单：'all' = 全好友；也接受 id 数组（前端多选）；只认好友，并排除已在成员里的人
  function inviteList(body, ch) {
    const friends = friendIdsOf(user.id)
    if (!friends.length) throw new Error('还没有好友，先加好友再发起挑战')
    const picked = body.to === 'all' ? friends : Array.isArray(body.to) ? body.to.map(String) : [String(body.to)]
    const have = new Set([...(ch ? ch.members : []), ...(ch ? ch.invites || [] : []).filter((i) => i.status !== 'rejected').map((i) => i.user)])
    const targets = Array.from(new Set(picked)).filter((x) => friends.includes(x) && !have.has(x))
    if (!targets.length) throw new Error('只能邀请还没加入的好友')
    return targets
  }

  // GET /api/challenges —— 我参与的 + 待我处理的邀请
  if (req.method === 'GET' && seg.length === 2) {
    const mine = challenges.filter(
      (c) => c.members.includes(user.id) || (c.invites || []).some((i) => i.user === user.id && i.status === 'pending')
    )
    return sendJSON(res, 200, mine.map((c) => challengeView(c, tasks, nameOf, user.id)))
  }

  // POST /api/challenges  { taskId, to: friendId | 'all', title?, duration? } —— 由我的任务发起挑战
  if (req.method === 'POST' && seg.length === 2) {
    const body = await readBody(req)
    const src = tasks.find((t) => t.id === body.taskId && t.owner === user.id)
    if (!src) return sendJSON(res, 404, { error: '任务不存在' })
    if (src.challenge) return sendJSON(res, 409, { error: '这个任务已经在挑战里了' })
    let targets
    try {
      targets = inviteList(body, null)
    } catch (e) {
      return sendJSON(res, 400, { error: e.message })
    }
    const now = Date.now()
    const ch = {
      id: genId(),
      title: (String(body.title || '').trim() || src.name).slice(0, 30),
      type: src.type,
      // 正计时任务本身没有目标量，由发起人额外给一个“每轮目标时长”才能排行
      duration: src.type === 'stopwatch' ? Math.max(0, Number(body.duration) || 0) : src.duration,
      recurrence: CYCLE[src.recurrence] ? src.recurrence : 'none',
      owner: user.id,
      members: [user.id],
      invites: targets.map((uid) => ({ id: genId(), user: uid, status: 'pending', at: now })),
      likes: [],
      createdAt: now,
    }
    challenges.push(ch)
    src.challenge = ch.id
    saveChallenges()
    saveTasks()
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // GET /api/challenges/:id —— 挑战略详情（成员进度 + 点赞）
  if (req.method === 'GET' && seg.length === 3) {
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    if (!ch.members.includes(user.id) && !(ch.invites || []).some((i) => i.user === user.id)) {
      return sendJSON(res, 403, { error: '你不在这个挑战里' })
    }
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // POST /api/challenges/:id/respond  { accept } —— 接受 / 拒绝邀请（拒绝后不再骚扰，除非重新邀请）
  if (req.method === 'POST' && seg[3] === 'respond') {
    const body = await readBody(req)
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    const inv = (ch.invites || []).find((i) => i.user === user.id && i.status === 'pending')
    if (!inv) return sendJSON(res, 404, { error: '没有待你处理的邀请' })
    if (!body.accept) {
      inv.status = 'rejected'
      inv.at = Date.now()
      saveChallenges()
      return sendJSON(res, 200, { ok: true, accepted: false })
    }
    inv.status = 'accepted'
    if (!ch.members.includes(user.id)) ch.members.push(user.id)
    // 接受 = 给自己建一份同名任务，计时完全独立，只是同一个目标
    if (!tasks.some((t) => t.challenge === ch.id && t.owner === user.id)) {
      tasks.push({
        id: genId(),
        owner: user.id,
        name: ch.title,
        type: ch.type,
        duration: ch.duration,
        recurrence: ch.recurrence,
        challenge: ch.id,
        status: 'stopped',
        elapsedBase: 0,
        startedAt: null,
        createdAt: Date.now(),
      })
      saveTasks()
    }
    saveChallenges()
    return sendJSON(res, 200, { ok: true, accepted: true })
  }

  // POST /api/challenges/:id/invite  { to } —— 追加邀请
  if (req.method === 'POST' && seg[3] === 'invite') {
    const body = await readBody(req)
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    if (ch.owner !== user.id) return sendJSON(res, 403, { error: '只有发起人能邀请' })
    let targets
    try {
      targets = inviteList(body, ch)
    } catch (e) {
      return sendJSON(res, 400, { error: e.message })
    }
    const now = Date.now()
    // 之前拒绝过的人重新邀请：直接复用那条记录，不留一堆 rejected 垃圾
    targets.forEach((uid) => {
      const old = (ch.invites || []).find((i) => i.user === uid)
      if (old) Object.assign(old, { status: 'pending', at: now })
      else ch.invites.push({ id: genId(), user: uid, status: 'pending', at: now })
    })
    saveChallenges()
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // POST /api/challenges/:id/like  { user } —— 给某成员的进度点赞（再点取消）
  if (req.method === 'POST' && seg[3] === 'like') {
    const body = await readBody(req)
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    const target = String(body.user || '')
    if (!ch.members.includes(user.id)) return sendJSON(res, 403, { error: '加入后才能点赞' })
    if (!ch.members.includes(target)) return sendJSON(res, 404, { error: '对方不在挑战里' })
    if (target === user.id) return sendJSON(res, 400, { error: '不能给自己点赞' })
    ch.likes = ch.likes || []
    const i = ch.likes.findIndex((l) => l.by === user.id && l.target === target)
    if (i >= 0) ch.likes.splice(i, 1)
    else ch.likes.push({ by: user.id, target, at: Date.now() })
    saveChallenges()
    return sendJSON(res, 200, challengeView(ch, tasks, nameOf, user.id))
  }

  // POST /api/challenges/:id/leave —— 退出挑战（发起人不能退，只能关闭）
  if (req.method === 'POST' && seg[3] === 'leave') {
    const ch = findChallenge()
    if (!ch) return sendJSON(res, 404, { error: '挑战不存在' })
    if (ch.owner === user.id) return sendJSON(res, 400, { error: '发起人请直接关闭挑战' })
    ch.members = ch.members.filter((x) => x !== user.id)
    ch.invites = (ch.invites || []).filter((i) => i.user !== user.id)
    tasks.forEach((t) => {
      if (t.challenge === ch.id && t.owner === user.id) t.challenge = null
    })
    saveChallenges()
    saveTasks()
    return sendJSON(res, 200, { ok: true })
  }

  // DELETE /api/challenges/:id —— 发起人关闭挑战，并解绑所有人的任务
  if (req.method === 'DELETE' && seg.length === 3) {
    const idx = challenges.findIndex((c) => c.id === seg[2])
    if (idx === -1) return sendJSON(res, 404, { error: '挑战不存在' })
    if (challenges[idx].owner !== user.id) return sendJSON(res, 403, { error: '只有发起人能关闭' })
    const [gone] = challenges.splice(idx, 1)
    tasks.forEach((t) => {
      if (t.challenge === gone.id) t.challenge = null
    })
    saveChallenges()
    saveTasks()
    return sendJSON(res, 200, { ok: true })
  }

  return sendJSON(res, 404, { error: 'not found' })
}
