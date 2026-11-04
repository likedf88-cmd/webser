import { Router } from 'express'
import crypto from 'node:crypto'
import { db, now, newId, audit, addCoins, publicUser } from '../db.js'
import { requireRank, requireAuth, outranks, RANK, OWNER_PASS } from '../auth.js'
import { upload, fileUrl } from '../uploads.js'
import { onlineUserIds } from '../bus.js'

const router = Router()
const ADMIN = requireRank('moderator')
const MANAGER = requireRank('admin')
const OWNER = requireRank('owner')

const count = (sql, ...a) => db.prepare(sql).get(...a).c

function dayList(days) {
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    out.push({ day: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) })
  }
  return out
}

router.get('/stats', ADMIN, (req, res) => {
  const days = dayList(14)
  const signups = days.map(d => ({ ...d, value: count("SELECT COUNT(*) c FROM users WHERE substr(date(created_at/1000,'unixepoch'),1,10) = ?", d.day) }))
  const postsByDay = days.map(d => ({ ...d, value: count("SELECT COUNT(*) c FROM posts WHERE substr(date(created_at/1000,'unixepoch'),1,10) = ?", d.day) }))
  const today = new Date().toISOString().slice(0, 10)
  res.json({
    totals: {
      users: count('SELECT COUNT(*) c FROM users'),
      banned: count('SELECT COUNT(*) c FROM users WHERE banned = 1'),
      online: onlineUserIds().length,
      posts: count("SELECT COUNT(*) c FROM posts WHERE kind = 'post'"),
      reels: count("SELECT COUNT(*) c FROM posts WHERE media_type = 'video'"),
      stories: count('SELECT COUNT(*) c FROM stories WHERE expires_at > ?', now()),
      messages: count('SELECT COUNT(*) c FROM messages WHERE deleted = 0'),
      comments: count('SELECT COUNT(*) c FROM comments'),
      pendingReports: count("SELECT COUNT(*) c FROM reports WHERE status = 'pending'"),
      coins: count('SELECT COALESCE(SUM(coins),0) c FROM users'),
      purchases: count('SELECT COUNT(*) c FROM purchases'),
      dailyClaimsToday: count('SELECT COUNT(*) c FROM daily_claims WHERE day = ?', today),
      newToday: count("SELECT COUNT(*) c FROM users WHERE substr(date(created_at/1000,'unixepoch'),1,10) = ?", today),
      items: count('SELECT COUNT(*) c FROM shop_items WHERE active = 1'),
      giftcards: count('SELECT COUNT(*) c FROM gift_cards')
    },
    signups,
    postsByDay,
    topCreators: db.prepare(
      `SELECT * FROM users ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.following = users.id) DESC LIMIT 5`
    ).all().map(u => ({ ...publicUser(u, req.user.id), followers: count('SELECT COUNT(*) c FROM follows WHERE following = ?', u.id) })),
    recentAudit: (RANK[req.user.role] || 0) >= RANK.owner
      ? db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 8').all()
      : []
  })
})

router.get('/users', ADMIN, (req, res) => {
  const q = String(req.query.q || '').trim()
  const rows = q
    ? db.prepare('SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 100').all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 100').all()
  const isAdminPlus = (RANK[req.user.role] || 0) >= RANK.admin
  res.json({
    users: rows.map(u => ({
      id: u.id, username: u.username, displayName: u.display_name, role: u.role,
      email: isAdminPlus ? u.email : null,
      coins: u.coins, banned: !!u.banned, banReason: u.ban_reason, verified: !!u.verified,
      privacy: u.privacy, createdAt: u.created_at, lastSeen: u.last_seen,
      avatarUrl: u.avatar_url,
      followers: count('SELECT COUNT(*) c FROM follows WHERE following = ?', u.id),
      posts: count('SELECT COUNT(*) c FROM posts WHERE user_id = ?', u.id)
    }))
  })
})

router.post('/users/:id/ban', MANAGER, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot ban yourself' })
  if (!outranks(req.user, target)) return res.status(403).json({ error: 'You can only ban users below your rank' })
  if (target.role === 'owner' && count("SELECT COUNT(*) c FROM users WHERE role = 'owner'") <= 1) {
    return res.status(400).json({ error: 'The last owner account cannot be banned' })
  }
  const reason = String(req.body?.reason || 'Violating community rules').slice(0, 200)
  db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?').run(reason, target.id)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
  audit(req.user.id, 'user.ban', { target: target.username, reason })
  res.json({ ok: true })
})

router.post('/users/:id/unban', MANAGER, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE id = ?').run(target.id)
  audit(req.user.id, 'user.unban', { target: target.username })
  res.json({ ok: true })
})

