/* ---------- physics.js：零依赖微物理引擎 ----------
 * 只做四件事，够用就好：
 *   Spring / Spring2 —— 半隐式欧拉积分的弹簧，界面动力的“质量感”来源
 *   Ticker          —— 全局单条 rAF 心跳，所有弹簧共用，静止后自动停摆省电
 *   Tracker         —— 指针速度采样（指数平滑），给惯性甩动提供初速度
 *   rubber          —— iOS 风格的橡皮筋阻尼，拖出边界时越拉越沉而不是硬停
 * 挂到 window.Phys，无模块系统、无构建步骤。
 */
;(function () {
  'use strict'

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

  /* 一维弹簧：value 追 target，k 越大越硬，c 越小越弹
   * epsilon 是“静止判据”，量纲跟着 value —— 位移用像素、缩放就得用小数 */
  function Spring(value, opt) {
    const o = opt || {}
    this.k = o.stiffness == null ? 180 : o.stiffness
    this.c = o.damping == null ? 18 : o.damping
    this.m = o.mass == null ? 1 : o.mass
    this.eps = o.epsilon == null ? 0.06 : o.epsilon
    this.value = value || 0
    this.target = this.value
    this.vel = 0
  }
  // 半隐式欧拉：先算速度再算位移，比显式欧拉稳定，大步长也不炸
  Spring.prototype.step = function (dt) {
    const f = -this.k * (this.value - this.target) - this.c * this.vel
    this.vel += (f / this.m) * dt
    this.value += this.vel * dt
    if (Math.abs(this.target - this.value) < this.eps && Math.abs(this.vel) < this.eps * 12) {
      this.value = this.target
      this.vel = 0
      return true // 已静止
    }
    return false
  }
  Spring.prototype.kick = function (v) { this.vel += v }
  Spring.prototype.snap = function (v) { this.value = this.target = v; this.vel = 0 }
  // 把“当前位置”设为偏移量并让目标回到 0：布局跳变时用来接续视觉位置
  Spring.prototype.shift = function (d) { this.value += d; this.target = 0 }

  /* 二维弹簧 */
  function Spring2(x, y, opt) {
    this.x = new Spring(x, opt)
    this.y = new Spring(y, opt)
  }
  Spring2.prototype.step = function (dt) {
    const a = this.x.step(dt)
    const b = this.y.step(dt)
    return a && b
  }
  Spring2.prototype.set = function (x, y) { this.x.target = x; this.y.target = y }
  Spring2.prototype.kick = function (vx, vy) { this.x.kick(vx); this.y.kick(vy) }
  Spring2.prototype.snap = function (x, y) { this.x.snap(x); this.y.snap(y) }
  Spring2.prototype.shift = function (dx, dy) { this.x.shift(dx); this.y.shift(dy) }

  /* 全局心跳：订阅者每帧收到 dt（秒），返回 true 表示“我还要继续动” */
  const subs = new Set()
  let raf = 0
  let last = 0
  function loop(now) {
    let dt = (now - last) / 1000
    last = now
    if (dt > 0.064) dt = 0.064 // 切后台回来别一帧积分出巨大步长
    let busy = 0
    subs.forEach((fn) => { if (fn(dt)) busy++ })
    if (!busy) { raf = 0; last = 0; return } // 全部静止：停掉 rAF，不空转
    raf = requestAnimationFrame(loop)
  }
  const Ticker = {
    add(fn) {
      subs.add(fn)
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop) }
    },
    remove(fn) { subs.delete(fn) },
  }

  /* 指针速度采样：px/s，带指数平滑抑制单帧抖动 */
  function Tracker() { this.reset(0, 0) }
  Tracker.prototype.reset = function (x, y) {
    this.x = x
    this.y = y
    this.vx = 0
    this.vy = 0
    this.t = performance.now()
  }
  Tracker.prototype.push = function (x, y) {
    const now = performance.now()
    const dt = Math.max(8, now - this.t) / 1000
    const ivx = (x - this.x) / dt
    const ivy = (y - this.y) / dt
    const a = 0.3
    this.vx += a * (ivx - this.vx)
    this.vy += a * (ivy - this.vy)
    this.x = x
    this.y = y
    this.t = now
  }

  /* 橡皮筋：over 是超出边界的量，dim 是该方向可用尺寸，越拉越沉 */
  function rubber(over, dim, constant) {
    const c = constant == null ? 0.55 : constant
    if (!over) return 0
    const sign = over < 0 ? -1 : 1
    const a = Math.abs(over)
    return sign * ((1 - 1 / ((a * c) / dim + 1)) * dim)
  }

  window.Phys = { Spring, Spring2, Ticker, Tracker, rubber, clamp }
})()
