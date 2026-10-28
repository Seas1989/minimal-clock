/* ---------- 渲染：任务列表（排序 + 分组） ---------- */

import { $, REC_LABEL, selectedId, taskList, tasks } from './state.js'
import { taskState } from './utils.js'
import { act, deleteTask, selectTask } from './task-actions.js'
import { openChallenge, openShare } from './challenges.js'
import { toggleWindow } from './dock.js'

const STATUS_ICON = { running: '⏸', paused: '▶', stopped: '▶', done: '' }
const STATUS_ORDER = { running: 0, paused: 1, stopped: 2, done: 3 }

export function renderTasks() {
  taskList.innerHTML = ''
  if (!tasks.length) {
    taskList.innerHTML = '<div class="empty-tip">暂无任务，去上方新建一个吧</div>'
    return
  }
  const sortFn = (a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.createdAt - b.createdAt)
  tasks.slice().sort(sortFn).forEach((t) => taskList.appendChild(taskItem(t)))
}

export function groupLabel(text) {
  const d = document.createElement('div')
  d.className = 'group-label'
  d.textContent = text
  return d
}

function taskItem(t) {
  const div = document.createElement('div')
  div.className = 'task-item' + (t.id === selectedId ? ' selected' : '') + (t.window ? ' win' : '')

  const top = document.createElement('div')
  top.className = 'task-top'

  const name = document.createElement('span')
  name.className = 'task-name'
  let label = t.name
  if (t.recurrence && t.recurrence !== 'none') label += ` ↻${REC_LABEL[t.recurrence]}`
  name.textContent = label
  top.appendChild(name)

  const actions = document.createElement('div')
  actions.className = 'task-actions'
  const isRecurring = t.recurrence && t.recurrence !== 'none'
  if (t.status !== 'done' || isRecurring) {
    const play = document.createElement('button')
    play.className = 'icon-btn'
    play.textContent = STATUS_ICON[t.status] || '⏸'
    play.title = t.status === 'running' ? '暂停' : '开始'
    play.onclick = (e) => {
      e.stopPropagation()
      act(t.id, t.status === 'running' ? 'pause' : t.status === 'paused' ? 'resume' : 'start')
    }
    actions.appendChild(play)
  }

  const win = document.createElement('button')
  win.className = 'icon-btn' + (t.window ? ' on' : '')
  win.textContent = '▢'
  win.title = t.window ? '从窗口坞收起（后台继续计时）' : '挂到窗口坞：和别的任务同时计时'
  win.onclick = (e) => { e.stopPropagation(); toggleWindow(t.id) }
  actions.appendChild(win)

  const share = document.createElement('button')
  share.className = 'icon-btn'
  share.textContent = t.challenge ? '⚑' : '↗'
  share.title = t.challenge ? '查看同任务挑战' : '发起同任务挑战'
  share.onclick = (e) => { e.stopPropagation(); t.challenge ? openChallenge(t.challenge) : openShare(t.id) }
  actions.appendChild(share)

  const del = document.createElement('button')
  del.className = 'icon-btn'
  del.textContent = '✕'
  del.title = '删除'
  del.onclick = (e) => { e.stopPropagation(); deleteTask(t.id) }
  actions.appendChild(del)

  top.appendChild(actions)

  const time = document.createElement('div')
  time.className = 'task-time'
  time.id = `tt-${t.id}`

  div.appendChild(top)
  div.appendChild(time)
  div.onclick = () => selectTask(t.id)
  return div
}

export function tickTaskTimes() {
  tasks.forEach((t) => {
    const el = $(`tt-${t.id}`)
    if (el) el.textContent = `${t.type === 'countdown' ? '⏳' : '⏱'} ${taskState(t).text}`
  })
}
