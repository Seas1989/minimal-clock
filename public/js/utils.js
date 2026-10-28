/* ---------- 工具函数 ---------- */

import { $, CYCLE, REC_LABEL, offset, token } from './state.js'
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
