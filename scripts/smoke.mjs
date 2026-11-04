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
  const remember = (res) => {
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const kv = c.split(';')[0]
      if (kv.startsWith('asc_session=')) cookie = kv
    }
  }
  const parse = async (res) => {
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data }
  }
  async function call(path, { method = 'GET', body } = {}) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (cookie) headers.Cookie = cookie
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    remember(res)
    return parse(res)
  }
  /** multipart upload (FormData) reusing the same session cookie */
  call.form = async (path, formData) => {
    const headers = {}
    if (cookie) headers.Cookie = cookie
    const res = await fetch(BASE + path, { method: 'POST', headers, body: formData })
    remember(res)
    return parse(res)
  }
  return call
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

/* ---------------- avatar studio fixtures ---------------- */
const GLB_MAGIC = 0x46546c67

function buildGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)])
  const binChunk = bin ? Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]) : null
  const total = 12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHead = Buffer.alloc(8)
  jsonHead.writeUInt32LE(jsonChunk.length, 0)
  jsonHead.writeUInt32LE(0x4e4f534a, 4)
  const chunks = [header, jsonHead, jsonChunk]
  if (binChunk) {
    const binHead = Buffer.alloc(8)
    binHead.writeUInt32LE(binChunk.length, 0)
    binHead.writeUInt32LE(0x004e4942, 4)
    chunks.push(binHead, binChunk)
  }
  return Buffer.concat(chunks)
}

function glbJson(buffer) {
  const len = buffer.readUInt32LE(12)
  return JSON.parse(buffer.subarray(20, 20 + len).toString('utf8').replace(/\u0000+$/g, '').trim())
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Build a tiny but structurally valid GLB (1 triangle) with an optional humanoid rig. */
function buildModel({ boneNames = [], skinned = false, animated = false }) {
  const parts = []
  const views = []
  let offset = 0
  const pushView = (typed) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
    views.push({ byteOffset: offset, byteLength: buf.length })
    parts.push(buf)
    const pad = (4 - (buf.length % 4)) % 4
    if (pad) { parts.push(Buffer.alloc(pad)); offset += buf.length + pad } else offset += buf.length
    return views.length - 1
  }

  const posView = pushView(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]))
  let jointView, weightView, ibmView
  if (skinned) {
    jointView = pushView(new Uint8Array([0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0]))
    weightView = pushView(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
    const ibm = new Float32Array(boneNames.length * 16)
    for (let i = 0; i < boneNames.length; i++) ibm.set(identity(), i * 16)
    ibmView = pushView(ibm)
  }
  let timeView, rotView
  if (animated) {
    timeView = pushView(new Float32Array([0, 1]))
    rotView = pushView(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]))
  }

  const accessors = [{ bufferView: posView, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 1, 0] }]
  const attributes = { POSITION: 0 }
  if (skinned) {
    attributes.JOINTS_0 = accessors.length
    accessors.push({ bufferView: jointView, componentType: 5121, count: 3, type: 'VEC4' })
    attributes.WEIGHTS_0 = accessors.length
    accessors.push({ bufferView: weightView, componentType: 5126, count: 3, type: 'VEC4' })
    accessors.push({ bufferView: ibmView, componentType: 5126, count: boneNames.length, type: 'MAT4' })
  }
  let animation
  if (animated) {
    const input = accessors.push({ bufferView: timeView, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }) - 1
    const output = accessors.push({ bufferView: rotView, componentType: 5126, count: 2, type: 'VEC4' }) - 1
    animation = { name: 'Idle', samplers: [{ input, output }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }
  }

  const nodes = boneNames.map((name, i) => ({ name, ...(i < boneNames.length - 1 ? { children: [i + 1] } : {}) }))
  const bodyIndex = nodes.length
  nodes.push({ name: 'Body', mesh: 0, ...(skinned ? { skin: 0 } : {}) })

  return buildGlb({
    asset: { version: '2.0', generator: 'ASC smoke fixture' },
    scene: 0,
    scenes: [{ nodes: boneNames.length ? [0, bodyIndex] : [bodyIndex] }],
    nodes,
    meshes: [{ name: 'Body', primitives: [{ attributes, mode: 4 }] }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
    ...(skinned ? { skins: [{ joints: boneNames.map((_, i) => i), skeleton: 0, inverseBindMatrices: 3 }] } : {}),
    ...(animated ? { animations: [animation] } : {})
  }, Buffer.concat(parts))
}

const MIXAMO_BONES = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
  'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot',
  'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'
]
const UNITY_BONES = [
  'Pelvis', 'Spine', 'Head',
  'Left_UpperArm', 'Left_LowerArm', 'Left_Hand', 'Right_UpperArm', 'Right_LowerArm', 'Right_Hand',
  'Left_UpperLeg', 'Left_LowerLeg', 'Left_Foot', 'Right_UpperLeg', 'Right_LowerLeg', 'Right_Foot'
]

async function uploadModel(cli, buffer, filename) {
  const form = new FormData()
  form.append('model', new Blob([buffer], { type: filename.endsWith('.gltf') ? 'model/gltf+json' : 'model/gltf-binary' }), filename)
  return cli.form('/avatar/upload', form)
}

async function waitAvatar(cli, id) {
  for (let i = 0; i < 40; i++) {
    const res = await cli('/avatar/' + id)
    if (res.status === 200 && ['ready', 'unsupported', 'failed'].includes(res.data.avatar.status)) return res.data.avatar
    await new Promise(r => setTimeout(r, 250))
  }
  return null
}

