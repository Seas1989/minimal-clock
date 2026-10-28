/* ---------- 快捷键 ---------- */

import { $, focusId, mode, token } from './state.js'
import { closeConfirm, closeResult } from './ui.js'
import { act } from './task-actions.js'
import { closeChallenge, closeHub, closeShare } from './challenges.js'
import { selectedTask } from './display.js'
import { exitFocus } from './focus.js'
import { endRest, rest } from './rest.js'
import { toggleListen } from './music.js'
import { toggleQueuePanel } from './music-queue.js'
import { closeMusic } from './music-modal.js'
import { mobDrawer, setDrawer } from './mobile-shell.js'

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return
    if (e.key === 'Escape') {
      // 一层层退出：手机端抽屉 > 确认框 > 结算画面 > 休息 > 专注 > 挑战详情 > 挑战列表 > 音乐弹窗 > 发起挑战弹窗，不能一上来就把专注关掉
      if (mobDrawer) { setDrawer(false); return }
      if (!$('confirm-modal').classList.contains('hidden')) { closeConfirm(false); return }
      if (!$('result-modal').classList.contains('hidden')) { closeResult(); return }
      if (rest) { endRest(false); return }
      if (focusId) { exitFocus(); return }
      if (!$('challenge-modal').classList.contains('hidden')) { closeChallenge(); return }
      if (!$('challenge-hub').classList.contains('hidden')) { closeHub(); return }
      if (!$('queue-pop').classList.contains('hidden')) { toggleQueuePanel(false); return }
      if (!$('music-modal').classList.contains('hidden')) { closeMusic(); return }
      closeShare()
      return
    }
    if (e.code === 'Space' && token && mode !== 'clock') {
      e.preventDefault()
      const t = selectedTask()
      if (t) act(t.id, t.status === 'running' ? 'pause' : t.status === 'paused' ? 'resume' : 'start')
    }
    // M 切听歌：不用先选任务也不用开弹窗；Ctrl / ⌘ 的组合让给浏览器
    if ((e.key === 'm' || e.key === 'M') && token && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      void toggleListen()
    }
  })

}
