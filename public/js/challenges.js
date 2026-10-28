/* ---------- 同任务挑战：同一个目标、各自打卡、按进度排行 ----------
 * 主界面不再摆一块挑战区：列表住在「挑战中心」这个浮层里（顶栏 ⚑ 挑战 / 手机抽屉里那一格），
 * 卡片上只给一行名次摘要，完整排名点进详情看 */

import { $, challenges, friends, setChallenges, tasks } from './state.js'
import { closeResult, confirmAction, resultChallengeId, toast } from './ui.js'
import { lsNum } from './background.js'
import { api, rankOf } from './utils.js'
import { refresh } from './task-actions.js'
import { groupLabel } from './task-list.js'
import { enterFocus } from './focus.js'

let shareTaskId = null
let challengeId = null
let lastSync = 0             // 最近一次拉到挑战数据的时间，用来写那句「刚刚更新」
let rankExpanded = false     // 详情里成员名单超 5 行时的「还有 N 人」展开态
const shareTargets = new Set()   // 发起弹窗里勾选的好友
const challengePick = new Set()  // 详情弹窗里勾选的追加邀请对象

export async function loadChallenges() {
  try {
    setChallenges(await api('/api/challenges'))
  } catch { return }
  lastSync = Date.now()
  renderChallengePanel()
  renderSyncTip()   // 拉到数据就说一句「刚刚更新」，不等下一秒那个心跳
  if (challengeId) renderChallengeModal() // 弹窗开着时排行也跟着动
}

/* 「刚刚更新」：一行不显眼的字，不做成按钮 —— 数据是 30 秒自己拉的，没有“手动刷新”这回事 */
export function renderSyncTip() {
  const el = $('challenge-sync')
  if (!el) return
  if (!lastSync) { el.textContent = ''; return }
  const s = Math.round((Date.now() - lastSync) / 1000)
  el.textContent = s < 10 ? '刚刚更新' : s < 60 ? `${s} 秒前更新` : `${Math.floor(s / 60)} 分钟前更新`
}

export function openHub() {
  $('challenge-hub').classList.remove('hidden')
  renderSyncTip()
  loadChallenges() // 点开就拉一次，不等那个 30 秒轮询
}

export function closeHub() {
  $('challenge-hub').classList.add('hidden')
}

const challengeOf = (id) => challenges.find((c) => c.id === id) || null

// 进度文案：有目标量就说“刷完几轮 + 本轮百分比”，纯计时型只能比累计时长
function progText(m, ch) {
  if (ch.duration > 0) {
    const unit = { daily: '天', weekly: '周', monthly: '月', yearly: '年' }[ch.recurrence] || '轮'
    return `已完成 ${m.cycles} ${unit} · 本轮 ${Math.round(m.pct * 100)}%`
  }
  return `累计 ${Math.floor(m.ms / 6e4)} 分钟`
}

const RANK_TAG = { running: '计时中', paused: '已暂停', stopped: '未开始', done: '已完成', none: '未绑定任务' }

/* 列表：待我处理的邀请排最前（能接受也能拒绝），其次是我已参与的 */
function renderChallengePanel() {
  const box = $('challenge-list')
  box.innerHTML = ''
  const invites = challenges.filter((c) => !c.joined && c.myInvite && c.myInvite.status === 'pending')
  const mine = challenges.filter((c) => c.joined)
  if (!invites.length && !mine.length) {
    box.innerHTML = '<div class="empty-tip">还没有挑战。在任务上点 ↗，把同一个目标发给好友</div>'
    return
  }
  invites.forEach((c) => box.appendChild(challengeItem(c, true)))
  if (invites.length && mine.length) box.appendChild(groupLabel('我参与的'))
  mine.forEach((c) => box.appendChild(challengeItem(c, false)))
}

const mkLine = (cls, text) => {
  const n = document.createElement('div')
  n.className = cls
  n.textContent = text
  return n
}

// 目标量那一小句：倒计时自带，正计时是发起人补的每轮时长
function goalText(c) {
  if (c.duration <= 0) return '不限目标 · 比累计时长'
  const unit = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[c.recurrence] || '每轮'
  return `${unit}目标 ${Math.round(c.duration / 6e4)} 分钟`
}

/* 一张卡：标题（最多两行，绝不截断）+ meta 小字 + 一行名次摘要 + 状态文案。
 * 整张卡就是入口，所以不放「查看」按钮；邀请卡上的接受 / 拒绝是真动作，留着 */
