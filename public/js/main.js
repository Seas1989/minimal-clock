/* ---------- 启动：校验登录态 ---------- */

import { init as initTheme } from './theme.js'
import { token } from './state.js'
import { init as initUi } from './ui.js'
import { init as initBackground } from './background.js'
import { api } from './utils.js'
import { enterApp, logout, showView, init as initAuth } from './auth.js'
import './task-actions.js'
import './friends.js'
import { init as initChallenges } from './challenges.js'
import './display.js'
import './task-list.js'
import './dock.js'
import { init as initFocus } from './focus.js'
import { init as initRest } from './rest.js'
import { init as initMusic } from './music.js'
import './music-queue.js'
import { init as initMusicModal } from './music-modal.js'
import { init as initTabs } from './tabs.js'
import { init as initShortcuts } from './shortcuts.js'
import { init as initMobileShell } from './mobile-shell.js'
import './layout.js'
import { init as initPanelDrag } from './panel-drag.js'
import { init as initHeartbeat } from './heartbeat.js'

/* 各模块的接线按原 app.js 的先后顺序跑：主题先于背景（applyTheme 要读背景参数），
 * 布局先于拖拽，标签页先于快捷键。这一段就是原来 app.js 结尾的启动流程。 */
initTheme()
initUi()
initBackground()
initAuth()
initChallenges()
initFocus()
initRest()
initMusic()
initMusicModal()
initTabs()
initShortcuts()
initMobileShell()
initPanelDrag()
initHeartbeat()

;(async () => {
  if (!token) { showView(false); return }
  try {
    const me = await api('/api/me')
    enterApp(me.username)
  } catch {
    logout()
  }
})()
