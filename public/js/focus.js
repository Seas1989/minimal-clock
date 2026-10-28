/* ---------- 专注模式：整页雾化，只留下这一个计时窗 ---------- */

import { $, focusId, mode, setFocusId, tasks } from './state.js'
import { clamp } from './background.js'
import { taskState } from './utils.js'
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

export function tickFocus() {
  if (!focusId) return
  const t = focusTask()
  if (!t) return
  const st = taskState(t)
  $('focus-time').textContent = st.text
  $('focus-sub').textContent = `${st.sub}${t.challenge ? ' · 可看挑战排行' : ''}`
  $('focus-fill').style.width = `${(clamp(st.frac, 0, 1) * 100).toFixed(2)}%`
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('btn-focus-exit').onclick = exitFocus

}