function challengeItem(c, isInvite) {
  const r = rankOf(c)
  const card = document.createElement('div')
  card.className = 'ch-card' + (isInvite ? ' req' : '')
  card.appendChild(mkLine('ch-title', isInvite ? `${c.ownerName} 邀你一起跑` : c.title))
  card.appendChild(mkLine('ch-meta', isInvite ? `${c.title} · ${goalText(c)}` : `${c.ownerName} 发起 · ${goalText(c)}`))
  card.appendChild(mkLine('ch-sum', r.line))
  card.appendChild(mkLine('ch-state', r.stateText + (r.gap ? ` · 与第一名差 ${r.gap}` : '')))
  if (isInvite) {
    const row = document.createElement('div')
    row.className = 'ch-btns'
    const ok = document.createElement('button')
    ok.className = 'ctrl-btn solid'
    ok.textContent = '接受'
    ok.onclick = (e) => { e.stopPropagation(); respondChallenge(c.id, true) }
    const no = document.createElement('button')
    no.className = 'ghost-btn'
    no.textContent = '拒绝'
    no.onclick = (e) => { e.stopPropagation(); respondChallenge(c.id, false) }
    row.appendChild(ok)
    row.appendChild(no)
    card.appendChild(row)
  }
  card.onclick = () => openChallenge(c.id)   // 点卡片本身进详情，完整排名在那里
  return card
}

/* 发起：把任务作为共同目标发给好友（邀请制，对方可拒绝） */

export function openShare(taskId) {
  const t = tasks.find((x) => x.id === taskId)
  if (!t) return
  shareTaskId = taskId
  shareTargets.clear()
  $('share-task-name').textContent = `把「${t.name}」当共同目标发给好友：各自计时、按进度排行，对方可以拒绝。`
  // 倒计时自带目标量；正计时没有，要由发起人补一个“每轮目标时长”才能排行
  $('share-goal-row').classList.toggle('hidden', t.type !== 'stopwatch')
  $('share-goal').value = lsNum('challengeGoal', 30)
  syncGoalText()
  renderShareModal()
  $('share-modal').classList.remove('hidden')
}

function syncGoalText() {
  $('share-goal-text').textContent = `${Number($('share-goal').value)} 分钟/轮`
}

export function closeShare() {
  shareTaskId = null
  $('share-modal').classList.add('hidden')
}

// 好友 chip 只是勾选，点「发出邀请」才真发出去（避免手滑一路共享出去）
function renderShareModal() {
  const box = $('share-friends')
  box.innerHTML = ''
  if (!friends.friends.length) {
    box.innerHTML = '<div class="empty-tip">还没有好友，先在右侧添加好友</div>'
    return
  }
  friends.friends.forEach((f) => {
    const on = shareTargets.has(f.id)
    const chip = document.createElement('button')
    chip.className = 'share-chip' + (on ? ' on' : '')
    chip.textContent = on ? `✓ ${f.username}` : f.username
    chip.onclick = () => {
      if (on) shareTargets.delete(f.id)
      else shareTargets.add(f.id)
      renderShareModal()
    }
    box.appendChild(chip)
  })
  const all = document.createElement('button')
  const every = shareTargets.size === friends.friends.length
  all.className = 'share-chip' + (every ? ' on' : '')
  all.textContent = every ? '✓ 取消全选' : '全选'
  all.onclick = () => {
    shareTargets.clear()
    if (!every) friends.friends.forEach((f) => shareTargets.add(f.id))
    renderShareModal()
  }
  box.appendChild(all)
}

/* 详情：按完成进度排行 + 点赞 */

export function openChallenge(id) {
  challengeId = id
  challengePick.clear()
  rankExpanded = false   // 每次进来都从“只看前几名”开始，不把上一次展开的状态带过来
  renderChallengeModal()
  $('challenge-modal').classList.remove('hidden')
  loadChallenges() // 打开瞬间拉一次最新进度
}

export function closeChallenge() {
  challengeId = null
  $('challenge-modal').classList.add('hidden')
}