router.post('/users/:id/role', MANAGER, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  const role = String(req.body?.role || '')
  if (!['user', 'moderator', 'admin', 'owner'].includes(role)) return res.status(400).json({ error: 'Unknown role' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' })
  if (!outranks(req.user, target)) return res.status(403).json({ error: 'You can only manage users below your rank' })

  if (role === 'admin' || role === 'owner') {
    if ((RANK[req.user.role] || 0) < RANK.owner) return res.status(403).json({ error: 'Only an owner can appoint admins' })
    // granting ANY elevated staff role requires the owner password
    if (String(req.body?.pass || '') !== OWNER_PASS) {
      return res.status(403).json({ error: 'Owner password required to grant elevated access' })
    }
  }
  if (target.role === 'owner' && role !== 'owner' && count("SELECT COUNT(*) c FROM users WHERE role = 'owner'") <= 1) {
    return res.status(400).json({ error: 'The last owner cannot be demoted' })
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id)
  audit(req.user.id, 'user.role', { target: target.username, from: target.role, to: role })
  db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,text,link,read,created_at) VALUES (?,?,?,?,?,?,0,?)').run(
    newId(), target.id, req.user.id, 'moderation', `Your role was changed to ${role}`, '/settings'
  )
  res.json({ ok: true, role })
})

router.post('/users/:id/verify', MANAGER, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  const next = target.verified ? 0 : 1
  db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(next, target.id)
  audit(req.user.id, 'user.verify', { target: target.username, verified: !!next })
  res.json({ ok: true, verified: !!next })
})

router.delete('/users/:id', OWNER, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account here' })
  if (target.role === 'owner' && count("SELECT COUNT(*) c FROM users WHERE role = 'owner'") <= 1) {
    return res.status(400).json({ error: 'The last owner account cannot be deleted' })
  }
  db.tx(() => {
    // tables that key on user_id directly (follows/blocks/follow_requests use
    // follower/following/blocked_id, so they are handled explicitly below)
    for (const table of ['sessions', 'likes', 'saves', 'comments', 'story_views', 'story_reactions', 'daily_claims', 'notifications', 'purchases'])
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(target.id)
    db.prepare('DELETE FROM blocks WHERE user_id = ?').run(target.id)
    db.prepare('DELETE FROM follows WHERE following = ?').run(target.id)
    db.prepare('DELETE FROM blocks WHERE blocked_id = ?').run(target.id)
    // follow_requests keys on follower/following, not user_id
    db.prepare('DELETE FROM follow_requests WHERE following = ?').run(target.id)
    db.prepare('DELETE FROM follow_requests WHERE follower = ?').run(target.id)
    db.prepare('DELETE FROM conversation_members WHERE user_id = ?').run(target.id)
    db.prepare('DELETE FROM stories WHERE user_id = ?').run(target.id)
    db.prepare('DELETE FROM comments WHERE user_id = ?').run(target.id)
    db.prepare('DELETE FROM posts WHERE user_id = ?').run(target.id)
    db.prepare('UPDATE users SET banned = 1, username = ?, email = ?, display_name = ?, bio = ?, avatar_url = NULL, ban_reason = ? WHERE id = ?').run(
      'deleted_' + target.id.slice(0, 8), 'deleted_' + target.id + '@deleted.local', 'Deleted account', '', 'Account deleted by owner', target.id
    )
  })
  audit(req.user.id, 'user.delete', { target: target.username })
  res.json({ ok: true })
})

router.post('/coins', OWNER, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body?.userId)
  const amount = Math.floor(Number(req.body?.amount))
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) return res.status(400).json({ error: 'Invalid amount' })
  if (amount < 0 && target.coins + amount < 0) return res.status(400).json({ error: 'User does not have that many coins' })
  addCoins(target.id, amount, 'admin', String(req.body?.note || 'Administrative adjustment').slice(0, 120))
  audit(req.user.id, 'wallet.adjust', { target: target.username, amount })
  res.json({ ok: true })
})

router.get('/reports', ADMIN, (req, res) => {
  const status = String(req.query.status || 'all')
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200').all()
    : db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
  res.json({
    reports: rows.map(r => {
      const reporter = db.prepare('SELECT * FROM users WHERE id = ?').get(r.reporter_id)
      let target = null
      if (r.target_type === 'user') {
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.target_id)
        target = u ? { username: u.username, label: '@' + u.username, banned: !!u.banned } : null
      } else if (r.target_type === 'post') {
        const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(r.target_id)
        target = p ? { label: (p.text || '[media post]').slice(0, 80), removed: false } : { label: 'Post removed', removed: true }
      }
      return {
        id: r.id, type: r.target_type, targetId: r.target_id, category: r.category, description: r.description,
        status: r.status, notes: r.notes, createdAt: r.created_at,
        reporter: reporter ? { username: reporter.username, displayName: reporter.display_name } : null,
        target
      }
    })
  })
})

router.post('/reports/:id', ADMIN, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id)
  if (!report) return res.status(404).json({ error: 'Report not found' })
  const status = String(req.body?.status || report.status)
  if (!['pending', 'review', 'action', 'dismissed', 'escalated'].includes(status)) return res.status(400).json({ error: 'Unknown status' })
  db.prepare('UPDATE reports SET status = ?, notes = ? WHERE id = ?').run(status, String(req.body?.notes ?? report.notes ?? '').slice(0, 2000), report.id)
  audit(req.user.id, 'report.resolve', { report: report.id, status })
  res.json({ ok: true })
})

