import { Router } from 'express'
import { db, now, newId, notify, publicUser, addCoins } from '../db.js'
import { requireAuth, RANK } from '../auth.js'
import { upload, mediaTypeOf, fileUrl } from '../uploads.js'
import { rateLimit } from '../rate.js'
import { emitToUser } from '../bus.js'
import { publicAvatarFor } from './avatar.js'

const router = Router()
const P = 'p.id,p.user_id,p.kind,p.text,p.media_url,p.media_type,p.repost_of,p.views,p.created_at'
const HOUR = 3600_000

export function postView(p, viewerId) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id)
  const repost = p.repost_of ? db.prepare('SELECT * FROM posts WHERE id = ?').get(p.repost_of) : null
  const repostAuthor = repost ? db.prepare('SELECT * FROM users WHERE id = ?').get(repost.user_id) : null
  return {
    id: p.id,
    kind: p.kind,
    text: p.text,
    mediaUrl: p.media_url,
    mediaType: p.media_type,
    views: p.views,
    createdAt: p.created_at,
    author: publicUser(author, viewerId),
    likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(p.id).c,
    comments: db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ?').get(p.id).c,
    liked: viewerId ? !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(p.id, viewerId) : false,
    saved: viewerId ? !!db.prepare('SELECT 1 FROM saves WHERE post_id = ? AND user_id = ?').get(p.id, viewerId) : false,
    repostOf: repost
      ? { id: repost.id, text: repost.text, mediaUrl: repost.media_url, mediaType: repost.media_type, author: publicUser(repostAuthor, viewerId) }
      : null
  }
}

function blockFilter(viewerId) {
  return viewerId
    ? { extra: ' AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)', params: [viewerId] }
    : { extra: '', params: [] }
}

function visibleAuthor(authorId, viewerId) {
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(authorId)
  if (!author) return false
  if (author.privacy === 'private' && author.id !== viewerId) return false
  return true
}

/* ---------------- feed & posts ---------------- */

router.get('/feed', (req, res) => {
  const viewer = req.user?.id
  const mode = String(req.query.mode || 'for-you')
  const limit = Math.min(Number(req.query.limit) || 8, 25)
  const cursor = Number(req.query.cursor) || now() + 1
  const bf = blockFilter(viewer)
  let where = ` WHERE u.banned = 0 AND p.kind = 'post' AND p.repost_of IS NULL` + bf.extra
  const params = [...bf.params]

  if (mode === 'following') {
    if (!viewer) return res.json({ posts: [] })
    where += ' AND (p.user_id = ? OR p.user_id IN (SELECT following FROM follows WHERE follower = ?))'
    params.push(viewer, viewer)
  }
  where += ' AND p.created_at < ?'
  params.push(cursor)

  const order =
    mode === 'trending'
      ? ` ORDER BY ((SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)) DESC, p.created_at DESC`
      : mode === 'for-you'
        ? ` ORDER BY (((SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) * 2 + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) * 3) * ${HOUR} + p.created_at / 3) DESC`
        : ' ORDER BY p.created_at DESC'

  const rows = db.prepare(`SELECT ${P} FROM posts p JOIN users u ON u.id = p.user_id ${where} ${order} LIMIT ?`).all(...params, limit)
  res.json({ posts: rows.map(r => postView(r, viewer)), nextCursor: rows.length ? rows[rows.length - 1].created_at : null })
})

router.post('/posts', requireAuth, rateLimit(20, 60_000, 'post'), upload.single('media'), (req, res) => {
  const text = String(req.body?.text || '').slice(0, 2000)
  const kind = req.body?.kind === 'reel' ? 'reel' : 'post'
  const type = mediaTypeOf(req.file)
  if (!text && !req.file) return res.status(400).json({ error: 'Add some text or media' })
  if (kind === 'reel' && type !== 'video') return res.status(400).json({ error: 'Reels need a video file' })
  const id = newId()
  db.prepare('INSERT INTO posts (id,user_id,kind,text,media_url,media_type,views,created_at) VALUES (?,?,?,?,?,?,0,?)').run(
    id, req.user.id, kind, text, fileUrl(req.file), type, now()
  )
  // mentions + hashtag notifications
  for (const m of text.matchAll(/@([a-zA-Z0-9_.]{3,20})/g)) {
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(m[1].toLowerCase())
    if (target && target.id !== req.user.id) notify(target.id, req.user.id, 'mention', `${req.user.display_name} mentioned you in a post`, '/')
  }
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  res.json({ post: postView(post, req.user.id) })
})

router.get('/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  res.json({ post: postView(post, req.user?.id) })
})