function renderChallengeModal() {
  const c = challengeOf(challengeId)
  if (!c) { closeChallenge(); return }
  const r = rankOf(c)
  $('challenge-title').textContent = c.title
  // 顶部两行：一行是谁发的、目标多少，一行是名次与状态（卡片上只给了摘要，这里说全）
  $('challenge-meta').textContent = [
    `${c.ownerName} 发起`,
    `${c.members.length} 人参与`,
    goalText(c),
    r.stateText,
  ].join(' · ')
  $('challenge-rank-sum').textContent = r.me ? `${r.line}${r.gap ? ` · 与第一名差 ${r.gap}` : ''}` : '还没加入：接受邀请后才会出现在榜上'

  const rank = $('challenge-rank')
  rank.innerHTML = ''
  const maxMs = Math.max(1, ...c.members.map((m) => m.ms))
  /* 人多时先给前 5 行 + 自己那一行，剩下的收在「还有 N 人」里：
   * 详情是弹层，手机上满屏滚排名很累，但“我在哪”不能得展开才看得到 */
  const REST = 5
  const mineIdx = c.members.findIndex((m) => m.isMe)
  const shown = rankExpanded || c.members.length <= REST
    ? c.members.map((m, i) => ({ m, i }))
    : c.members.slice(0, REST).map((m, i) => ({ m, i }))
      .concat(mineIdx >= REST ? [{ m: c.members[mineIdx], i: mineIdx, sep: true }] : [])
  shown.forEach(({ m, i, sep }) => {
    if (sep) rank.appendChild(dividerRow())
    rank.appendChild(rankRow(c, m, i, maxMs))
  })
  if (!rankExpanded && c.members.length > REST) {
    const more = document.createElement('button')
    more.className = 'rank-more'
    more.textContent = `还有 ${c.members.length - REST} 人，展开看完`
    more.onclick = () => { rankExpanded = true; renderChallengeModal() }
    rank.appendChild(more)
  }

  renderChallengeInvite(c)

  const leave = $('btn-challenge-leave')
  leave.classList.toggle('hidden', !c.joined)
  leave.textContent = c.isOwner ? '关闭挑战' : '退出挑战'
}

// 自己那一行被拽到前五名之外时，中间插一条省略分隔，免得看着像漏了两个人
function dividerRow() {
  const d = document.createElement('div')
  d.className = 'rank-gap'
  d.textContent = '⋯'
  return d
}

function rankRow(c, m, i, maxMs) {
  const row = document.createElement('div')
  row.className = 'rank-row' + (m.isMe ? ' me' : '')

  const no = document.createElement('span')
  no.className = 'rank-no'
  no.textContent = i + 1
  row.appendChild(no)

  const main = document.createElement('div')
  main.className = 'rank-main'
  const who = document.createElement('div')
  who.className = 'rank-who'
  who.textContent = m.username + (m.isMe ? '（我）' : '')
  const tag = document.createElement('i')
  tag.className = 'rank-tag'
  tag.textContent = m.missing ? RANK_TAG.none : RANK_TAG[m.taskStatus] || ''
  who.appendChild(tag)
  const bar = document.createElement('div')
  bar.className = 'rank-bar'
  const fill = document.createElement('i')
  fill.style.width = `${(Math.min(1, c.duration > 0 ? m.pct : m.ms / maxMs) * 100).toFixed(1)}%`
  bar.appendChild(fill)
  const text = document.createElement('div')
  text.className = 'rank-text'
  text.textContent = m.missing ? '还没建自己的任务' : progText(m, c)
  main.appendChild(who)
  main.appendChild(bar)
  main.appendChild(text)
  row.appendChild(main)

  const like = document.createElement('button')
  like.className = 'like-btn' + (m.likedByMe ? ' on' : '')
  like.textContent = `♥ ${m.likes}`
  like.disabled = m.isMe || !c.joined
  like.title = m.isMe ? '不能给自己点赞' : c.joined ? '给 TA 鼓劲' : '加入后才能点赞'
  like.onclick = () => likeUser(c.id, m.user)
  row.appendChild(like)

  // 点自己那一行直接进专注：看别人进度的同时自己这个窗不被干扰
  if (m.isMe && m.taskId) row.onclick = () => enterFocus(m.taskId)
  return row
}

// 底部操作区：被邀请时是“接受/拒绝”，发起人则是“追加邀请”
function renderChallengeInvite(c) {
  const box = $('challenge-invite')
  box.innerHTML = ''
  if (!c.joined && c.myInvite && c.myInvite.status === 'pending') {
    const tip = document.createElement('div')
    tip.className = 'empty-tip'
    tip.textContent = `接受后会自动建一份同名任务给你计时，只排行、不共享数据。`
    box.appendChild(tip)
    const ok = document.createElement('button')
    ok.className = 'ctrl-btn solid'
    ok.textContent = '接受邀请'
    ok.onclick = () => respondChallenge(c.id, true)
    box.appendChild(ok)
    const no = document.createElement('button')
    no.className = 'ghost-btn'
    no.textContent = '拒绝'
    no.onclick = () => respondChallenge(c.id, false)
    box.appendChild(no)
    return
  }
  if (!c.isOwner) return
  const others = friends.friends.filter((f) => !c.members.some((m) => m.user === f.id))
  if (!others.length) return
  const tip = document.createElement('div')
  tip.className = 'bg-tip'
  tip.textContent = '再邀请：'
  box.appendChild(tip)
  others.forEach((f) => {
    const waiting = c.pending.some((p) => p.user === f.id)
    const on = challengePick.has(f.id)
    const chip = document.createElement('button')
    chip.className = 'share-chip' + (on ? ' on' : '') + (waiting ? ' dim' : '')
    chip.textContent = waiting ? `${f.username}（待同意）` : on ? `✓ ${f.username}` : f.username
    chip.onclick = () => {
      if (waiting) return
      if (on) challengePick.delete(f.id)
      else challengePick.add(f.id)
      renderChallengeModal()
    }
    box.appendChild(chip)
  })
  const go = document.createElement('button')
  go.className = 'ghost-btn small'
  go.textContent = '发出邀请'
  go.onclick = async () => {
    if (!challengePick.size) return toast('先勾选要邀请的好友')
    try {
      await api(`/api/challenges/${c.id}/invite`, { method: 'POST', body: JSON.stringify({ to: [...challengePick] }) })
      challengePick.clear()
      toast('已发出邀请')
      await loadChallenges()
    } catch (e) { toast(e.message) }
  }
  box.appendChild(go)
}

