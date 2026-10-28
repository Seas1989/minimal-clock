/* ---------- 主题与文字对比度自适应 ---------- */

import { bg } from './background.js'

const THEMES = [
  { id: 'paper', bg: '#f7f7f5', dot: '#f0f0ec' },
  { id: 'sand', bg: '#f4e8dc', dot: '#e8d5c0' },
  { id: 'mist', bg: '#dce8e4', dot: '#c4d8d2' },
  { id: 'lavender', bg: '#e4e0f0', dot: '#cfc8e8' },
  { id: 'night', bg: '#16161a', dot: '#16161a' },
]

const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
const hexLuma = (hex) => { const n = parseInt(hex.slice(1), 16); return lumaOf((n >> 16) & 255, (n >> 8) & 255, n & 255) }

let currentTheme = THEMES[0]
export let imgLuma = null // 背景图平均亮度（0~255），跳域无法采样时为 null

export function applyTheme(theme) {
  currentTheme = theme
  const root = document.documentElement.style
  root.setProperty('--bg', theme.bg)
  localStorage.setItem('theme', theme.id)
  updateContrast()
}

// 手机浏览器地址栏 / 任务切换器配色：不往 HTML 里塞静态标签，切主题时动态同步
function syncBrowserColor(hex) {
  let m = document.querySelector('meta[name="theme-color"]')
  if (!m) {
    m = document.createElement('meta')
    m.name = 'theme-color'
    document.head.appendChild(m)
  }
  m.content = hex
}

// 文字颜色不能只看主题：有背景图时要按“卡片实际可见亮度”判定
// 可见亮度 = 卡片底色×浓度 + 背景图亮度×(1-遮罩)×(1-浓度)
export function updateContrast() {
  const root = document.documentElement.style
  const themeL = hexLuma(currentTheme.bg)
  const cardA = bg.card
  let cardLuma = themeL // 无图时就是主题背景
  let pageLuma = themeL

  if (bg.img) {
    const imgEff = (imgLuma == null ? 120 : imgLuma) * (1 - bg.dim * 0.92) // 经过黑色遮罩压暗
    const cardBase = themeL > 140 ? 248 : 22 // 卡片基色仍跟随主题明暗
    cardLuma = cardA * cardBase + (1 - cardA) * imgEff
    pageLuma = imgEff // 卡片外（顶栏）直接落在背景图上
    root.setProperty('--card-solid', (themeL > 140 ? 'rgba(255,255,255,' : 'rgba(20,20,24,') + cardA + ')')
  }

  // 自动：亮度低则用浅色字；手动优先
  const lightText = bg.fgMode === 'light' ? true : bg.fgMode === 'dark' ? false : cardLuma < 150

  root.setProperty('--fg', lightText ? '#f5f5f5' : '#1a1a1a')
  root.setProperty('--fg-weak', lightText ? 'rgba(245,245,245,.62)' : 'rgba(26,26,26,.55)')
  root.setProperty('--card', lightText ? 'rgba(245,245,245,.06)' : 'rgba(26,26,26,.04)')
  root.setProperty('--line', lightText ? 'rgba(245,245,245,.16)' : 'rgba(26,26,26,.1)')
  // 顶栏等卡在背景上的元素，用背景亮度单独定色，避免“深色背景 + 深色字”看不见
  root.setProperty('--fg-out', pageLuma < 150 ? 'rgba(245,245,245,.9)' : 'rgba(26,26,26,.85)')
  root.setProperty('--fg-out-weak', pageLuma < 150 ? 'rgba(245,245,245,.6)' : 'rgba(26,26,26,.55)')
  // 有背景图时页面主色就是图（压暗后的均值），否则就是主题底色
  syncBrowserColor(bg.img ? (pageLuma < 150 ? '#101014' : '#e9e9e6') : currentTheme.bg)

  document.querySelectorAll('#fg-mode-group button').forEach((b) => b.classList.toggle('active', b.dataset.fg === bg.fgMode))
}

// 采样背景图平均亮度（外链允许时），失败不阻断
export function sampleImageLuma(url) {
  imgLuma = null
  if (!url) { updateContrast(); return }
  const im = new Image()
  im.crossOrigin = 'anonymous'
  im.onload = () => {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 24
      const ctx = c.getContext('2d')
      ctx.drawImage(im, 0, 0, 24, 24)
      const d = ctx.getImageData(0, 0, 24, 24).data
      let sum = 0, n = 0
      for (let i = 0; i < d.length; i += 4) { sum += lumaOf(d[i], d[i + 1], d[i + 2]); n++ }
      imgLuma = sum / n
    } catch { imgLuma = null } // 跳域 tainted canvas：退回中性估计
    updateContrast()
  }
  im.onerror = () => { imgLuma = null; updateContrast() }
  im.src = url
}

const picker = document.getElementById('theme-picker')
export const savedTheme = THEMES.find((t) => t.id === localStorage.getItem('theme')) || THEMES[0]

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  THEMES.forEach((t) => {
    const dot = document.createElement('button')
    dot.className = 'theme-dot'
    dot.style.background = t.dot
    dot.title = '切换主题'
    dot.onclick = () => {
      applyTheme(t)
      document.querySelectorAll('.theme-dot').forEach((d) => d.classList.remove('active'))
      dot.classList.add('active')
    }
    picker.appendChild(dot)
  })

  picker.children[THEMES.indexOf(savedTheme)].classList.add('active')

}

/* 这几个状态会被别的模块整体重新赋值。ESM 的 import 绑定只读（能读不能写），
 * 所以写一律走这里的 setter：读的人 import 名字，拿到的永远是最新值。 */
export function setImgLuma(v) { imgLuma = v }
