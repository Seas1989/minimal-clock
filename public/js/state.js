/* ---------- 状态 ---------- */

export const CYCLE = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5, yearly: 365 * 864e5 }
export const REC_LABEL = { none: '', daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年' }
export const RING_C = 2 * Math.PI * 92 // 进度环周长

export let token = localStorage.getItem('token') || null
export let tasks = []
export let friends = { friends: [], incoming: [], outgoing: [] }
export let mode = localStorage.getItem('mode') || 'clock' // clock | countdown | stopwatch
export let selectedId = null
export let challenges = [] // 同任务挑战：服务端已按进度排好序的视图
export let focusId = null  // 专注模式中那一个计时窗的任务 id
export let offset = 0     // 服务器时间与本地的偏差：serverNow = Date.now() + offset
export let titleFlash = '' // 完成提醒时临时标题
export const notified = new Set() // 已提醒过完成的任务 id

export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const $ = (id) => document.getElementById(id)
export const bigTime = $('big-time')
export const subTime = $('sub-time')
export const taskList = $('task-list')
export const ringFg = $('ring-fg')

/* 这几个状态会被别的模块整体重新赋值。ESM 的 import 绑定只读（能读不能写），
 * 所以写一律走这里的 setter：读的人 import 名字，拿到的永远是最新值。 */
export function setToken(v) { token = v }
export function setTasks(v) { tasks = v }
export function setFriends(v) { friends = v }
export function setModeState(v) { mode = v }
export function setSelectedId(v) { selectedId = v }
export function setChallenges(v) { challenges = v }
export function setFocusId(v) { focusId = v }
export function setOffset(v) { offset = v }
export function setTitleFlash(v) { titleFlash = v }
