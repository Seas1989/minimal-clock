/* 同任务挑战的纯计算部分（不碰 HTTP、不碰磁盘，方便单独推理与测试）
 *
 * 设计要点：
 *   - 挑战只是“同一个目标 + 一批成员”，每个人的计时仍然跑在自己独立的任务上
 *     （task.challenge 指回挑战 id），所以不存在“一起完成同一份数据”
 *   - 进度只能从任务自身的累计量推导：elapsedBase 只在 running 时增长，
 *     所以 floor(累计毫秒 / 目标毫秒) 就是“刷完整了几个目标”，与是否每日循环无关
 */

const CYCLE = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5, yearly: 365 * 864e5 }

// 任务此刻实际跑了多久（毫秒）；startedAt 只看“有没有”，别用真值判断，0 也是合法时间戳
function taskLiveMs(t, now = Date.now()) {
  if (!t) return 0
  return t.status === 'running' && t.startedAt != null ? (t.elapsedBase || 0) + (now - t.startedAt) : t.elapsedBase || 0
}

// 成员进度：cycles = 刷完整了几个目标轮次，pct = 当前这一轮完成度
function memberProgress(task, ch, now = Date.now()) {
  const ms = taskLiveMs(task, now)
  const goal = ch && ch.duration > 0 ? ch.duration : 0
  if (!task) return { ms: 0, cycles: 0, pct: 0, done: false, missing: true }
  if (!goal) {
    // 正计时型挑战没有目标量，只能按累计时长比
    return { ms, cycles: 0, pct: task.status === 'done' ? 1 : 0, done: task.status === 'done', missing: false }
  }
  return {
    ms,
    cycles: Math.floor(ms / goal),
    pct: (ms % goal) / goal,
    done: task.status === 'done',
    missing: false,
  }
}

// 排行：先比完成的轮数，再比当前这一轮跑多远，最后比总投入
function rankMembers(members) {
  return members.slice().sort((a, b) => {
    if (b.cycles !== a.cycles) return b.cycles - a.cycles
    if (Math.abs(b.pct - a.pct) > 1e-6) return b.pct - a.pct
    return b.ms - a.ms
  })
}

/* 挑战详情：把成员、进度、点赞、我对它的状态拼成前端一次渲染就够的结构 */
function challengeView(ch, tasks, nameOf, meId, now = Date.now()) {
  const likes = Array.isArray(ch.likes) ? ch.likes : []
  const members = rankMembers(
    (ch.members || []).map((uid) => {
      const task = tasks.find((t) => t.challenge === ch.id && t.owner === uid) || null
      const p = memberProgress(task, ch, now)
      return {
        user: uid,
        username: nameOf(uid),
        taskId: task ? task.id : null,
        taskName: task ? task.name : '',
        taskStatus: task ? task.status : 'none',
        ...p,
        likes: likes.filter((l) => l.target === uid).length,
        likedByMe: likes.some((l) => l.target === uid && l.by === meId),
        isMe: uid === meId,
      }
    })
  )
  const myInvite = (ch.invites || []).find((i) => i.user === meId) || null
  return {
    id: ch.id,
    title: ch.title,
    type: ch.type,
    duration: ch.duration,
    recurrence: ch.recurrence,
    owner: ch.owner,
    ownerName: nameOf(ch.owner),
    isOwner: ch.owner === meId,
    createdAt: ch.createdAt,
    joined: !!ch.members.includes(meId),
    // 待我处理的邀请单独暴露出去，前端才做得到“可以拒绝”
    myInvite: myInvite ? { id: myInvite.id, status: myInvite.status, at: myInvite.at } : null,
    members,
    pending: (ch.invites || [])
      .filter((i) => i.status === 'pending')
      .map((i) => ({ user: i.user, username: nameOf(i.user), at: i.at })),
  }
}

// 进度条文案：有目标量就说“几轮 + 这一轮百分比”，纯计时型就说累计时长
function progressLabel(m, ch) {
  if (ch.duration > 0) {
    const unit = { daily: '天', weekly: '周', monthly: '月', yearly: '年' }[ch.recurrence] || '轮'
    return `已完成 ${m.cycles} ${unit} · 本轮 ${Math.round(m.pct * 100)}%`
  }
  return `累计 ${Math.floor(m.ms / 6e4)} 分钟`
}

module.exports = { CYCLE, taskLiveMs, memberProgress, rankMembers, challengeView, progressLabel }
