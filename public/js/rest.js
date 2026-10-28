/* ---------- 休息：正计时暂停后问一句，倒计时走完了自动续上刚才的任务 ---------- */

import { $, tasks } from './state.js'
import { beep, confirmAction, toast } from './ui.js'
import { clamp, lsNum } from './background.js'
import { fmtElapsed, liveElapsed, serverNow } from './utils.js'
import { act } from './task-actions.js'
import { audioEl, music, musicAutoplay, musicStop, queue, unlockAudio } from './music.js'

export let rest = null // { endAt, taskId }：纯前端状态，刷不刷页面不影响任务自己的计时
const restMins = () => clamp(lsNum('restMin', 5), 1, 30)

export async function askRest(t) {
  const mins = restMins()
  if (!await confirmAction(`「${t.name}」已跑 ${fmtElapsed(liveElapsed(t))}，休息 ${mins} 分钟？结束时会自动继续计时。`)) return
  startRest(t.id)
}

export function startRest(taskId) {
  rest = { endAt: serverNow() + restMins() * 6e4, taskId, total: restMins() * 6e4 }
  $('rest').classList.remove('hidden')
  renderRest()
  // 解锁必须在任何 await 之前做：Safari 只认用户手势那一次同步调用，先进音乐帧再填地址
  unlockAudio()
  // 外面已经听着呢：不打断，也不再调 playCurrent（否则这首会被从头放起）
  if (queue && !audioEl().paused) { music.owner = 'user'; return }
  musicAutoplay()
}

// auto=true 是倒计时走完，否则是手动提前结束
export function endRest(auto) {
  const r = rest
  rest = null
  $('rest').classList.add('hidden')
  if (!r) return
  // 只有“休息替他自动开”的那部分才收掉；他自己点开的听歌要继续留在页面上
  if (music.owner === 'rest') musicStop()
  if (auto) { beep(); toast('休息结束，已继续计时') }
  else toast('已提前结束休息')
  const t = tasks.find((x) => x.id === r.taskId)
  // 只接回“确实因为休息而暂停”的任务，用户中途点了重置/完成就不去动它
  if (t && t.status === 'paused') act(r.taskId, 'resume')
}

export function renderRest() {
  if (!rest) return
  const left = Math.max(0, rest.endAt - serverNow())
  $('rest-time').textContent = fmtElapsed(left)
  $('rest-fill').style.width = `${(100 * (1 - left / Math.max(1, rest.total))).toFixed(2)}%`
  const t = tasks.find((x) => x.id === rest.taskId)
  $('rest-sub').textContent = t ? `休息结束后继续「${t.name}」` : '休息结束后回列表选任务'
  if (left <= 0) endRest(true)
}

function syncRestLenText() { $('rest-len-text').textContent = `${restMins()} 分钟` }

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('btn-rest-add').onclick = () => {
    if (!rest) return
    rest.endAt += 6e4
    rest.total += 6e4 // 进度条跟着重新算，否则加了时长反而看起来“快完了”
    renderRest()
  }

  $('btn-rest-end').onclick = () => endRest(false)

  $('rest-len').value = restMins()

  syncRestLenText()

  $('rest-len').addEventListener('input', () => {
    localStorage.setItem('restMin', $('rest-len').value)
    syncRestLenText()
    if (rest) { // 正在休息时改滑块：按新时长重算剩下的，比“多出的分钟数”直观
      const total = restMins() * 6e4
      rest.endAt = serverNow() + total
      rest.total = total
      renderRest()
    }
  })

}

/* 这几个状态会被别的模块整体重新赋值。ESM 的 import 绑定只读（能读不能写），
 * 所以写一律走这里的 setter：读的人 import 名字，拿到的永远是最新值。 */
export function setRest(v) { rest = v }
