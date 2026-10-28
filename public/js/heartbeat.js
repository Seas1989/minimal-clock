/* ---------- 时间同步与心跳 ---------- */

import { setOffset, token } from './state.js'
import { refresh } from './task-actions.js'
import { loadFriends } from './friends.js'
import { loadChallenges, renderSyncTip } from './challenges.js'
import { checkCompletion, tickDisplay } from './display.js'
import { tickTaskTimes } from './task-list.js'
import { renderRest } from './rest.js'

export async function syncTime() {
  try {
    const { now } = await fetch('/api/time').then((r) => r.json())
    setOffset(now - Date.now())
  } catch { /* 后端不可用时退回本地时间 */ }
}

/* 后台标签页不该每隔几十秒去拉一批接口：用户不在看的时候拉了也白发，
 * 回到前台的那一下反而需要新数据，所以 visibilitychange 里补一次 */
function pullData() {
  if (!token || document.visibilityState !== 'visible') return
  refresh()
  loadFriends()
  loadChallenges()
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  setInterval(() => {
    if (token) { tickDisplay(); tickTaskTimes(); checkCompletion(); renderRest() }

  }, 250)

  // 30 秒一批：排行与「刚刚更新」靠它，但不再每五秒就打断后端一次
  setInterval(pullData, 30000)

  document.addEventListener('visibilitychange', pullData)

  // 那句「刚刚更新」要自己往前走到「59 秒前」，不必等下一轮数据
  setInterval(renderSyncTip, 1000)

  setInterval(syncTime, 60000)

}
