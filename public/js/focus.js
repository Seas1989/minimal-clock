/* ---------- 专注模式：整页雾化，只留下这一个计时窗 ---------- */

import { $, focusId, mode, setFocusId, tasks } from './state.js'
import { clamp } from './background.js'
import { challengeOfTask, rankOf, taskState } from './utils.js'
import { setSelection } from './task-actions.js'
import { controlButtons } from './display.js'
import { focusTask } from './dock.js'
import { setMode } from './tabs.js'

export function enterFocus(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  setFocusId(id)
  if (mode !== t.type) setMode(t.type)
  setSelection(id)
  $('focus').classList.remove('hidden')
  renderFocus()
}

export function exitFocus() {
  setFocusId(null)
  $('focus').classList.add('hidden')
}

export function renderFocus() {
  const t = focusTask()
  if (!t) { exitFocus(); return }
  $('focus-name').textContent = t.name
  controlButtons($('focus-controls'), t)
  tickFocus()
}

/* 专注顶部那条窄排名条：不跳出去看详情也能知道“我在第几、差第一名多少”。
 * 每 250ms 跟着心跳跑，所以只在文本真变了时写 DOM，不白重排 */
let lastRankLine = null

export function tickFocus() {
  if (!focusId) return
  const t = focusTask()
  if (!t) return
  const st = taskState(t)
  const timeEl = $('focus-time')
  timeEl.textContent = st.text
  timeEl.classList.toggle('paused', t.status !== 'running')   // 暂停时缩一点、暗一点（动画在 CSS 里）
  $('focus-sub').textContent = st.sub
  $('focus-fill').style.width = `${(clamp(st.frac, 0, 1) * 100).toFixed(2)}%`

  const ch = challengeOfTask(t)
  const bar = $('focus-rank')
  const line = !ch ? '' : (() => {
    const r = rankOf(ch)
    return r.me ? `我第 ${r.rank} / 共 ${r.total} 人${r.gap ? ` · 与第一名差 ${r.gap}` : r.rank === 1 ? ' · 领先' : ''}` : `${ch.title} · ${r.stateText}`
  })()
  if (line === lastRankLine) return
  lastRankLine = line
  bar.textContent = line
  bar.classList.toggle('hidden', !line)
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('btn-focus-exit').onclick = exitFocus

}
