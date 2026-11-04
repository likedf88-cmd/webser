import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { db, now } from './db.js'

export const RANK = { user: 0, moderator: 1, admin: 2, owner: 3 }
export const OWNER_PASS = process.env.OWNER_PASS || 'ch123716'
export const COOKIE = 'asc_session'

export const hash = (pw) => bcrypt.hashSync(pw, 10)
export const verify = (pw, h) => bcrypt.compareSync(pw, h)

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').run(token, userId, now())
  return token
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function userFromToken(token) {
  if (!token) return null
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token)
  if (!row) return null
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)
  if (!user || user.banned) return null
  return user
}

/** attaches req.user (or null) — never throws */
export function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE]
  if (token) {
    const user = userFromToken(token)
    if (user) {
      req.user = user
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id)
    }
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' })
  next()
}

export function requireRank(min) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' })
    if ((RANK[req.user.role] ?? 0) < RANK[min]) return res.status(403).json({ error: 'Insufficient permissions' })
    next()
  }
}

/** true when actor outranks target */
export function outranks(actor, target) {
  return (RANK[actor.role] ?? 0) > (RANK[target.role] ?? 0)
}
