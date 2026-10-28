/* ---------- 自定义背景（可拖拽框选 / 缩放 / 适配，存 localStorage）---------- */

import { applyTheme, sampleImageLuma, savedTheme, setImgLuma, updateContrast } from './theme.js'
import { $ } from './state.js'
import { toast } from './ui.js'

export const lsNum = (key, def) => { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && localStorage.getItem(key) !== null ? v : def }

export const bg = {
  img: localStorage.getItem('bgImage') || '',
  fit: localStorage.getItem('bgFit') || 'cover',
  zoom: lsNum('bgZoom', 100),
  fx: lsNum('bgFx', 0.5),   // 焦点：0=只看图片顶部，0.5=中部，1=底部
  fy: lsNum('bgFy', 0.5),
  blur: lsNum('bgBlur', 0), // 背景模糊像素
  dim: (lsNum('bgDim', 30)) / 100,
  card: (lsNum('bgCard', 72)) / 100,           // 卡片浓度（越浓文字越好读）
  fgMode: localStorage.getItem('bgFgMode') || 'auto', // auto | dark(深色字) | light(浅色字)
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const nat = { w: 0, h: 0 } // 图片原始尺寸，用于几何取景计算

// fx/fy：焦点取景（背景定位语义）——0 对齐图片上/左边，1 对齐下/右边，0.5 居中。
// 放大后可通过 fy 直接选定“只看顶部 / 中部 / 底部”；几何只在视口坐标系算一次，
// 预览框用 transform scale 等比映射，小框严格镜像全屏
function imgGeom(w, h) {
  const base = (bg.fit === 'cover' ? Math.max(w / nat.w, h / nat.h) : Math.min(w / nat.w, h / nat.h)) * (bg.zoom / 100)
  const iw = nat.w * base, ih = nat.h * base
  const overX = Math.max(0, iw - w), overY = Math.max(0, ih - h) // 可裁切（可拖动）的行程
  const x = overX > 0 ? -overX * bg.fx : (w - iw) / 2
  const y = overY > 0 ? -overY * bg.fy : (h - ih) / 2
  return { iw, ih, x, y, overX, overY }
}

function placeImg(el, g) {
  if (!el) return
  el.style.width = `${g.iw}px`
  el.style.height = `${g.ih}px`
  el.style.left = `${g.x}px`
  el.style.top = `${g.y}px`
}

let previewScale = 1, previewOffX = 0, previewOffY = 0 // 预览框→视口坐标换算

let layoutQueued = false
function layoutBg() {
  if (layoutQueued) return
  layoutQueued = true
  requestAnimationFrame(() => {
    layoutQueued = false
    if (!nat.w) return
    const g = imgGeom(innerWidth, innerHeight)
    placeImg($('bg-img'), g)
    const prev = $('bg-prev')
    if (!$('bg-modal').classList.contains('hidden')) {
      const sc = prev.clientWidth / innerWidth
      const box = $('bg-prev-scale')
      previewScale = sc
      previewOffX = (prev.clientWidth - innerWidth * sc) / 2
      previewOffY = Math.min(0, (prev.clientHeight - innerHeight * sc) / 2)
      box.style.width = `${innerWidth}px`
      box.style.height = `${innerHeight}px`
      box.style.transform = `scale(${sc})`
      // 预览框比例被 clamp 偏离视口时，居中裁切多余部分
      box.style.left = `${previewOffX}px`
      box.style.top = `${previewOffY}px`
      placeImg($('bg-prev-img'), g) // 用视口坐标的同一组几何，小框严格镜像全屏
    }
  })
}

function sizePreview() {
  const box = $('bg-preview')
  box.style.height = `${clamp(Math.round(box.clientWidth * (innerHeight / innerWidth)), 100, 260)}px`
  layoutBg()
}

function saveBg() {
  localStorage.setItem('bgFit', bg.fit)
  localStorage.setItem('bgZoom', bg.zoom)
  localStorage.setItem('bgFx', bg.fx)
  localStorage.setItem('bgFy', bg.fy)
  localStorage.setItem('bgBlur', bg.blur)
  localStorage.setItem('bgDim', Math.round(bg.dim * 100))
  localStorage.setItem('bgCard', Math.round(bg.card * 100))
  localStorage.setItem('bgFgMode', bg.fgMode)
}

function loadBgImg(url) {
  nat.w = 0; nat.h = 0
  sampleImageLuma(url)
  if (!url) return renderBg()
  const im = new Image()
  im.onload = () => { nat.w = im.naturalWidth; nat.h = im.naturalHeight; renderBg() }
  im.onerror = () => { toast('图片加载失败，请检查地址或换一张'); clearBg() }
  im.src = url
}

function renderBg() {
  document.documentElement.style.setProperty('--bg-dim', bg.dim)
  document.documentElement.style.setProperty('--bg-blur', `${bg.blur}px`)
  updateContrast()
  const layer = $('bg-layer'), img = $('bg-img')
  const prev = $('bg-prev'), prevImg = $('bg-prev-img'), empty = $('bg-prev-empty')
  if (bg.img && nat.w) {
    img.src = bg.img; prevImg.src = bg.img
    layer.classList.remove('hidden')
    document.body.classList.add('has-bg')
    prev.classList.remove('hidden'); empty.classList.add('hidden')
    sizePreview()
    layoutBg()
  } else {
    img.removeAttribute('src'); prevImg.removeAttribute('src')
    layer.classList.add('hidden')
    document.body.classList.remove('has-bg')
    prev.classList.add('hidden'); empty.classList.remove('hidden')
  }
  // 同步控件
  $('bg-dim').value = Math.round(bg.dim * 100)
  $('bg-zoom').value = bg.zoom
  $('bg-blur').value = bg.blur
  $('bg-card').value = Math.round(bg.card * 100)
  document.querySelectorAll('#bg-fit-group button').forEach((b) => b.classList.toggle('active', b.dataset.fit === bg.fit))
  if (typeof markPos === 'function') markPos()
}

function setBgImage(url) {
  try {
    localStorage.setItem('bgImage', url)
  } catch {
    toast('图片过大无法保存，请换小图或使用外链地址')
    return
  }
  bg.img = url
  bg.fx = 0.5; bg.fy = 0.5; bg.zoom = 100
  saveBg()
  loadBgImg(url)
}

function clearBg() {
  localStorage.removeItem('bgImage')
  bg.img = ''
  nat.w = 0; nat.h = 0
  setImgLuma(null)
  renderBg()
  toast('已清除背景')
}

function markPos() {
  document.querySelectorAll('#bg-pos-group button').forEach((b) => b.classList.toggle('active', Math.abs(Number(b.dataset.fy) - bg.fy) < 0.02))
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('btn-bg').onclick = () => { $('bg-modal').classList.remove('hidden'); sizePreview() }

  $('btn-bg-clear').onclick = clearBg

  $('btn-bg-close').onclick = () => $('bg-modal').classList.add('hidden')

  $('btn-bg-center').onclick = () => { bg.fx = 0.5; bg.fy = 0.5; bg.zoom = 100; saveBg(); layoutBg(); markPos() }

  // 快捷取景：上 / 中 / 下（放大后直接定位到想展示的那一段）
  document.querySelectorAll('#bg-pos-group button').forEach((btn) => {
    btn.onclick = () => {
      bg.fy = Number(btn.dataset.fy)
      saveBg(); layoutBg(); markPos()
    }
  })

  $('bg-modal').addEventListener('click', (e) => { if (e.target.id === 'bg-modal') $('bg-modal').classList.add('hidden') })

  $('bg-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = e.target.value.trim()
      if (v) { setBgImage(v); e.target.value = ''; toast('背景已更新') }
    }
  })

  $('bg-zoom').addEventListener('input', (e) => {
    bg.zoom = Number(e.target.value)
    saveBg(); layoutBg(); markPos()
  })

  $('bg-dim').addEventListener('input', (e) => {
    bg.dim = Number(e.target.value) / 100
    saveBg(); document.documentElement.style.setProperty('--bg-dim', bg.dim)
  })

  $('bg-blur').addEventListener('input', (e) => {
    bg.blur = Number(e.target.value)
    saveBg(); document.documentElement.style.setProperty('--bg-blur', `${bg.blur}px`)
  })

  $('bg-card').addEventListener('input', (e) => {
    bg.card = Number(e.target.value) / 100
    saveBg(); updateContrast()
  })

  document.querySelectorAll('#fg-mode-group button').forEach((btn) => {
    btn.onclick = () => { bg.fgMode = btn.dataset.fg; saveBg(); updateContrast() }
  })

  document.querySelectorAll('#bg-fit-group button').forEach((btn) => {
    btn.onclick = () => { bg.fit = btn.dataset.fit; saveBg(); layoutBg() }
  })

  $('bg-file').addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (!/^image\//.test(file.type)) return toast('请选择图片文件')
    const reader = new FileReader()
    reader.onload = () => { setBgImage(reader.result); toast('背景已更新') }
    reader.readAsDataURL(file)
    e.target.value = ''
  })

  // 预览框拖拽：按行程反算焦点，1:1 跟手；行程内自由移动，到图片上/下边缘自然停止
  ;(function () {
    const prev = $('bg-prev')
    let dragging = false, sx = 0, sy = 0, ofx = 0, ofy = 0
    prev.addEventListener('pointerdown', (e) => {
      if (!bg.img || !nat.w) return
      dragging = true; sx = e.clientX; sy = e.clientY; ofx = bg.fx; ofy = bg.fy
      prev.setPointerCapture(e.pointerId)
      e.preventDefault()
    })
    prev.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const g = imgGeom(innerWidth, innerHeight)
      const k = previewScale || 1
      const dx = (e.clientX - sx) / k, dy = (e.clientY - sy) / k // 换算回视口像素
      if (g.overX > 0) bg.fx = clamp(ofx - dx / g.overX, 0, 1)
      if (g.overY > 0) bg.fy = clamp(ofy - dy / g.overY, 0, 1)
      saveBg(); layoutBg(); markPos()
    })
    prev.addEventListener('pointerup', () => { dragging = false })
    prev.addEventListener('pointercancel', () => { dragging = false })
    // 双击：回到居中取景
    prev.addEventListener('dblclick', () => { bg.fx = 0.5; bg.fy = 0.5; saveBg(); layoutBg(); markPos() })
    // 滚轮：以光标位置为中心缩放，光标下方的画面点保持不动
    prev.addEventListener('wheel', (e) => {
      if (!bg.img || !nat.w) return
      e.preventDefault()
      const r = prev.getBoundingClientRect()
      const k0 = previewScale || 1
      const vx = ((e.clientX - r.left) - previewOffX) / k0
      const vy = ((e.clientY - r.top) - previewOffY) / k0
      const g = imgGeom(innerWidth, innerHeight)
      const ux = (vx - g.x) / g.iw, uy = (vy - g.y) / g.ih // 光标落在图上的相对位置 0~1
      const nz = clamp(bg.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 100, 400)
      bg.zoom = nz
      const g2 = imgGeom(innerWidth, innerHeight)
      // 由“图上位置不变”反解新焦点：vx = -overX * fx + ux * iw
      if (g2.overX > 0) bg.fx = clamp((ux * g2.iw - vx) / g2.overX, 0, 1)
      if (g2.overY > 0) bg.fy = clamp((uy * g2.ih - vy) / g2.overY, 0, 1)
      $('bg-zoom').value = bg.zoom
      saveBg(); layoutBg(); markPos()
    }, { passive: false })

  })()

  window.addEventListener('resize', () => { layoutBg(); if (!$('bg-modal').classList.contains('hidden')) sizePreview() })

  // 主题初始化必须在 bg 定义之后（updateContrast 需要读背景参数）
  applyTheme(savedTheme)

  if (bg.img) { loadBgImg(bg.img) } else { renderBg() }

}
