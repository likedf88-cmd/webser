import { Router } from 'express'
import { db, now, newId, notify, publicUser } from '../db.js'
import { requireAuth, RANK } from '../auth.js'
import { upload, mediaTypeOf, fileUrl } from '../uploads.js'
import { rateLimit } from '../rate.js'
import { emitToUser } from '../bus.js'

const router = Router()

function membersOf(convId) {
  return db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(convId).map(r => r.user_id)
}

function messageView(m, viewerId) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(m.user_id)
  const reactions = db.prepare('SELECT emoji, COUNT(*) c FROM message_reactions WHERE message_id = ? GROUP BY emoji').all(m.id)
  const reply = m.reply_to ? db.prepare('SELECT * FROM messages WHERE id = ?').get(m.reply_to) : null
  const replyAuthor = reply ? db.prepare('SELECT * FROM users WHERE id = ?').get(reply.user_id) : null
  return {
    id: m.id,
    conversationId: m.conversation_id,
    text: m.deleted ? '' : m.text,
    mediaUrl: m.deleted ? null : m.media_url,
    mediaType: m.deleted ? null : m.media_type,
    deleted: !!m.deleted,
    createdAt: m.created_at,
    mine: m.user_id === viewerId,
    author: publicUser(author, viewerId),
    reactions,
    replyTo: reply ? { id: reply.id, text: reply.deleted ? '[deleted]' : reply.text, author: replyAuthor?.display_name || 'User' } : null
  }
}

function convView(c, viewerId) {
  const memberIds = membersOf(c.id)
  if (!memberIds.includes(viewerId)) return null
  const members = memberIds.map(id => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id), viewerId)).filter(Boolean)
  const last = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 1').get(c.id)
  const me = db.prepare('SELECT last_read FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(c.id, viewerId)
  const unread = db.prepare(
    'SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND user_id != ? AND created_at > ? AND deleted = 0'
  ).get(c.id, viewerId, me?.last_read || 0).c
  const others = members.filter(m => m.id !== viewerId)
  return {
    id: c.id,
    isGroup: !!c.is_group,
    name: c.is_group ? c.name || 'Group chat' : others[0]?.displayName || 'Conversation',
    avatarUrl: c.is_group ? null : others[0]?.avatarUrl || null,
    members,
    unread,
    createdAt: c.created_at,
    lastMessage: last
      ? { id: last.id, text: last.deleted ? '' : last.text, mediaType: last.media_type, createdAt: last.created_at, fromId: last.user_id }
      : null
  }
}

router.get('/conversations', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE m.user_id = ?'
  ).all(req.user.id)
  const convs = rows.map(c => convView(c, req.user.id)).filter(Boolean)
  convs.sort((a, b) => (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt))
  res.json({ conversations: convs })
})

