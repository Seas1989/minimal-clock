/* ---------- 面板布局：抽边框拖拽重排 + 果冻/撕纸动画 ---------- */

/* 挑战不在这一摞里：它收在顶栏「⚑ 挑战」的浮层，主界面不摆卡片（旧存档里残留的 challenges 会被 clean 掉）*/
const PANELS = ['display', 'tasks', 'friends']
export const DEFAULT_LAYOUT = { mode: 'classic', a: ['display'], b: ['tasks', 'friends'], sideW: 300 }

function loadLayout() {
  let l = null
  try { l = JSON.parse(localStorage.getItem('layoutV2')) } catch { /* 数据坏了就用默认 */ }
  if (!l || !Array.isArray(l.a) || !Array.isArray(l.b)) return { ...DEFAULT_LAYOUT }
  const clean = (arr) => {
    const out = []
    arr.forEach((p) => { if (PANELS.includes(p) && !out.includes(p)) out.push(p) })
    return out
  }
  const a = clean(l.a)
  const b = clean(l.b)
  // 旧存档里没有新面板：追到最后一栏，而不是把用户排好的顺序整体重置
  PANELS.forEach((p) => { if (!a.includes(p) && !b.includes(p)) b.push(p) })
  if (!a.length) a.push('display')
  return { mode: ['classic', 'left', 'stack'].includes(l.mode) ? l.mode : 'classic', a, b, sideW: Number(l.sideW) || DEFAULT_LAYOUT.sideW }
}

export let layout = loadLayout()
export const panelEl = (id) => document.querySelector(`.card[data-panel="${id}"]`)
export function saveLayout() { localStorage.setItem('layoutV2', JSON.stringify(layout)) }

/* 这几个状态会被别的模块整体重新赋值。ESM 的 import 绑定只读（能读不能写），
 * 所以写一律走这里的 setter：读的人 import 名字，拿到的永远是最新值。 */
export function setLayout(v) { layout = v }
