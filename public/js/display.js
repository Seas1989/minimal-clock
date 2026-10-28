/* ---------- 渲染：主显示区 + 进度环 ---------- */

import { $, RING_C, WEEK, bigTime, mode, notified, ringFg, selectedId, subTime, tasks, titleFlash } from './state.js'
import { notifyComplete } from './ui.js'
import { clamp } from './background.js'
import { liveElapsed, pad, serverNow, taskState } from './utils.js'
import { act, deleteTask } from './task-actions.js'
import { tickWindows } from './dock.js'
import { tickFocus } from './focus.js'
import { rest, startRest } from './rest.js'

export function selectedTask() {
  return tasks.find((t) => t.id === selectedId) || null
}

function updateRing(frac) {
  const f = Math.max(0, Math.min(1, frac || 0))
  ringFg.style.strokeDasharray = RING_C
  ringFg.style.strokeDashoffset = RING_C * (1 - f)
}

export function renderTimerPanel() {
  const controls = $('timer-controls')
  if (mode === 'clock') {
    $('clock-panel').classList.remove('hidden')
    $('timer-panel').classList.add('hidden')
    return
  }
  $('clock-panel').classList.add('hidden')
  $('timer-panel').classList.remove('hidden')
  $('duration-inputs').classList.toggle('hidden', mode !== 'countdown')
  $('recurrence').classList.toggle('hidden', mode !== 'countdown')
  $('btn-create').textContent = mode === 'countdown' ? '＋ 新建倒计时' : '＋ 新建正计时'

  const t = selectedTask()
  if (!t) { controls.innerHTML = ''; return }
  controlButtons(controls, t)
}

// 控制按钮：主面板和专注层共用一份，避免两处逻辑漂移
function controlBtn(box, label, onclick, solid) {
  const b = document.createElement('button')
  b.className = 'ctrl-btn' + (solid ? ' solid' : '')
  b.textContent = label
  b.onclick = onclick
  box.appendChild(b)
}

export function controlButtons(box, t) {
  box.innerHTML = ''
  if (t.status === 'stopped') controlBtn(box, '开始', () => act(t.id, 'start'), true)
  else if (t.status === 'running') controlBtn(box, '暂停', () => act(t.id, 'pause'), true)
  else if (t.status === 'paused') {
    controlBtn(box, '继续', () => act(t.id, 'resume'), true)
    // 之前选了“不休息”，也得有地方能手动开始休息
    if (t.type === 'stopwatch' && !rest) controlBtn(box, '休息', () => startRest(t.id))
  }
  if (t.status !== 'stopped') {
    controlBtn(box, '重置', () => act(t.id, 'reset'))
    controlBtn(box, '完成', () => act(t.id, 'complete'))
    controlBtn(box, '删除', () => deleteTask(t.id))
  }
}

export function tickDisplay() {
  const now = new Date(serverNow())
  updateToday(now)
  tickWindows()
  tickFocus()
  if (mode === 'clock') {
    bigTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    subTime.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日  ${WEEK[now.getDay()]}`
    updateRing(now.getSeconds() / 60)
    setTitle(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`)
    return
  }
  const t = selectedTask()
  if (!t) {
    bigTime.textContent = '00:00'
    subTime.textContent = '选择或创建一个任务'
    updateRing(0)
    setTitle('')
    return
  }
  const st = taskState(t)
  bigTime.textContent = st.text
  subTime.textContent = `${t.name} · ${st.sub}`
  updateRing(st.frac)
  setTitle(st.text)
}

function setTitle(timeText) {
  if (titleFlash) { document.title = titleFlash; return }
  document.title = timeText ? `${timeText} · 时钟` : '时钟'
}

// 今日进度条：填充主卡片下部空间，也让时间过得“看得见”
function updateToday(now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const passed = serverNow() - dayStart
  const pct = clamp(passed / 864e5 * 100, 0, 100)
  $('today-fill').style.width = `${pct.toFixed(2)}%`
  const left = 864e5 - passed
  $('today-text').textContent = `今天已过 ${pct.toFixed(0)}% · 剩余 ${Math.floor(left / 36e5)} 时 ${Math.floor((left % 36e5) / 6e4)} 分`
}

// 完成检测：倒计时归零时提醒一次
export function checkCompletion() {
  tasks.forEach((t) => {
    if (t.type !== 'countdown') return
    if (t.recurrence && t.recurrence !== 'none') return
    if (t.status !== 'running') { notified.delete(t.id); return }
    const remain = t.duration - liveElapsed(t)
    if (remain <= 0 && !notified.has(t.id)) {
      notified.add(t.id)
      notifyComplete(t)
    } else if (remain > 0) {
      notified.delete(t.id)
    }
  })
}