console.log('\n— Avatar Studio —')
const anonStudio = await anon('/avatar/me')
check('avatar studio requires auth', anonStudio.status === 401)
const studioEmpty = await alice('/avatar/me')
check('avatar studio payload', studioEmpty.status === 200 && Array.isArray(studioEmpty.data.avatars) && studioEmpty.data.limits.maxBytes === 20971520)

const upUnrigged = await uploadModel(alice, buildModel({ skinned: false }), 'plain-mesh.glb')
check('upload accepted', upUnrigged.status === 200 && !!upUnrigged.data.avatar?.id)
const unrigged = await waitAvatar(alice, upUnrigged.data.avatar.id)
check('unrigged model reported unsupported', unrigged?.status === 'unsupported' && unrigged?.rig === 'none')
check('unsupported model explains rigging provider', /rigging provider/i.test(unrigged?.detail || ''))
check('unsupported model is not equipable', unrigged?.url === null)

const upBroken = await uploadModel(bob, Buffer.from('definitely not a gltf file'), 'broken.glb')
const broken = await waitAvatar(bob, upBroken.data.avatar.id)
check('corrupt model rejected by inspector', broken?.status === 'failed' && /magic/i.test(broken?.detail || ''))

const externalGltf = JSON.stringify({
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Body', mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
  bufferViews: [{ byteOffset: 0, byteLength: 36 }],
  buffers: [{ uri: 'scene.bin', byteLength: 36 }]
})
const upExternal = await uploadModel(bob, Buffer.from(externalGltf), 'external.gltf')
const external = await waitAvatar(bob, upExternal.data.avatar.id)
check('external asset references rejected', external?.status === 'failed' && /external files/i.test(external?.detail || ''))

const upRigged = await uploadModel(alice, buildModel({ boneNames: MIXAMO_BONES, skinned: true, animated: true }), 'hero.glb')
const rigged = await waitAvatar(alice, upRigged.data.avatar.id)
check('mixamo-rigged model is ready', rigged?.status === 'ready' && rigged?.rig === 'compatible', rigged?.detail)
check('skeleton matched to standard humanoid rig', (rigged?.skeleton?.coverage || 0) === 1 && rigged?.skeleton?.jointCount === 17)
check('animation clips detected', rigged?.stats?.animations?.length === 1 && rigged?.stats?.animations[0].name === 'Idle')
check('geometry inspected', rigged?.stats?.triangles === 1 && rigged?.stats?.meshes === 1)

const ORIGIN = new URL(BASE).origin
const processed = rigged?.url ? await fetch(new URL(rigged.url, ORIGIN).toString()) : null
const processedBuffer = processed ? Buffer.from(await processed.arrayBuffer()) : null
check('processed GLB is served', !!processed && processed.status === 200 && processedBuffer.readUInt32LE(0) === GLB_MAGIC)
const renamed = processedBuffer ? glbJson(processedBuffer).nodes.map(n => n.name) : []
check('joints renamed to canonical bones', renamed.includes('leftUpperArm') && renamed.includes('rightUpperLeg'))
const originalJson = glbJson(buildModel({ boneNames: MIXAMO_BONES, skinned: true, animated: true }))
check('original upload keeps its own names', originalJson.nodes[0].name === 'mixamorigHips')

const select = await alice('/avatar/' + rigged.id + '/select', { method: 'POST' })
check('equip processed avatar', select.status === 200 && select.data.equipped === rigged.id)
const stealSelect = await bob('/avatar/' + rigged.id + '/select', { method: 'POST' })
check('cannot equip another user avatar', stealSelect.status === 403)
const stealDelete = await bob('/avatar/' + rigged.id, { method: 'DELETE' })
check('cannot delete another user avatar', stealDelete.status === 403)
const peek = await bob('/avatar/' + unrigged.id)
check('unprocessed models stay private', peek.status === 403)

const publicAvatar = await anon('/users/' + A.username + '/avatar')
check('public avatar lookup', publicAvatar.status === 200 && !!publicAvatar.data.avatar.url)
const profileWithAvatar = await anon('/users/' + A.username)
check('profile exposes 3D avatar', !!profileWithAvatar.data.avatar3d?.url && !!profileWithAvatar.data.avatar3d?.look)

const lookSave = await alice('/avatar/look', { method: 'PUT', body: { skin: '#123456', hair: '#abcdef' } })
check('save appearance', lookSave.status === 200 && lookSave.data.look.skin === '#123456')
const badLook = await alice('/avatar/look', { method: 'PUT', body: { skin: 'red' } })
check('invalid colour rejected', badLook.status === 400)

const outfit = await alice('/avatar/outfits', { method: 'POST', body: { name: 'Neon', look: { shirt: '#ff00ff' } } })
check('save outfit', outfit.status === 200 && !!outfit.data.outfit?.id)
const applyOutfit = await alice('/avatar/outfits/' + outfit.data.outfit.id + '/apply', { method: 'POST' })
check('apply outfit', applyOutfit.status === 200 && applyOutfit.data.look.shirt === '#ff00ff')
const meStudio = await alice('/avatar/me')
check('studio reflects equipment', meStudio.data.equipped === rigged.id && meStudio.data.outfits.length === 1 && meStudio.data.look.hair === '#abcdef')

const upUnity = await uploadModel(bob, buildModel({ boneNames: UNITY_BONES, skinned: true }), 'unity-hero.glb')
const unity = await waitAvatar(bob, upUnity.data.avatar.id)
check('unity-style skeleton remapped', unity?.status === 'ready' && unity?.rig === 'remapped', unity?.detail)
check('optional missing bones reported', (unity?.skeleton?.fullMissing || []).includes('neck'))
const bobSelect = await bob('/avatar/' + unity.id + '/select', { method: 'POST' })
check('bob equips his remapped avatar', bobSelect.status === 200)

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
