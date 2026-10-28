/* ---------- 任务操作 ---------- */

import { $, focusId, mode, selectedId, setSelectedId, setTasks, tasks } from './state.js'
import { confirmAction, toast } from './ui.js'
import { api } from './utils.js'
import { renderTimerPanel, tickDisplay } from './display.js'
import { renderTasks } from './task-list.js'
import { dockTasks, renderDock, setWindow } from './dock.js'
import { exitFocus, renderFocus } from './focus.js'
import { askRest, rest } from './rest.js'

export async function refresh() {
  try {
    setTasks(await api('/api/tasks'))
  } catch { return }
  if (selectedId && !tasks.some((t) => t.id === selectedId)) setSelectedId(null)
  if (focusId && !tasks.some((t) => t.id === focusId)) exitFocus()
  renderTasks()
  renderDock()
  renderTimerPanel()
  if (focusId) renderFocus()
}

export async function act(id, action) {
  try {
    await api(`/api/tasks/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) })
    await refresh()
    // 暂停入口有三处（控制面板 / 任务行 / 空格），询问休息只放在 act 里，一处也不会漏
    const t = tasks.find((x) => x.id === id)
    if (action === 'pause' && t && t.type === 'stopwatch' && !rest) askRest(t)
  } catch (e) { toast(e.message) }
}

export async function createTask() {
  const name = $('task-name').value.trim()
  let duration = 0
  let recurrence = 'none'
  if (mode === 'countdown') {
    duration =
      (Number($('task-day').value) || 0) * 864e5 +
      (Number($('task-hour').value) || 0) * 36e5 +
      (Number($('task-min').value) || 0) * 6e4 +
      (Number($('task-sec').value) || 0) * 1e3
    recurrence = $('recurrence').value
    if (duration <= 0) return toast('请设置倒计时的时长')
  }
  try {
    const task = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ name, type: mode, duration, recurrence }),
    })
    $('task-name').value = ''
    setSelectedId(task.id)
    toast(`已创建「${task.name}」`)
    // 窗口坞还空着：新任务直接挂上去，省得用户再点一次
    if (!dockTasks().length) await setWindow(task.id, true)
    await act(task.id, 'start')
  } catch (e) { toast(e.message) }
}

export async function deleteTask(id) {
  const t = tasks.find((x) => x.id === id)
  if (!await confirmAction(`确定删除任务「${t ? t.name : ''}」？`)) return
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' })
    if (selectedId === id) setSelectedId(null)
    toast('已删除')
    await refresh()
  } catch (e) { toast(e.message) }
}

/* selectTask 已经没了：任务行现在整行就是「进专注」的入口（task-list.js），
 * 旧的“点一下只是选中、clock 页下点了还根本不动”这条路不再存在 */

// 换选中任务后要刷新的四处（列表高亮 / 窗口坞 / 控制面板 / 大表盘）集中在这里，
// 免得以后新增一处渲染就漏一处
export function setSelection(id) {
  setSelectedId(id)
  renderTasks()
  renderDock()
  renderTimerPanel()
  tickDisplay()
}
