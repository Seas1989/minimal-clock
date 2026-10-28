/* ---------- 渲染：任务列表（排序 + 分组） ---------- */

import { $, REC_LABEL, selectedId, taskList, tasks } from './state.js'
import { taskState } from './utils.js'
import { act, deleteTask } from './task-actions.js'
import { openChallenge, openShare } from './challenges.js'
import { toggleWindow } from './dock.js'
import { enterFocus } from './focus.js'

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

// 图标按钮统一造：play 键需要两个字形叠在一起做交叉淡入，不能只换一个字符
function iconBtn(ico, title) {
  const b = document.createElement('button')
  b.className = 'icon-btn'
  b.title = title
  const s = document.createElement('span')
  s.textContent = ico
  b.appendChild(s)
  return b
}

function playBtn(running) {
  const b = document.createElement('button')
  b.className = 'icon-btn play-btn' + (running ? ' on' : '')
  b.title = running ? '暂停' : '开始并进专注'
  const mk = (cls, ico) => {
    const s = document.createElement('span')
    s.className = `ico ${cls}`
    s.textContent = ico
    b.appendChild(s)
  }
  mk('ico-play', '▶')
  mk('ico-pause', '⏸')
  return b
}

function taskItem(t) {
  const div = document.createElement('div')
  div.className = 'task-item' + (t.id === selectedId ? ' selected' : '') + (t.window ? ' win' : '')

  const top = document.createElement('div')
  top.className = 'task-top'

  const name = document.createElement('span')
  name.className = 'task-name'
  name.textContent = t.name
  top.appendChild(name)

  const isRecurring = t.recurrence && t.recurrence !== 'none'
  if (isRecurring) {
    // 原来这里拼的是「↻每周」，那个 ↻ 看着就像一个重新加载按钮（其实根本点不动）：改成一个弱色小 chip
    const chip = document.createElement('span')
    chip.className = 'task-rec'
    chip.textContent = REC_LABEL[t.recurrence]
    top.appendChild(chip)
  }

  const actions = document.createElement('div')
  actions.className = 'task-actions'
  if (t.status !== 'done' || isRecurring) {
    const play = playBtn(t.status === 'running')
    play.onclick = (e) => {
      e.stopPropagation()
      // 播放/继续与整行同一条路：开起来就进专注；暂停那么就地停住，不顺手把人塞进全屏层（问不休息的弹窗会被盖住）
      if (t.status === 'running') void act(t.id, 'pause')
      else { void act(t.id, t.status === 'paused' ? 'resume' : 'start'); enterFocus(t.id) }
    }
    actions.appendChild(play)
  }

  const win = iconBtn('▢', t.window ? '从窗口坞收起（后台继续计时）' : '挂到窗口坞：和别的任务同时计时')
  if (t.window) win.classList.add('on')
  win.onclick = (e) => { e.stopPropagation(); toggleWindow(t.id) }
  actions.appendChild(win)

  const share = iconBtn(t.challenge ? '⚑' : '↗', t.challenge ? '查看同任务挑战' : '发起同任务挑战')
  share.onclick = (e) => { e.stopPropagation(); t.challenge ? openChallenge(t.challenge) : openShare(t.id) }
  actions.appendChild(share)

  const del = iconBtn('✕', '删除')
  del.onclick = (e) => { e.stopPropagation(); deleteTask(t.id) }
  actions.appendChild(del)

  top.appendChild(actions)

  const time = document.createElement('div')
  time.className = 'task-time'
  time.id = `tt-${t.id}`

  div.appendChild(top)
  div.appendChild(time)
  // 整行都是入口：点到名字、时间、行里任何空白都直接进专注，不再需要一个「查看」
  div.onclick = () => enterFocus(t.id)
  return div
}

export function tickTaskTimes() {
  tasks.forEach((t) => {
    const el = $(`tt-${t.id}`)
    if (el) el.textContent = `${t.type === 'countdown' ? '⏳' : '⏱'} ${taskState(t).text}`
  })
}