async function respondChallenge(id, accept) {
  const c = challengeOf(id)
  try {
    await api(`/api/challenges/${id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) })
    toast(accept ? `已加入「${c ? c.title : ''}」，同款任务已建好` : '已拒绝这个邀请')
    await Promise.all([refresh(), loadChallenges()])
    if (!accept && challengeId === id) closeChallenge()
  } catch (e) { toast(e.message) }
}

// 点赞接口直接返回最新视图，拼回去就行，不必整表重拉
async function likeUser(id, user) {
  try {
    const view = await api(`/api/challenges/${id}/like`, { method: 'POST', body: JSON.stringify({ user }) })
    setChallenges(challenges.map((c) => (c.id === view.id ? view : c)))
    renderChallengePanel()
    if (challengeId === id) renderChallengeModal()
  } catch (e) { toast(e.message) }
}

/* 顶层接线：DOM 事件与初始渲染。原来直接摊在 app.js 顶层，
 * 拆成模块后放进 init()，由 main.js 按原文件顺序调用，避免模块求值顺序影响这些副作用。 */
export function init() {
  $('share-goal').addEventListener('input', () => {
    syncGoalText()
    localStorage.setItem('challengeGoal', $('share-goal').value)
  })

  $('btn-share-go').onclick = async () => {
    const t = tasks.find((x) => x.id === shareTaskId)
    if (!t) return
    if (!shareTargets.size) return toast('至少选一位好友')
    try {
      const view = await api('/api/challenges', {
        method: 'POST',
        body: JSON.stringify({ taskId: t.id, to: [...shareTargets], duration: Number($('share-goal').value) * 6e4 }),
      })
      closeShare()
      toast(`已向 ${view.pending.length} 人发出挑战邀请`)
      await Promise.all([refresh(), loadChallenges()])
      openChallenge(view.id)
    } catch (e) { toast(e.message) }
  }

  $('btn-challenge-leave').onclick = async () => {
    const c = challengeOf(challengeId)
    if (!c) return
    const owner = c.isOwner
    if (!await confirmAction(owner
      ? `关闭挑战「${c.title}」？所有人的挑战绑定会解开，任务本身保留。`
      : `退出挑战「${c.title}」？你的任务会保留，只是不再参与排行。`)) return
    try {
      if (owner) await api(`/api/challenges/${c.id}`, { method: 'DELETE' })
      else await api(`/api/challenges/${c.id}/leave`, { method: 'POST' })
      toast(owner ? '已关闭挑战' : '已退出挑战')
      closeChallenge()
      await Promise.all([refresh(), loadChallenges()])
    } catch (e) { toast(e.message) }
  }

  $('btn-share-close').onclick = closeShare

  $('share-modal').addEventListener('click', (e) => { if (e.target.id === 'share-modal') closeShare() })

  $('btn-challenge-close').onclick = closeChallenge

  $('challenge-modal').addEventListener('click', (e) => { if (e.target.id === 'challenge-modal') closeChallenge() })

  /* 挑战中心：顶栏那个入口默认收起，点开才看得到列表 */
  $('btn-challenges').onclick = openHub

  $('btn-hub-close').onclick = closeHub

  $('challenge-hub').addEventListener('click', (e) => { if (e.target.id === 'challenge-hub') closeHub() })

  // 结算画面上的「看排行」：ui.js 只负责把画面摆出来，进哪个挑战由这里定（只有 challenges 知道 id）
  $('btn-result-rank').onclick = () => {
    const id = resultChallengeId()
    closeResult()
    if (id) openChallenge(id)
  }

}
