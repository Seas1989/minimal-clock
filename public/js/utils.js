/* ---------- 工具函数 ---------- */

import { $, CYCLE, REC_LABEL, challenges, offset, token } from './state.js'
import { logout } from './auth.js'

export function pad(n) { return String(n).padStart(2, '0') }

export function fmtElapsed(ms) {
  const s = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}天 ${pad(h)}:${pad(m)}:${pad(sec)}`
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${pad(m)}:${pad(sec)}`
}

export function serverNow() { return Date.now() + offset }

export function liveElapsed(t) {
  return t.status === 'running' ? t.elapsedBase + (serverNow() - t.startedAt) : t.elapsedBase
}

// 返回 { text, sub, frac }：主显示文本 + 状态副标题 + 进度环比例(0~1)
export function taskState(t) {
  const elapsed = liveElapsed(t)
  if (t.type === 'stopwatch') {
    return { text: fmtElapsed(elapsed), sub: statusSub(t), frac: (elapsed % 60000) / 60000 }
  }

  // 倒计时
  if (t.recurrence && t.recurrence !== 'none' && CYCLE[t.recurrence]) {
    const cycle = CYCLE[t.recurrence]
    const pos = elapsed % cycle
    const doneInCycle = pos >= t.duration
    const remain = doneInCycle ? 0 : t.duration - pos
    const nextIn = cycle - pos
    if (t.status === 'stopped') return { text: fmtElapsed(t.duration), sub: '未开始', frac: 1 }
    if (doneInCycle) return { text: '已完成', sub: `${REC_LABEL[t.recurrence]}循环 · ${fmtElapsed(nextIn)}后重新开始`, frac: 0 }
    return { text: fmtElapsed(remain), sub: `${REC_LABEL[t.recurrence]}循环进行中`, frac: remain / t.duration }
  }

  const remain = t.duration - elapsed
  if (t.status === 'done' || (remain <= 0 && t.status !== 'stopped')) return { text: '已完成', sub: '已完成', frac: 0 }
  if (t.status === 'stopped') return { text: fmtElapsed(t.duration), sub: '未开始', frac: 1 }
  return { text: fmtElapsed(Math.max(0, remain)), sub: statusSub(t), frac: Math.max(0, remain) / t.duration }
}

function statusSub(t) {
  return { running: t.type === 'countdown' ? '倒计时进行中' : '计时中', paused: '已暂停', stopped: '未开始', done: '已完成' }[t.status]
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['x-token'] = token
  const res = await fetch(path, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) { logout(); throw new Error(data.error || '登录已失效') }
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

/* ---------- 挑战名次：卡片摘要、专注顶部那条、结算画面共用一份算法 ----------
 * 三处口径必须一致，否则“卡上第 2 / 详情里第 3”这种矛盾直接就被用户看见。
 * 只读服务端已有的 members / pending 两个数组，不新增字段、不改接口 */

// 差距按“量级”说人话：比时长时没人关心秒，但几分钟的差距也不能四舍五入成 0
export function fmtShort(ms) {
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h} 小时 ${m} 分`
  if (m) return `${m} 分`
  return `${s} 秒`
}

export function rankOf(c) {
  const members = c.members || []
  const i = members.findIndex((m) => m.isMe)
  const total = members.length
  const pending = (c.pending || []).length
  const me = i >= 0 ? members[i] : null
  const top = members[0]
  return {
    rank: i >= 0 ? i + 1 : 0,
    total,
    me,
    // 与第一名的差距：累计时长之差（排行本来就是先比轮数再比时长，这里取最直接的那一项）
    gap: me && i > 0 && top ? fmtShort(top.ms - me.ms) : '',
    // “满员”在这只说明一件事：发出去的邀请全都同意了，没有还在等人答应的名额
    stateText: pending ? `还差 ${pending} 人` : total > 1 ? '已满员' : '还差好友加入',
    // 卡片上只留这一行：没加入的人看不到“你排第几”，就说清现在有几个人在跑
    line: me ? `你排第 ${i + 1} / 共 ${total} 人` : `共 ${total} 人在跑`,
  }
}

// 任务属于哪个挑战（t.challenge 存的是挑战 id）：没有就返回 null
export function challengeOfTask(t) {
  return (t && t.challenge && challenges.find((c) => c.id === t.challenge)) || null
}

/* 结算画面要的那三句话：没绑挑战就返回 null（普通倒计时跑完不该拿弹窗拦人）。
 * 名次与差距仍然走 rankOf，保证“结算说第 2、点进详情也是第 2” */
export function resultOfTask(t) {
  const ch = challengeOfTask(t)
  if (!ch) return null
  const r = rankOf(ch)
  return {
    title: `「${t.name}」这一轮跑完了`,
    rank: r.me ? `最终名次：第 ${r.rank} / 共 ${r.total} 人` : `${r.total} 人在跑，你这份还没进榜`,
    gap: r.me ? (r.gap ? `与第一名差 ${r.gap}` : '当下你就是第一名') : '',
    challengeId: ch.id,
  }
}
