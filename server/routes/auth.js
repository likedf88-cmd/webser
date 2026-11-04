import { Router } from 'express'
import { db, now, newId, publicUser, notify, audit } from '../db.js'
import { COOKIE, createSession, destroySession, hash, requireAuth, verify } from '../auth.js'
import { rateLimit } from '../rate.js'

const router = Router()
const USERNAME = /^[a-zA-Z0-9_.]{3,20}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 1000 * 60 * 60 * 24 * 30 }

router.post('/auth/register', rateLimit(10, 60_000, 'register'), (req, res) => {
  const { username = '', email = '', password = '', displayName = '' } = req.body || {}
  const uname = String(username).trim().toLowerCase()
  const mail = String(email).trim().toLowerCase()
  if (!USERNAME.test(uname)) return res.status(400).json({ error: 'Username must be 3-20 letters, numbers, _ or .' })
  if (!EMAIL.test(mail)) return res.status(400).json({ error: 'Enter a valid email address' })
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) return res.status(409).json({ error: 'Username already taken' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) return res.status(409).json({ error: 'Email already registered' })

  // the seeded official/system account is not a real member, so the first
  // human registration becomes the platform Owner / Ultra Admin
  const isFirst = db.prepare("SELECT COUNT(*) c FROM users WHERE username != 'asc_official'").get().c === 0
  const id = newId()
  db.prepare(
    'INSERT INTO users (id,username,email,pass_hash,display_name,bio,role,coins,verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(
    id, uname, mail, hash(String(password)),
    String(displayName || uname).slice(0, 40), '',
    isFirst ? 'owner' : 'user', isFirst ? 2500 : 500, isFirst ? 1 : 0, now()
  )
  // everyone follows the official account so the feed is never empty
  const official = db.prepare("SELECT id FROM users WHERE username = 'asc_official'").get()
  if (official) db.prepare('INSERT OR IGNORE INTO follows (follower,following,created_at) VALUES (?,?,?)').run(id, official.id, now())

  const token = createSession(id)
  res.cookie(COOKIE, token, cookieOpts)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  audit(id, 'account.create', { username: uname, role: user.role })
  res.json({ user: publicUser(user, id) })
})

router.post('/auth/login', rateLimit(20, 60_000, 'login'), (req, res) => {
  const { identifier = '', password = '' } = req.body || {}
  const key = String(identifier).trim().toLowerCase()
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(key, key)
  if (!user || !verify(String(password), user.pass_hash)) return res.status(401).json({ error: 'Wrong username or password' })
  if (user.banned) return res.status(403).json({ error: 'This account is banned: ' + (user.ban_reason || 'violating the rules') })
  const token = createSession(user.id)
  res.cookie(COOKIE, token, cookieOpts)
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id)
  res.json({ user: publicUser(user, user.id) })
})

router.post('/auth/logout', (req, res) => {
  destroySession(req.cookies?.[COOKIE])
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null })
  res.json({ user: publicUser(req.user, req.user.id) })
})

router.post('/auth/password', requireAuth, (req, res) => {
  const { current = '', next = '' } = req.body || {}
  if (!verify(String(current), req.user.pass_hash)) return res.status(400).json({ error: 'Current password is wrong' })
  if (String(next).length < 6) return res.status(400).json({ error: 'New password must be 6+ characters' })
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash(String(next)), req.user.id)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id)
  const token = createSession(req.user.id)
  res.cookie(COOKIE, token, cookieOpts)
  notify(req.user.id, req.user.id, 'security', 'Your password was changed.', '/settings')
  res.json({ ok: true })
})

export default router
