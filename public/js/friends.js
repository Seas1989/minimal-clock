/* ---------- 好友 ---------- */

import { $, friends, setFriends } from './state.js'
import { confirmAction, toast } from './ui.js'
import { api } from './utils.js'
import { refresh } from './task-actions.js'
import { loadChallenges } from './challenges.js'

export async function loadFriends() {
  try {
    setFriends(await api('/api/friends'))
  } catch { return }
  renderFriends()
}

export async function addFriend() {
  const username = $('friend-name').value.trim()
  if (!username) return
  try {
    const r = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username }) })
    $('friend-name').value = ''
    toast(r.accepted ? `已与 ${username} 成为好友` : `已向 ${username} 发送申请`)
    await loadFriends()
  } catch (e) { toast(e.message) }
}

async function respondRequest(reqId, accept, name) {
  try {
    await api('/api/friends/respond', { method: 'POST', body: JSON.stringify({ reqId, accept }) })
    toast(accept ? `已与 ${name} 成为好友` : `已拒绝 ${name}`)
    await loadFriends()
  } catch (e) { toast(e.message) }
}

async function unfriend(id, name) {
  if (!await confirmAction(`解除与「${name}」的好友关系？互相之间待处理的挑战邀请会作废。`)) return
  try {
    await api(`/api/friends/${id}`, { method: 'DELETE' })
    toast('已解除好友')
    await Promise.all([loadFriends(), refresh(), loadChallenges()])
  } catch (e) { toast(e.message) }
}

function renderFriends() {
  const reqBox = $('friend-requests')
  reqBox.innerHTML = ''
  friends.incoming.forEach((r) => {
    const div = document.createElement('div')
    div.className = 'friend-item req'
    const name = document.createElement('span')
    name.textContent = `${r.username} 请求加你`
    div.appendChild(name)
    div.appendChild(miniBtn('同意', () => respondRequest(r.reqId, true, r.username)))
    div.appendChild(miniBtn('拒绝', () => respondRequest(r.reqId, false, r.username)))
    reqBox.appendChild(div)
  })
  friends.outgoing.forEach((r) => {
    const div = document.createElement('div')
    div.className = 'friend-item req'
    div.textContent = `已发送给 ${r.username}（待同意）`
    reqBox.appendChild(div)
  })

  const list = $('friend-list')
  list.innerHTML = ''
  if (!friends.friends.length && !friends.incoming.length && !friends.outgoing.length) {
    list.innerHTML = '<div class="empty-tip">还没有好友，输入用户名添加</div>'
    return
  }
  friends.friends.forEach((f) => {
    const div = document.createElement('div')
    div.className = 'friend-item'
    const name = document.createElement('span')
    name.textContent = f.username
    div.appendChild(name)
    div.appendChild(miniBtn('解除', () => unfriend(f.id, f.username)))
    list.appendChild(div)
  })
}

export function miniBtn(label, onclick) {
  const b = document.createElement('button')
  b.className = 'link-btn'
  b.textContent = label
  b.onclick = onclick
  return b
}