router.post('/posts/:id/view', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id)
  res.json({ ok: true })
})

router.post('/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  const existing = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id)
  if (existing) {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id)
  } else {
    db.prepare('INSERT INTO likes (post_id,user_id,created_at) VALUES (?,?,?)').run(post.id, req.user.id, now())
    if (post.user_id !== req.user.id) {
      notify(post.user_id, req.user.id, 'like', `${req.user.display_name} liked your post`, '/post/' + post.id)
    }
  }
  const likes = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(post.id).c
  res.json({ liked: !existing, likes })
})

router.post('/posts/:id/save', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  const existing = db.prepare('SELECT 1 FROM saves WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id)
  if (existing) db.prepare('DELETE FROM saves WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id)
  else db.prepare('INSERT INTO saves (post_id,user_id) VALUES (?,?)').run(post.id, req.user.id)
  res.json({ saved: !existing })
})

router.post('/posts/:id/repost', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  const existing = db.prepare('SELECT id FROM posts WHERE user_id = ? AND repost_of = ?').get(req.user.id, post.id)
  if (existing) {
    db.prepare('DELETE FROM posts WHERE id = ?').run(existing.id)
    return res.json({ reposted: false })
  }
  const id = newId()
  db.prepare('INSERT INTO posts (id,user_id,kind,text,repost_of,views,created_at) VALUES (?,?,?,?,?,0,?)').run(
    id, req.user.id, 'repost', req.body?.text || '', post.id, now()
  )
  if (post.user_id !== req.user.id) notify(post.user_id, req.user.id, 'repost', `${req.user.display_name} reposted your post`, '/post/' + post.id)
  res.json({ reposted: true, id })
})

router.delete('/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  const privileged = (RANK[req.user.role] || 0) >= 1
  if (post.user_id !== req.user.id && !privileged) return res.status(403).json({ error: 'Not allowed' })
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id)
  db.prepare('DELETE FROM posts WHERE repost_of = ?').run(post.id)
  res.json({ ok: true })
})

router.get('/posts/:id/comments', (req, res) => {
  const rows = db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC LIMIT 200').all(req.params.id)
  res.json({
    comments: rows.map(c => {
      const author = db.prepare('SELECT * FROM users WHERE id = ?').get(c.user_id)
      return { id: c.id, text: c.text, parentId: c.parent_id, createdAt: c.created_at, author: publicUser(author, req.user?.id) }
    })
  })
})

router.post('/posts/:id/comments', requireAuth, rateLimit(40, 60_000, 'comment'), (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  const text = String(req.body?.text || '').trim().slice(0, 1000)
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' })
  const parentId = req.body?.parentId || null
  const id = newId()
  db.prepare('INSERT INTO comments (id,post_id,user_id,text,parent_id,created_at) VALUES (?,?,?,?,?,?)').run(
    id, post.id, req.user.id, text, parentId, now()
  )
  if (post.user_id !== req.user.id) notify(post.user_id, req.user.id, 'comment', `${req.user.display_name} commented: ${text.slice(0, 60)}`, '/post/' + post.id)
  if (parentId) {
    const parent = db.prepare('SELECT * FROM comments WHERE id = ?').get(parentId)
    if (parent && parent.user_id !== req.user.id) notify(parent.user_id, req.user.id, 'reply', `${req.user.display_name} replied to your comment`, '/post/' + post.id)
  }
  for (const m of text.matchAll(/@([a-zA-Z0-9_.]{3,20})/g)) {
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(m[1].toLowerCase())
    if (target && target.id !== req.user.id) notify(target.id, req.user.id, 'mention', `${req.user.display_name} mentioned you`, '/post/' + post.id)
  }
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({ comment: { id, text, parentId, createdAt: now(), author: publicUser(author, req.user.id) } })
})

router.delete('/comments/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  if (c.user_id !== req.user.id && (RANK[req.user.role] || 0) < 1) return res.status(403).json({ error: 'Not allowed' })
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id)
  res.json({ ok: true })
})

router.get('/reels', (req, res) => {
  const viewer = req.user?.id
  const limit = Math.min(Number(req.query.limit) || 6, 20)
  const cursor = Number(req.query.cursor) || now() + 1
  const rows = db.prepare(
    `SELECT ${P} FROM posts p JOIN users u ON u.id = p.user_id
     WHERE u.banned = 0 AND p.kind = 'post' AND p.media_type = 'video' AND p.created_at < ?
     ORDER BY p.created_at DESC LIMIT ?`
  ).all(cursor, limit)
  res.json({ reels: rows.map(r => postView(r, viewer)), nextCursor: rows.length ? rows[rows.length - 1].created_at : null })
})

