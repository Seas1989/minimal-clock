/* ---------- 通用 UI：Toast / 确认弹窗 / 提示音 ---------- */

import { $, setTitleFlash } from './state.js'

let toastTimer = null
export function toast(msg) {
  const el = $('toast')
  el.textContent = msg
  el.classList.remove('hidden')
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.classList.remove('show')
    el.classList.add('hidden')
  }, 2600)
}

let confirmResolve = null
export function confirmAction(message) {
  $('confirm-text').textContent = message
  $('confirm-modal').classList.remove('hidden')
  return new Promise((resolve) => { confirmResolve = resolve })
}
export function closeConfirm(result) {
  $('confirm-modal').classList.add('hidden')
  if (confirmResolve) { confirmResolve(result); confirmResolve = null }
}
let audioCtx = null
export function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const t0 = audioCtx.currentTime
    ;[880, 660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const start = t0 + i * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      osc.connect(gain).connect(audioCtx.destination)
      osc.start(start)
      osc.stop(start + 0.18)
    })
  } catch { /* 忽略音频错误 */ }
}

/* 结算画面：只在“带挑战的倒计时”跑完时弹，平时仍然只有一条 toast。
 * 它只负责把话摆出来：名次怎么算、点「看排行」进哪个挑战，都归挑战那个模块定 */
let resultId = null
export function showResult({ title, rank, gap, challengeId }) {
  $('result-title').textContent = title
  $('result-rank').textContent = rank
  $('result-gap').textContent = gap || ''
  $('result-gap').classList.toggle('hidden', !gap)
  $('btn-result-rank').classList.toggle('hidden', !challengeId)
  resultId = challengeId || null
  $('result-modal').classList.remove('hidden')
}
export const resultChallengeId = () => resultId
export function closeResult() {
  $('result-modal').classList.add('hidden')
  resultId = null
}

export function notifyComplete(task, result) {
  beep()
  setTitleFlash(`⏰ ${task.name} 完成！`)
  setTimeout(() => { setTitleFlash('') }, 6000)
  // 带挑战的倒计时跑完才弹结算画面（最终名次 + 与第一名的差距）；平时只留一条 toast，不该拿弹窗拦人
  if (result) showResult(result)
  else toast(`⏰ 「${task.name}」已完成`)
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('btn-confirm-yes').onclick = () => closeConfirm(true)

  $('btn-confirm-no').onclick = () => closeConfirm(false)

  $('confirm-modal').addEventListener('click', (e) => { if (e.target.id === 'confirm-modal') closeConfirm(false) })

  $('btn-result-close').onclick = closeResult

  $('result-modal').addEventListener('click', (e) => { if (e.target.id === 'result-modal') closeResult() })

}
