/* ---------- 标签页 ---------- */

import { $, setModeState, setSelectedId } from './state.js'
import { createTask } from './task-actions.js'
import { addFriend } from './friends.js'
import { renderTimerPanel, tickDisplay } from './display.js'

export function setMode(m, persist = true) {
  if (!['clock', 'countdown', 'stopwatch'].includes(m)) m = 'clock'
  setModeState(m)
  setSelectedId(null)
  if (persist) localStorage.setItem('mode', m)
  document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.mode === m))
  renderTimerPanel()
  tickDisplay()
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  document.querySelectorAll('#tabs .tab').forEach((tab) => {
    tab.onclick = () => setMode(tab.dataset.mode)
  })

  $('btn-create').onclick = createTask

  $('btn-add-friend').onclick = addFriend

  $('friend-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend() })

}
