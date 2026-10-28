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

export function notifyComplete(task) {
  beep()
  toast(`⏰ 「${task.name}」已完成`)
  setTitleFlash(`⏰ ${task.name} 完成！`)
  setTimeout(() => { setTitleFlash('')}, 6000)
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('btn-confirm-yes').onclick = () => closeConfirm(true)

  $('btn-confirm-no').onclick = () => closeConfirm(false)

  $('confirm-modal').addEventListener('click', (e) => { if (e.target.id === 'confirm-modal') closeConfirm(false) })

}
