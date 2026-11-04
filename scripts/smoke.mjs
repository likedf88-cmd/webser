/**
 * End-to-end API smoke test for Avatarverse.
 * Usage: node scripts/smoke.mjs   (API must be running on 127.0.0.1:8787)
 * Runs against a fresh database: the first account registered becomes Owner.
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:8787/api'
let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; failures.push(name); console.log('  ❌', name, extra ? '→ ' + JSON.stringify(extra) : '') }
}

function client() {
  let cookie = ''
  return async function call(path, { method = 'GET', body } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    for (const c of setCookies) {
      const kv = c.split(';')[0]
      if (kv.startsWith('asc_session=')) cookie = kv
    }
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data }
  }
}

const runId = Date.now().toString(36)
const alice = client()
const bob = client()
const carol = client()
const anon = client()

const A = { username: 'alice_' + runId, email: `alice_${runId}@asc.test`, password: 'secret123', displayName: 'Alice' }
const B = { username: 'bob_' + runId, email: `bob_${runId}@asc.test`, password: 'secret123', displayName: 'Bob' }
const C = { username: 'carol_' + runId, email: `carol_${runId}@asc.test`, password: 'secret123', displayName: 'Carol' }

console.log('\n— Health —')
const health = await anon('/health')
check('health endpoint', health.status === 200 && health.data.ok)

console.log('\n— Auth —')
const regA = await alice('/auth/register', { method: 'POST', body: A })
check('first account becomes owner', regA.status === 200 && regA.data.user?.role === 'owner', regA.data)
const regB = await bob('/auth/register', { method: 'POST', body: B })
check('second account registers as user', regB.status === 200 && regB.data.user?.role === 'user')
const regC = await carol('/auth/register', { method: 'POST', body: C })
check('third account registers', regC.status === 200)
const dup = await anon('/auth/register', { method: 'POST', body: A })
check('duplicate username rejected', dup.status === 409)
const badLogin = await anon('/auth/login', { method: 'POST', body: { identifier: A.username, password: 'nope' } })
check('wrong password rejected', badLogin.status === 401)
const meA = await alice('/auth/me')
check('session cookie authenticates', meA.status === 200 && meA.data.user?.username === A.username)
const anonAdmin = await anon('/admin/users')
check('anonymous admin access blocked', anonAdmin.status === 401)

console.log('\n— Posts, likes, comments, follows —')
const post = await alice('/posts', { method: 'POST', body: { text: 'Hello Avatarverse #welcome @' + B.username } })
check('create post', post.status === 200 && !!post.data.post?.id)
const postId = post.data.post?.id
const like = await bob('/posts/' + postId + '/like', { method: 'POST' })
check('like post', like.status === 200 && like.data.liked === true && like.data.likes === 1)
const comment = await bob('/posts/' + postId + '/comments', { method: 'POST', body: { text: 'nice one' } })
check('comment on post', comment.status === 200)
const comments = await anon('/posts/' + postId + '/comments')
check('list comments', comments.status === 200 && comments.data.comments.length === 1)
const follow = await alice('/users/' + regB.data.user.id + '/follow', { method: 'POST' })
check('follow user', follow.status === 200 && follow.data.following === true)
const feed = await alice('/feed?mode=following')
check('following feed contains post', feed.status === 200 && feed.data.posts.some(p => p.id === postId))
const explore = await alice('/explore')
check('explore returns payload', explore.status === 200 && Array.isArray(explore.data.hashtags))
const notifsB = await bob('/notifications')
check('like generated notification', notifsB.status === 200 && notifsB.data.notifications.length > 0)

console.log('\n— Stories —')
const story = await alice('/stories', { method: 'POST', body: { text: 'first story', privacy: 'followers' } })
check('create story', story.status === 200 && !!story.data.id)
const bobFollowsAlice = await bob('/users/' + regA.data.user.id + '/follow', { method: 'POST' })
check('bob follows alice', bobFollowsAlice.status === 200)
const stories = await bob('/stories')
check('follower sees story', stories.status === 200 && stories.data.groups.some(g => g.user.username === A.username))
const storyView = await bob('/stories/' + story.data.id + '/view', { method: 'POST' })
check('record story view', storyView.status === 200)
const react = await bob('/stories/' + story.data.id + '/react', { method: 'POST', body: { emoji: '🔥' } })
check('react to story', react.status === 200)

console.log('\n— Wallet & daily reward —')
const daily = await bob('/wallet/daily', { method: 'POST' })
check('daily reward claim', daily.status === 200 && daily.data.amount >= 100)
const daily2 = await bob('/wallet/daily', { method: 'POST' })
check('second daily claim blocked', daily2.status === 409)
const wallet = await bob('/wallet')
check('wallet ledger recorded', wallet.status === 200 && wallet.data.transactions.some(t => t.kind === 'daily'))
const gift = await alice('/wallet/gift', { method: 'POST', body: { toUsername: B.username, amount: 50 } })
check('gift coins', gift.status === 200)
const wallet2 = await bob('/wallet')
check('recipient balance increased', wallet2.data.coins >= 550)

console.log('\n— Marketplace —')
const shop = await bob('/shop')
check('shop lists seeded items', shop.status === 200 && shop.data.items.length >= 5)
const cheapest = shop.data.items.slice().sort((a, b) => a.price - b.price)[0]
const buy = await bob('/shop/' + cheapest.id + '/buy', { method: 'POST' })
check('buy item with coins', buy.status === 200)
const buyAgain = await bob('/shop/' + cheapest.id + '/buy', { method: 'POST' })
check('double purchase blocked', buyAgain.status === 400)
const equip = await bob('/shop/' + cheapest.id + '/equip', { method: 'POST' })
check('equip owned item', equip.status === 200 && equip.data.equipped === cheapest.id)
const giftItem = await alice('/shop/' + cheapest.id + '/gift', { method: 'POST', body: { toUsername: C.username } })
check('gift marketplace item', giftItem.status === 200)
const giftToOwner = await bob('/shop/' + cheapest.id + '/gift', { method: 'POST', body: { toUsername: C.username } })
check('gift item already owned blocked', giftToOwner.status === 400)

console.log('\n— Messaging —')
const conv = await alice('/conversations', { method: 'POST', body: { userId: regB.data.user.id } })
check('create direct conversation', conv.status === 200 && !!conv.data.id)
const msg = await alice('/conversations/' + conv.data.id + '/messages', { method: 'POST', body: { text: 'hey bob 👋' } })
check('send message', msg.status === 200 && !!msg.data.message?.id)
const bobMsgs = await bob('/conversations/' + conv.data.id + '/messages')
check('recipient reads messages', bobMsgs.status === 200 && bobMsgs.data.messages.length === 1)
const read = await bob('/conversations/' + conv.data.id + '/read', { method: 'POST' })
check('mark conversation read', read.status === 200)
const reactMsg = await bob('/messages/' + msg.data.message.id + '/react', { method: 'POST', body: { emoji: '😂' } })
check('react to message', reactMsg.status === 200 && reactMsg.data.reactions.length === 1)
const carolPeek = await carol('/conversations/' + conv.data.id + '/messages')
check('non-member cannot read conversation', carolPeek.status === 403)
const carolReply = await carol('/conversations/' + conv.data.id + '/messages', { method: 'POST', body: { text: 'intruder' } })
check('non-member cannot post message', carolReply.status === 403)

console.log('\n— Roles, bans, moderation —')
const bobAdmin = await bob('/admin/stats')
check('normal user blocked from admin API', bobAdmin.status === 403)
const promoteNoPass = await alice('/admin/users/' + regB.data.user.id + '/role', { method: 'POST', body: { role: 'admin' } })
check('admin grant without owner password fails', promoteNoPass.status === 403)
const promote = await alice('/admin/users/' + regB.data.user.id + '/role', { method: 'POST', body: { role: 'admin', pass: process.env.OWNER_PASS || 'ch123716' } })
check('admin grant with owner password works', promote.status === 200)
const bobStats = await bob('/admin/stats')
check('promoted admin can read stats', bobStats.status === 200 && typeof bobStats.data.totals.users === 'number')
const banOwner = await bob('/admin/users/' + regA.data.user.id + '/ban', { method: 'POST', body: { reason: 'coup' } })
check('admin cannot ban a higher-ranked owner', banOwner.status === 403)
const banCarol = await bob('/admin/users/' + regC.data.user.id + '/ban', { method: 'POST', body: { reason: 'spam' } })
check('admin can ban lower-ranked user', banCarol.status === 200)
const carolLogin = await carol('/auth/login', { method: 'POST', body: { identifier: C.username, password: C.password } })
check('banned user cannot sign in', carolLogin.status === 403)
const carolSession = await carol('/auth/me')
check('banned session invalidated', carolSession.data.user === null)
const unban = await bob('/admin/users/' + regC.data.user.id + '/unban', { method: 'POST' })
check('unban works', unban.status === 200)
// banning clears sessions, so carol must sign in again
const carolBack = await carol('/auth/login', { method: 'POST', body: { identifier: C.username, password: C.password } })
check('unbanned user can sign in again', carolBack.status === 200)
const selfPromote = await alice('/admin/users/' + regA.data.user.id + '/role', { method: 'POST', body: { role: 'admin' } })
check('owner cannot change own role', selfPromote.status === 400)
const badReport = await bob('/reports', { method: 'POST', body: { targetType: 'user', targetId: regC.data.user.id, category: 'spam' } })
check('report accepted', badReport.status === 200)
const reports = await bob('/admin/reports')
check('admin sees reports', reports.status === 200 && reports.data.reports.length >= 1)

console.log('\n— Gift cards —')
const gc = await alice('/admin/giftcards', { method: 'POST', body: { amount: 250, count: 2 } })
check('owner creates gift cards', gc.status === 200 && gc.data.codes.length === 2)
const bobGc = await bob('/admin/giftcards')
check('admin cannot list gift cards', bobGc.status === 403)
const firstCode = gc.data?.codes?.[0]
check('gift card codes returned once', !!firstCode)
const redeem = await bob('/wallet/redeem', { method: 'POST', body: { code: firstCode } })
check('redeem gift card', redeem.status === 200 && redeem.data.amount === 250)
const redeemAgain = await bob('/wallet/redeem', { method: 'POST', body: { code: firstCode } })
check('gift card cannot be redeemed twice', redeemAgain.status === 400)
const badCode = await bob('/wallet/redeem', { method: 'POST', body: { code: 'ASC-0000-0000-0000' } })
check('invalid code rejected', badCode.status === 404)

console.log('\n— Games & announcements —')
const game = await bob('/games/flappy/score', { method: 'POST', body: { score: 30 } })
check('flappy score pays coins', game.status === 200 && game.data.coins === 10)
const gameFast = await bob('/games/flappy/score', { method: 'POST', body: { score: 30 } })
check('flappy rate limit', gameFast.status === 429)
const announce = await alice('/admin/announcements', { method: 'POST', body: { text: 'Welcome to Avatarverse! 🎉' } })
check('publish announcement', announce.status === 200)
const ann = await anon('/announcements')
check('announcement is public', ann.status === 200 && ann.data.announcements.length >= 1)

console.log('\n— Profile & privacy —')
const priv = await carol('/users/me', { method: 'PATCH', body: { privacy: 'private' } })
check('set account private', priv.status === 200 && priv.data.user?.privacy === 'private')
const carolProfile = await bob('/users/' + C.username)
check('private profile locks posts', carolProfile.status === 200 && carolProfile.data.locked === true)
const reqFollow = await bob('/users/' + regC.data.user.id + '/follow', { method: 'POST' })
check('follow request created for private account', reqFollow.status === 200 && reqFollow.data.requested === true)
const requests = await carol('/follow-requests')
check('private user sees follow requests', requests.status === 200 && requests.data.requests.length >= 1)
const accept = await carol('/follow-requests/' + B.username + '/accept', { method: 'POST' })
check('accept follow request', accept.status === 200)
const openNow = await bob('/users/' + C.username)
check('approved follower can view posts', openNow.status === 200 && openNow.data.locked === false)

console.log('\n— Moderation of content —')
const postToRemove = await carol('/posts', { method: 'POST', body: { text: 'spam spam' } })
check('reinstated user can post again', postToRemove.status === 200)
if (postToRemove.data?.post?.id) {
  const removed = await bob('/admin/content/' + postToRemove.data.post.id + '/remove', { method: 'POST' })
  check('admin removes content', removed.status === 200)
  const gone = await bob('/posts/' + postToRemove.data.post.id)
  check('removed post is gone', gone.status === 404)
} else {
  check('admin removes content', false, postToRemove.data)
}

console.log('\n— Owner account deletion —')
const promoteCarol = await alice('/admin/users/' + regC.data.user.id + '/role', { method: 'POST', body: { role: 'moderator' } })
check('owner promotes moderator', promoteCarol.status === 200)
const bobDeleteOwner = await bob('/admin/users/' + regA.data.user.id, { method: 'DELETE' })
check('admin cannot delete accounts', bobDeleteOwner.status === 403)
const deleteCarol = await alice('/admin/users/' + regC.data.user.id, { method: 'DELETE' })
check('owner deletes account', deleteCarol.status === 200)

console.log('\n— Logout —')
const out = await bob('/auth/logout', { method: 'POST' })
check('logout succeeds', out.status === 200)
const after = await bob('/auth/me')
check('session cleared after logout', after.data.user === null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  console.log('Failures:', failures.join(', '))
  process.exit(1)
}