router.post('/content/:id/remove', ADMIN, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id)
  db.prepare('DELETE FROM posts WHERE repost_of = ?').run(post.id)
  audit(req.user.id, 'content.remove', { post: post.id, author: post.user_id })
  db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,text,link,read,created_at) VALUES (?,?,?,?,?,?,0,?)').run(
    newId(), post.user_id, req.user.id, 'moderation', 'A post was removed by moderation.', '/settings'
  )
  res.json({ ok: true })
})

router.get('/audit', OWNER, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 300').all()
  res.json({
    entries: rows.map(e => ({
      id: e.id, action: e.action, details: e.details, createdAt: e.created_at,
      actor: e.actor_id ? (db.prepare('SELECT username FROM users WHERE id = ?').get(e.actor_id)?.username || 'deleted') : 'system'
    }))
  })
})

router.post('/announcements', MANAGER, (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'Write an announcement first' })
  const id = newId()
  db.prepare('INSERT INTO announcements (id,text,created_at) VALUES (?,?,?)').run(id, text.slice(0, 500), now())
  for (const u of db.prepare('SELECT id FROM users WHERE banned = 0').all()) {
    db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,text,link,read,created_at) VALUES (?,?,?,?,?,?,0,?)').run(
      newId(), u.id, req.user.id, 'announcement', text.slice(0, 120), '/'
    )
  }
  audit(req.user.id, 'announcement.create', { text: text.slice(0, 80) })
  res.json({ ok: true, id })
})

/* ---------- marketplace management ---------- */
router.post('/items', MANAGER, upload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'model', maxCount: 1 }]), (req, res) => {
  const name = String(req.body?.name || '').trim()
  const price = Math.floor(Number(req.body?.price))
  const category = String(req.body?.category || 'avatars')
  if (!name) return res.status(400).json({ error: 'Item name required' })
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) return res.status(400).json({ error: 'Price must be 0-1,000,000' })
  const model = req.files?.model?.[0]
  const thumb = req.files?.thumbnail?.[0]
  const id = newId()
  db.prepare(
    'INSERT INTO shop_items (id,name,description,category,price,thumbnail,model_url,creator,active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)'
  ).run(
    id, name.slice(0, 60), String(req.body?.description || '').slice(0, 500), category, price,
    thumb ? fileUrl(thumb) : null, model ? fileUrl(model) : null, String(req.body?.creator || 'ASC Studio').slice(0, 40), now()
  )
  audit(req.user.id, 'market.create', { name, price, category, model: !!model })
  res.json({ ok: true, id })
})

router.post('/items/:id/toggle', MANAGER, (req, res) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  db.prepare('UPDATE shop_items SET active = ? WHERE id = ?').run(item.active ? 0 : 1, item.id)
  audit(req.user.id, 'market.toggle', { item: item.name, active: !item.active })
  res.json({ ok: true, active: !item.active })
})

router.get('/items', ADMIN, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM shop_items ORDER BY created_at DESC LIMIT 200').all() })
})

/* ---------- gift cards ---------- */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function newCode() {
  const groups = []
  for (let g = 0; g < 3; g++) {
    let s = ''
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    groups.push(s)
  }
  return 'ASC-' + groups.join('-')
}

router.get('/giftcards', OWNER, (req, res) => {
  const rows = db.prepare('SELECT * FROM gift_cards ORDER BY created_at DESC LIMIT 200').all()
  res.json({
    cards: rows.map(c => ({
      id: c.id, amount: c.amount, disabled: !!c.disabled, createdAt: c.created_at, redeemedAt: c.redeemed_at,
      redeemedBy: c.redeemed_by ? db.prepare('SELECT username FROM users WHERE id = ?').get(c.redeemed_by)?.username || 'deleted' : null
    }))
  })
})

router.post('/giftcards', OWNER, (req, res) => {
  const amount = Math.floor(Number(req.body?.amount))
  const qty = Math.min(Math.max(Math.floor(Number(req.body?.count) || 1), 1), 25)
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return res.status(400).json({ error: 'Amount must be 1-100,000' })
  const codes = []
  db.tx(() => {
    for (let i = 0; i < qty; i++) {
      const code = newCode()
      const hash = crypto.createHash('sha256').update(code).digest('hex')
      db.prepare('INSERT INTO gift_cards (id,code_hash,amount,created_by,created_at) VALUES (?,?,?,?,?)').run(newId(), hash, amount, req.user.id, now())
      codes.push(code)
    }
  })
  audit(req.user.id, 'giftcard.create', { amount, count: qty })
  res.json({ ok: true, codes })
})

router.post('/giftcards/:id/disable', OWNER, (req, res) => {
  const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Card not found' })
  db.prepare('UPDATE gift_cards SET disabled = ? WHERE id = ?').run(card.disabled ? 0 : 1, card.id)
  audit(req.user.id, 'giftcard.disable', { id: card.id, disabled: !card.disabled })
  res.json({ ok: true, disabled: !card.disabled })
})

export default router
