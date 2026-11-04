import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const hash = (pw) => bcrypt.hashSync(pw, 10)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(__dirname, 'data')
export const UPLOAD_DIR = path.join(__dirname, 'uploads')
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

/** thin synchronous wrapper over node:sqlite with a better-sqlite3 shaped API */
class DB {
  constructor(file) {
    this.raw = new DatabaseSync(file)
  }
  exec(sql) {
    this.raw.exec(sql)
  }
  pragma(stmt) {
    this.raw.exec('PRAGMA ' + stmt)
  }
  prepare(sql) {
    const st = this.raw.prepare(sql)
    return { run: (...a) => st.run(...a), get: (...a) => st.get(...a), all: (...a) => st.all(...a) }
  }
  tx(fn) {
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.raw.exec('COMMIT')
      return out
    } catch (err) {
      try { this.raw.exec('ROLLBACK') } catch {}
      throw err
    }
  }
}

export const db = new DB(path.join(DATA_DIR, 'asc.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT, banner_url TEXT, avatar_item_id TEXT,
  role TEXT NOT NULL DEFAULT 'user', coins INTEGER NOT NULL DEFAULT 100,
  verified INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT,
  privacy TEXT NOT NULL DEFAULT 'public', ringtone TEXT NOT NULL DEFAULT 'classic',
  last_seen INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'post',
  text TEXT NOT NULL DEFAULT '', media_url TEXT, media_type TEXT,
  repost_of TEXT, views INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (post_id TEXT, user_id TEXT, created_at INTEGER, PRIMARY KEY(post_id, user_id));
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT, user_id TEXT, text TEXT, parent_id TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS saves (post_id TEXT, user_id TEXT, PRIMARY KEY(post_id, user_id));
CREATE TABLE IF NOT EXISTS follows (follower TEXT, following TEXT, created_at INTEGER, PRIMARY KEY(follower, following));
CREATE TABLE IF NOT EXISTS blocks (user_id TEXT, blocked_id TEXT, PRIMARY KEY(user_id, blocked_id));
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY, user_id TEXT, media_url TEXT, media_type TEXT, text TEXT DEFAULT '',
  privacy TEXT DEFAULT 'followers', created_at INTEGER, expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS story_views (story_id TEXT, user_id TEXT, PRIMARY KEY(story_id, user_id));
CREATE TABLE IF NOT EXISTS story_reactions (story_id TEXT, user_id TEXT, emoji TEXT, PRIMARY KEY(story_id, user_id));
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, is_group INTEGER DEFAULT 0, name TEXT, owner_id TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT, user_id TEXT, last_read INTEGER DEFAULT 0, PRIMARY KEY(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT, user_id TEXT, text TEXT DEFAULT '',
  media_url TEXT, media_type TEXT, reply_to TEXT, deleted INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS message_reactions (message_id TEXT, user_id TEXT, emoji TEXT, PRIMARY KEY(message_id, user_id));
CREATE TABLE IF NOT EXISTS shop_items (
  id TEXT PRIMARY KEY, name TEXT, description TEXT DEFAULT '', category TEXT, price INTEGER,
  thumbnail TEXT, model_url TEXT, creator TEXT, active INTEGER DEFAULT 1, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, user_id TEXT, item_id TEXT, price INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, user_id TEXT, amount INTEGER, kind TEXT, note TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS daily_claims (user_id TEXT, day TEXT, amount INTEGER, created_at INTEGER, PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT, actor_id TEXT, type TEXT, text TEXT, link TEXT,
  read INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter_id TEXT, target_type TEXT, target_id TEXT, category TEXT,
  description TEXT, status TEXT DEFAULT 'pending', notes TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, details TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, text TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS follow_requests (follower TEXT, following TEXT, created_at INTEGER, PRIMARY KEY(follower, following));
CREATE TABLE IF NOT EXISTS gift_cards (
  id TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL,
  created_by TEXT, redeemed_by TEXT, disabled INTEGER DEFAULT 0,
  created_at INTEGER, redeemed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, expires_at);
`)

export const now = () => Date.now()
export const newId = () => crypto.randomBytes(12).toString('hex')
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10)

/* ---------- seed marketplace / avatar shop ---------- */
const thumb = (a, b, label, emoji) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="240" height="240" rx="28" fill="url(#g)"/><circle cx="120" cy="104" r="54" fill="rgba(255,255,255,.16)"/><text x="120" y="128" font-size="64" text-anchor="middle">${emoji}</text><text x="120" y="205" font-size="24" font-weight="700" font-family="system-ui,sans-serif" fill="#fff" text-anchor="middle">${label}</text></svg>`
  )

const SEED_ITEMS = [
  { name: 'Neon Ronin', category: 'avatars', price: 1200, emoji: '🥷', c1: '#7c3aed', c2: '#06b6d4', description: 'A cyber-samurai avatar with emissive trim.' },
  { name: 'Pixel Skater', category: 'avatars', price: 650, emoji: '🛹', c1: '#f97316', c2: '#ec4899', description: 'Street-style avatar with board accessory.' },
  { name: 'Astro Pal', category: 'avatars', price: 900, emoji: '👨‍🚀', c1: '#0ea5e9', c2: '#22d3ee', description: 'Space helmet included. Zero gravity vibes.' },
  { name: 'Bubblegum Beast', category: 'avatars', price: 480, emoji: '🐲', c1: '#ec4899', c2: '#8b5cf6', description: 'Friendly little dragon avatar.' },
  { name: 'Aurora Wings', category: 'accessories', price: 350, emoji: '🪽', c1: '#22d3ee', c2: '#a78bfa', description: 'Animated aurora back accessory.' },
  { name: 'Shades of Doom', category: 'accessories', price: 150, emoji: '🕶️', c1: '#334155', c2: '#0f172a', description: 'Glasses attachment, head bone.' },
  { name: 'Emote: Hype Dance', category: 'emotes', price: 220, emoji: '💃', c1: '#f43f5e', c2: '#f59e0b', description: 'World emote animation pack.' },
  { name: 'Emote: Confetti', category: 'emotes', price: 90, emoji: '🎉', c1: '#8b5cf6', c2: '#f472b6', description: 'Burst confetti in the 3D world.' }
]

export function seed() {
  const items = db.prepare('SELECT COUNT(*) c FROM shop_items').get().c
  if (items > 0) return
  const insert = db.prepare(
    'INSERT INTO shop_items (id,name,description,category,price,thumbnail,model_url,creator,active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)'
  )
  for (const it of SEED_ITEMS) {
    insert.run(newId(), it.name, it.description, it.category, it.price, thumb(it.c1, it.c2, it.name, it.emoji), null, 'ASC Studio', now())
  }

  // system account: posts platform announcements into the feed (not loginable)
  const sysId = newId()
  db.prepare(
    'INSERT INTO users (id,username,email,pass_hash,display_name,bio,role,coins,verified,privacy,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    sysId, 'asc_official', 'official@avatarverse.local', hash('!' + Math.random().toString(36).slice(2)),
    'ASC Official', 'Welcome to Avatarverse — the social universe of Avatar Social Club. Buy avatars, earn coins, hang out in the world.',
    'moderator', 0, 1, 'public', now()
  )
  const post = db.prepare('INSERT INTO posts (id,user_id,kind,text,views,created_at) VALUES (?,?,?,?,0,?)')
  post.run(newId(), sysId, 'post', '🌐 Welcome to Avatarverse! Claim your **daily 100 coins** in Wallet, then grab an avatar in the Marketplace. See you in the World. #welcome #avatarverse', now() - 1000 * 60 * 90)
  post.run(newId(), sysId, 'post', '🎮 Play Flappy ASC in Games to earn extra coins. 🐦 #games #coins', now() - 1000 * 60 * 40)
  post.run(newId(), sysId, 'post', '📸 Post your best avatar fits — the Explore page is live. #avatars #fashion', now() - 1000 * 60 * 10)
}
seed()

/* ---------- shared helpers ---------- */
export function notify(userId, actorId, type, text, link) {
  if (!userId) return
  db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,text,link,read,created_at) VALUES (?,?,?,?,?,?,0,?)').run(
    newId(), userId, actorId || null, type, text || '', link || null, now()
  )
}

export function audit(actorId, action, details) {
  db.prepare('INSERT INTO audit_log (id,actor_id,action,details,created_at) VALUES (?,?,?,?,?)').run(
    newId(), actorId || null, action, typeof details === 'string' ? details : JSON.stringify(details), now()
  )
}

export function addCoins(userId, amount, kind, note) {
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, userId)
  db.prepare('INSERT INTO transactions (id,user_id,amount,kind,note,created_at) VALUES (?,?,?,?,?,?)').run(
    newId(), userId, amount, kind, note || '', now()
  )
}

export function publicUser(u, viewerId) {
  if (!u) return null
  const owned = db.prepare('SELECT item_id FROM purchases WHERE user_id = ?').all(u.id).map(r => r.item_id)
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    avatarUrl: u.avatar_url,
    bannerUrl: u.banner_url,
    avatarItemId: u.avatar_item_id,
    role: u.role,
    verified: !!u.verified,
    banned: !!u.banned,
    privacy: u.privacy,
    lastSeen: u.last_seen,
    createdAt: u.created_at,
    coins: u.id === viewerId ? u.coins : undefined,
    ringtone: u.id === viewerId ? u.ringtone : undefined,
    followers: db.prepare('SELECT COUNT(*) c FROM follows WHERE following = ?').get(u.id).c,
    following: db.prepare('SELECT COUNT(*) c FROM follows WHERE follower = ?').get(u.id).c,
    posts: db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id = ?').get(u.id).c,
    isFollowing: viewerId ? !!db.prepare('SELECT 1 FROM follows WHERE follower = ? AND following = ?').get(viewerId, u.id) : false,
    isBlocked: viewerId ? !!db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(viewerId, u.id) : false,
    ownedItems: owned
  }
}