router.get('/saved', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT ${P} FROM posts p JOIN saves s ON s.post_id = p.id WHERE s.user_id = ? ORDER BY p.created_at DESC LIMIT 60`
  ).all(req.user.id)
  res.json({ posts: rows.map(r => postView(r, req.user.id)) })
})

/* ---------------- users, follows, friends ---------------- */

router.get('/users/search', (req, res) => {
  const q = String(req.query.q || '').trim().replace(/[%_]/g, '')
  if (!q) return res.json({ users: [] })
  const rows = db.prepare(
    "SELECT * FROM users WHERE banned = 0 AND (username LIKE ? OR display_name LIKE ?) ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.following = users.id) DESC LIMIT 20"
  ).all(`%${q}%`, `%${q}%`)
  res.json({ users: rows.map(u => publicUser(u, req.user?.id)) })
})

router.get('/users/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase())
  if (!u) return res.status(404).json({ error: 'User not found' })
  const viewer = req.user?.id
  const isFollowing = viewer ? !!db.prepare('SELECT 1 FROM follows WHERE follower = ? AND following = ?').get(viewer, u.id) : false
  const locked = u.privacy === 'private' && u.id !== viewer && !isFollowing
  const posts = locked
    ? []
    : db.prepare(`SELECT ${P} FROM posts p WHERE p.user_id = ? AND p.repost_of IS NULL ORDER BY p.created_at DESC LIMIT 40`).all(u.id)
        .map(p => postView(p, viewer))
  const requested = viewer
    ? !!db.prepare('SELECT 1 FROM follow_requests WHERE follower = ? AND following = ?').get(viewer, u.id)
    : false
  res.json({ user: publicUser(u, viewer), posts, locked, requested, avatar3d: publicAvatarFor(u.id) })
})

router.patch('/users/me', requireAuth, upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), (req, res) => {
  const b = req.body || {}
  const fields = []
  const vals = []
  if (b.displayName !== undefined) { fields.push('display_name = ?'); vals.push(String(b.displayName).slice(0, 40)) }
  if (b.bio !== undefined) { fields.push('bio = ?'); vals.push(String(b.bio).slice(0, 300)) }
  if (b.privacy === 'public' || b.privacy === 'private') { fields.push('privacy = ?'); vals.push(b.privacy) }
  if (b.ringtone !== undefined) { fields.push('ringtone = ?'); vals.push(String(b.ringtone).slice(0, 30)) }
  if (req.files?.avatar?.[0]) { fields.push('avatar_url = ?'); vals.push(fileUrl(req.files.avatar[0])) }
  if (req.files?.banner?.[0]) { fields.push('banner_url = ?'); vals.push(fileUrl(req.files.banner[0])) }
  if (b.avatarItemId !== undefined) {
    if (b.avatarItemId === '') { fields.push('avatar_item_id = NULL') }
    else if (db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ?').get(req.user.id, b.avatarItemId)) {
      fields.push('avatar_item_id = ?'); vals.push(String(b.avatarItemId))
    } else return res.status(403).json({ error: 'You do not own that avatar' })
  }
  if (b.removeAvatar === '1') fields.push('avatar_url = NULL')
  if (!fields.length) return res.json({ user: publicUser(req.user, req.user.id) })
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals, req.user.id)
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({ user: publicUser(fresh, req.user.id) })
})

router.post('/users/:id/follow', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' })
  if (target.banned) return res.status(400).json({ error: 'User unavailable' })
  const existing = db.prepare('SELECT 1 FROM follows WHERE follower = ? AND following = ?').get(req.user.id, target.id)
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower = ? AND following = ?').run(req.user.id, target.id)
    return res.json({ following: false })
  }
  db.prepare('DELETE FROM follow_requests WHERE follower = ? AND following = ?').run(req.user.id, target.id)
  if (target.privacy === 'private') {
    db.prepare('INSERT OR IGNORE INTO follow_requests (follower,following,created_at) VALUES (?,?,?)').run(req.user.id, target.id, now())
    notify(target.id, req.user.id, 'follow_request', `${req.user.display_name} requested to follow you`, '/friends')
    return res.json({ following: false, requested: true })
  }
  db.prepare('INSERT INTO follows (follower,following,created_at) VALUES (?,?,?)').run(req.user.id, target.id, now())
  notify(target.id, req.user.id, 'follow', `${req.user.display_name} started following you`, '/u/' + req.user.username)
  res.json({ following: true })
})

router.get('/follow-requests', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM follow_requests WHERE following = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id)
  res.json({
    requests: rows.map(r => ({ follower: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.follower), req.user.id), at: r.created_at }))
  })
})

router.post('/follow-requests/:username/accept', requireAuth, (req, res) => {
  const follower = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase())
  if (!follower) return res.status(404).json({ error: 'User not found' })
  db.prepare('DELETE FROM follow_requests WHERE follower = ? AND following = ?').run(follower.id, req.user.id)
  db.prepare('INSERT OR IGNORE INTO follows (follower,following,created_at) VALUES (?,?,?)').run(follower.id, req.user.id, now())
  notify(follower.id, req.user.id, 'follow_accept', `${req.user.display_name} accepted your follow request`, '/u/' + req.user.username)
  res.json({ ok: true })
})

router.post('/follow-requests/:username/decline', requireAuth, (req, res) => {
  const follower = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase())
  if (!follower) return res.status(404).json({ error: 'User not found' })
  db.prepare('DELETE FROM follow_requests WHERE follower = ? AND following = ?').run(follower.id, req.user.id)
  res.json({ ok: true })
})

router.post('/users/:id/block', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  const existing = db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(req.user.id, target.id)
  if (existing) {
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(req.user.id, target.id)
    return res.json({ blocked: false })
  }
  db.prepare('INSERT INTO blocks (user_id,blocked_id) VALUES (?,?)').run(req.user.id, target.id)
  db.prepare('DELETE FROM follows WHERE follower = ? AND following = ?').run(req.user.id, target.id)
  db.prepare('DELETE FROM follows WHERE follower = ? AND following = ?').run(target.id, req.user.id)
  res.json({ blocked: true })
})

router.get('/friends/suggestions', (req, res) => {
  const viewer = req.user?.id
  const rows = db.prepare(
    `SELECT * FROM users u WHERE u.banned = 0 AND u.id != ? AND u.username != 'asc_official'
     AND u.id NOT IN (SELECT following FROM follows WHERE follower = ?)
     AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)
     ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.following = u.id) DESC LIMIT 12`
  ).all(viewer || '', viewer || '', viewer || '')
  res.json({ users: rows.map(u => publicUser(u, viewer)) })
})

router.get('/users/:username/followers', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase())
  if (!u) return res.status(404).json({ error: 'Not found' })
  const rows = db.prepare('SELECT user_id FROM follows WHERE following = ?').all(u.id)
  res.json({ users: rows.map(r => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id), req.user?.id)) })
})

router.get('/users/:username/following', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase())
  if (!u) return res.status(404).json({ error: 'Not found' })
  const rows = db.prepare('SELECT following FROM follows WHERE follower = ?').all(u.id)
  res.json({ users: rows.map(r => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.following), req.user?.id)) })
})

/* ---------------- stories ---------------- */

router.post('/stories', requireAuth, upload.single('media'), (req, res) => {
  const type = mediaTypeOf(req.file)
  const text = String(req.body?.text || '').slice(0, 300)
  if (!req.file && !text) return res.status(400).json({ error: 'Story needs a photo, video or text' })
  const id = newId()
  db.prepare('INSERT INTO stories (id,user_id,media_url,media_type,text,privacy,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(
    id, req.user.id, fileUrl(req.file), type, text,
    req.body?.privacy === 'public' ? 'public' : 'followers',
    now(), now() + 24 * HOUR
  )
  res.json({ id })
})

router.get('/stories', (req, res) => {
  const viewer = req.user?.id
  const cutoff = now()
  const authors = db.prepare(
    `SELECT DISTINCT u.* FROM stories s JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > ? AND u.banned = 0
     AND (u.id = ? OR u.privacy = 'public' AND s.privacy = 'public' AND u.id != ?
          OR u.id IN (SELECT following FROM follows WHERE follower = ? AND s.privacy = 'followers'))`
  ).all(cutoff, viewer || '', viewer || '', viewer || '')
  const out = authors.map(u => {
    const stories = db.prepare('SELECT * FROM stories WHERE user_id = ? AND expires_at > ? ORDER BY created_at ASC').all(u.id, cutoff)
    const seen = stories.length
      ? stories.every(s => viewer && db.prepare('SELECT 1 FROM story_views WHERE story_id = ? AND user_id = ?').get(s.id, viewer))
      : false
    return {
      user: publicUser(u, viewer),
      seen,
      stories: stories.map(s => ({
        id: s.id, mediaUrl: s.media_url, mediaType: s.media_type, text: s.text,
        createdAt: s.created_at, expiresAt: s.expires_at, mine: s.user_id === viewer,
        views: db.prepare('SELECT COUNT(*) c FROM story_views WHERE story_id = ?').get(s.id).c,
        myReaction: viewer ? db.prepare('SELECT emoji FROM story_reactions WHERE story_id = ? AND user_id = ?').get(s.id, viewer)?.emoji || null : null
      }))
    }
  })
  out.sort((a, b) => Number(a.user.id !== viewer) - Number(b.user.id !== viewer))
  res.json({ groups: out })
})

router.post('/stories/:id/view', requireAuth, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO story_views (story_id,user_id) VALUES (?,?)').run(req.params.id, req.user.id)
  res.json({ ok: true })
})

router.post('/stories/:id/react', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id)
  if (!story) return res.status(404).json({ error: 'Story not found' })
  const emoji = String(req.body?.emoji || '❤️').slice(0, 4)
  db.prepare('INSERT OR REPLACE INTO story_reactions (story_id,user_id,emoji) VALUES (?,?,?)').run(story.id, req.user.id, emoji)
  db.prepare('INSERT OR IGNORE INTO story_views (story_id,user_id) VALUES (?,?)').run(story.id, req.user.id)
  if (story.user_id !== req.user.id) notify(story.user_id, req.user.id, 'story_reaction', `${req.user.display_name} reacted ${emoji} to your story`, '/stories')
  res.json({ ok: true })
})

router.get('/stories/:id/viewers', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id)
  if (!story) return res.status(404).json({ error: 'Not found' })
  if (story.user_id !== req.user.id) return res.status(403).json({ error: 'Only the creator can see viewers' })
  const rows = db.prepare('SELECT user_id FROM story_views WHERE story_id = ?').all(story.id)
  res.json({ users: rows.map(r => publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.user_id), req.user.id)) })
})

router.delete('/stories/:id', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id)
  if (!story) return res.status(404).json({ error: 'Not found' })
  if (story.user_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' })
  db.prepare('DELETE FROM stories WHERE id = ?').run(story.id)
  res.json({ ok: true })
})

/* ---------------- explore & notifications ---------------- */

router.get('/explore', (req, res) => {
  const viewer = req.user?.id
  const posts = db.prepare(
    `SELECT ${P} FROM posts p JOIN users u ON u.id = p.user_id
     WHERE u.banned = 0 AND p.media_url IS NOT NULL
     ORDER BY (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) DESC, p.created_at DESC LIMIT 18`
  ).all().map(p => postView(p, viewer))
  const creators = db.prepare(
    `SELECT * FROM users u WHERE u.banned = 0 AND u.username != 'asc_official'
     ORDER BY (SELECT COUNT(*) FROM follows f WHERE f.following = u.id) DESC LIMIT 6`
  ).all().map(u => publicUser(u, viewer))
  const tagRows = db.prepare("SELECT text FROM posts WHERE created_at > ? LIMIT 400").all(now() - 14 * 24 * HOUR)
  const counts = new Map()
  for (const r of tagRows) for (const m of (r.text || '').matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
    const tag = m[1].toLowerCase()
    counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  const hashtags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }))
  const items = db.prepare('SELECT * FROM shop_items WHERE active = 1 ORDER BY created_at DESC LIMIT 6').all()
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 3').all()
  res.json({ posts, creators, hashtags, items, announcements })
})

router.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 80').all(req.user.id)
  res.json({
    notifications: rows.map(n => ({
      id: n.id, type: n.type, text: n.text, link: n.link, read: !!n.read, createdAt: n.created_at,
      actor: n.actor_id ? publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(n.actor_id), req.user.id) : null
    })),
    unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).c
  })
})

router.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id)
  res.json({ ok: true })
})

router.get('/announcements', (req, res) => {
  res.json({ announcements: db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5').all() })
})

router.post('/reports', requireAuth, rateLimit(10, 60_000, 'report'), (req, res) => {
  const { targetType = 'user', targetId = '', category = 'other', description = '' } = req.body || {}
  const allowed = ['user', 'post', 'comment', 'message', 'story', 'item', 'avatar']
  if (!allowed.includes(targetType)) return res.status(400).json({ error: 'Invalid report type' })
  if (!targetId) return res.status(400).json({ error: 'Missing target' })
  db.prepare('INSERT INTO reports (id,reporter_id,target_type,target_id,category,description,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    newId(), req.user.id, targetType, String(targetId), String(category).slice(0, 40), String(description).slice(0, 1000), 'pending', now()
  )
  res.json({ ok: true })
})

export default router
