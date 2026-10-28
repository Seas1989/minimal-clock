/* ---------- 时间同步与心跳 ---------- */

import { setOffset, token } from './state.js'
import { refresh } from './task-actions.js'
import { loadFriends } from './friends.js'
import { loadChallenges } from './challenges.js'
import { checkCompletion, tickDisplay } from './display.js'
import { tickTaskTimes } from './task-list.js'
import { renderRest } from './rest.js'

export async function syncTime() {
  try {
    const { now } = await fetch('/api/time').then((r) => r.json())
    setOffset(now - Date.now())
  } catch { /* 后端不可用时退回本地时间 */ }
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  setInterval(() => {
    if (token) { tickDisplay(); tickTaskTimes(); checkCompletion(); renderRest() }

  }, 250)

  setInterval(() => { if (token) { refresh(); loadFriends(); loadChallenges() } }, 5000) // 定期与后端同步

  setInterval(syncTime, 60000)

}
