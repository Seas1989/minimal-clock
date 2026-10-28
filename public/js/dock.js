/* ---------- 计时窗口坞：同屏多开，点窗切换、× 收起（后台继续跑） ---------- */

import { $, focusId, mode, selectedId, tasks } from './state.js'
import { toast } from './ui.js'
import { api, taskState } from './utils.js'
import { setSelection } from './task-actions.js'
import { renderTasks } from './task-list.js'
import { enterFocus } from './focus.js'
import { setMode } from './tabs.js'

export const dockTasks = () => tasks.filter((t) => t.window)
export const focusTask = () => tasks.find((t) => t.id === focusId) || null

export async function setWindow(id, open) {
  await api(`/api/tasks/${id}/window`, { method: 'POST', body: JSON.stringify({ open }) })
  const t = tasks.find((x) => x.id === id)
  if (t) t.window = open
  renderDock()
  renderTasks()
}

export async function toggleWindow(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  try {
    await setWindow(id, !t.window)
    // 挂上窗口就直接切到它（所见即所得）；收起时如果正显示着就回到“没选中”
    if (t.window) pickWindow(id)
    else if (selectedId === id) setSelection(null)
  } catch (e) { toast(e.message) }
}

// 点窗口 = 决定当前界面走哪个计时；类型不同得先切到对应标签页，否则大表盘不显示它
function pickWindow(id) {
  const t = tasks.find((x) => x.id === id)
  if (!t) return
  if (mode !== t.type) setMode(t.type)
  setSelection(id)
}

export function renderDock() {
  const box = $('dock')
  const list = dockTasks()
  box.innerHTML = ''
  box.classList.toggle('hidden', !list.length)
  list.forEach((t) => {
    const w = document.createElement('div')
    w.className = 'twin' + (t.id === selectedId ? ' active' : '') + (t.status === 'running' ? ' live' : '')

    const head = document.createElement('div')
    head.className = 'twin-head'
    const name = document.createElement('span')
    name.className = 'twin-name'
    name.textContent = t.name
    head.appendChild(name)

    const fs = document.createElement('button')
    fs.className = 'twin-btn'
    fs.textContent = '⤢'
    fs.title = '专注这个窗口（其余全部雾化）'
    fs.onclick = (e) => { e.stopPropagation(); enterFocus(t.id) }
    head.appendChild(fs)

    const cl = document.createElement('button')
    cl.className = 'twin-btn close'
    cl.textContent = '✕'
    cl.title = '收起窗口（后台继续计时）'
    cl.onclick = (e) => { e.stopPropagation(); toggleWindow(t.id) }
    head.appendChild(cl)

    const time = document.createElement('div')
    time.className = 'twin-time'
    time.id = `dw-${t.id}`

    w.appendChild(head)
    w.appendChild(time)
    w.onclick = () => pickWindow(t.id)
    box.appendChild(w)
  })
  tickWindows()
}

// 窗口坞和专注层不属于“当前选中的那个任务”：没被选中的窗也要一秒一秒跳
export function tickWindows() {
  dockTasks().forEach((t) => {
    const el = $(`dw-${t.id}`)
    if (el) el.textContent = taskState(t).text
  })
}