router.post('/conversations', requireAuth, (req, res) => {
  const { userId, userIds, name } = req.body || {}
  let targets = Array.isArray(userIds) ? userIds.filter(Boolean) : userId ? [userId] : []
  targets = [...new Set(targets)].filter(id => id !== req.user.id)
  if (!targets.length) return res.status(400).json({ error: 'Pick at least one person' })
  for (const id of targets) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND banned = 0').get(id)) return res.status(400).json({ error: 'User not found' })
  }
  const isGroup = targets.length > 1 || !!name
  if (!isGroup) {
    const existing = db.prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.is_group = 0`
    ).get(req.user.id, targets[0])
    if (existing) return res.json({ id: existing.id })
  }
  const id = newId()
  db.prepare('INSERT INTO conversations (id,is_group,name,owner_id,created_at) VALUES (?,?,?,?,?)').run(
    id, isGroup ? 1 : 0, isGroup ? String(name || 'Group chat').slice(0, 60) : null, req.user.id, now()
  )
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id,last_read) VALUES (?,?,?)').run(id, req.user.id, 0)
  for (const uid of targets) {
    db.prepare('INSERT INTO conversation_members (conversation_id,user_id,last_read) VALUES (?,?,?)').run(id, uid, 0)
    notify(uid, req.user.id, 'message', `${req.user.display_name} added you to ${isGroup ? 'a group chat' : 'a chat'}`, '/messages/' + id)
  }
  res.json({ id })
})

router.get('/conversations/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Conversation not found' })
  if (!membersOf(c.id).includes(req.user.id)) return res.status(403).json({ error: 'Not a member' })
  res.json({ conversation: convView(c, req.user.id) })
})

router.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Conversation not found' })
  if (!membersOf(c.id).includes(req.user.id)) return res.status(403).json({ error: 'Not a member' })
  const limit = Math.min(Number(req.query.limit) || 50, 100)
  const cursor = Number(req.query.cursor) || now() + 1
  const rows = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
  ).all(c.id, cursor, limit)
  rows.reverse()
  res.json({
    messages: rows.map(m => messageView(m, req.user.id)),
    nextCursor: rows.length ? rows[0].created_at : null,
    members: membersOf(c.id).map(id => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id), req.user.id))
  })
})

router.post('/conversations/:id/messages', requireAuth, rateLimit(60, 60_000, 'msg'), upload.single('media'), (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Conversation not found' })
  const memberIds = membersOf(c.id)
  if (!memberIds.includes(req.user.id)) return res.status(403).json({ error: 'Not a member' })
  const text = String(req.body?.text || '').slice(0, 2000)
  const externalUrl = String(req.body?.mediaUrl || '')
  let url = fileUrl(req.file)
  let type = mediaTypeOf(req.file)
  if (!url && /^https:\/\//i.test(externalUrl)) { url = externalUrl; type = 'gif' }
  if (!text && !url) return res.status(400).json({ error: 'Message is empty' })
  let replyTo = req.body?.replyTo || null
  if (replyTo) {
    const parent = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(replyTo)
    if (!parent || parent.conversation_id !== c.id) replyTo = null
  }
  const id = newId()
  const at = now()
  db.prepare('INSERT INTO messages (id,conversation_id,user_id,text,media_url,media_type,reply_to,deleted,created_at) VALUES (?,?,?,?,?,?,?,0,?)').run(
    id, c.id, req.user.id, text, url, type, replyTo, at
  )
  const message = messageView(db.prepare('SELECT * FROM messages WHERE id = ?').get(id), req.user.id)
  for (const uid of memberIds) {
    if (uid === req.user.id) continue
    emitToUser(uid, 'dm:message', { conversationId: c.id, message: messageView(db.prepare('SELECT * FROM messages WHERE id = ?').get(id), uid) })
    notify(uid, req.user.id, 'message', `${req.user.display_name}: ${text.slice(0, 50) || 'sent an attachment'}`, '/messages/' + c.id)
  }
  res.json({ message })
})

router.post('/conversations/:id/read', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  const memberIds = membersOf(c.id)
  if (!memberIds.includes(req.user.id)) return res.status(403).json({ error: 'Not a member' })
  db.prepare('UPDATE conversation_members SET last_read = ? WHERE conversation_id = ? AND user_id = ?').run(now(), c.id, req.user.id)
  for (const uid of memberIds) if (uid !== req.user.id) emitToUser(uid, 'dm:read', { conversationId: c.id, userId: req.user.id, at: now() })
  res.json({ ok: true })
})

router.post('/conversations/:id/members', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  const memberIds = membersOf(c.id)
  if (!memberIds.includes(req.user.id)) return res.status(403).json({ error: 'Not a member' })
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body?.userId)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (memberIds.includes(target.id)) return res.json({ ok: true })
  db.prepare('INSERT INTO conversation_members (conversation_id,user_id,last_read) VALUES (?,?,0)').run(c.id, target.id)
  notify(target.id, req.user.id, 'message', `${req.user.display_name} added you to ${c.name || 'a group chat'}`, '/messages/' + c.id)
  emitToUser(target.id, 'dm:new', { conversationId: c.id })
  res.json({ ok: true })
})

router.post('/messages/:id/react', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id)
  if (!m) return res.status(404).json({ error: 'Message not found' })
  if (!membersOf(m.conversation_id).includes(req.user.id)) return res.status(403).json({ error: 'Not a member' })
  const emoji = String(req.body?.emoji || '❤️').slice(0, 4)
  const existing = db.prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?').get(m.id, req.user.id)
  if (existing && existing.emoji === emoji) db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(m.id, req.user.id)
  else db.prepare('INSERT OR REPLACE INTO message_reactions (message_id,user_id,emoji) VALUES (?,?,?)').run(m.id, req.user.id, emoji)
  const reactions = db.prepare('SELECT emoji, COUNT(*) c FROM message_reactions WHERE message_id = ? GROUP BY emoji').all(m.id)
  for (const uid of membersOf(m.conversation_id)) emitToUser(uid, 'dm:reaction', { messageId: m.id, reactions })
  res.json({ reactions })
})

router.delete('/messages/:id', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id)
  if (!m) return res.status(404).json({ error: 'Not found' })
  const privileged = (RANK[req.user.role] || 0) >= 1
  if (m.user_id !== req.user.id && !privileged) return res.status(403).json({ error: 'Not allowed' })
  db.prepare('UPDATE messages SET deleted = 1, text = ?, media_url = NULL WHERE id = ?').run('', m.id)
  for (const uid of membersOf(m.conversation_id)) emitToUser(uid, 'dm:deleted', { conversationId: m.conversation_id, messageId: m.id })
  res.json({ ok: true })
})

router.get('/messages/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json({ messages: [] })
  const rows = db.prepare(
    `SELECT m.* FROM messages m
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
     WHERE m.deleted = 0 AND m.text LIKE ? ORDER BY m.created_at DESC LIMIT 40`
  ).all(req.user.id, `%${q}%`)
  res.json({ messages: rows.map(m => messageView(m, req.user.id)) })
})

export default router
