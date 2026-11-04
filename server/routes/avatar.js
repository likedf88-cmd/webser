import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { db, now, newId, UPLOAD_DIR } from '../db.js'
import { requireAuth } from '../auth.js'
import { rateLimit } from '../rate.js'
import { analyzeModel, AvatarError, FULL_BONES } from '../avatar.js'

const router = Router()

const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars')
const SRC_DIR = path.join(AVATAR_DIR, 'src')
const OUT_DIR = path.join(AVATAR_DIR, 'out')
fs.mkdirSync(SRC_DIR, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const MAX_BYTES = 20 * 1024 * 1024
const LOOK_KEYS = ['skin', 'hair', 'shirt', 'pants', 'eyes']
const HEX = /^#[0-9a-fA-F]{6}$/
const BONES = [...FULL_BONES, 'back', 'head', 'hips', 'chest', 'handRight', 'handLeft']
const DEFAULT_LOOK = { skin: '#f1c7a8', hair: '#3b2a4a', shirt: '#8b5cf6', pants: '#1f2937', eyes: '#111827' }

const uploadTo = (dir) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => cb(null, newId() + path.extname(file.originalname || '.glb').toLowerCase())
})

const modelUpload = multer({
  storage: uploadTo(SRC_DIR),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (ext !== '.glb' && ext !== '.gltf') return cb(new Error('Avatar models must be .glb or .gltf'))
    cb(null, true)
  }
})

const relUrl = (abs) => '/uploads/' + path.relative(UPLOAD_DIR, abs).split(path.sep).join('/')
const absPath = (url) => (url ? path.join(UPLOAD_DIR, String(url).replace(/^\/uploads\//, '')) : null)

function lookOf(userId) {
  const row = db.prepare('SELECT body FROM avatar_looks WHERE user_id = ?').get(userId)
  let stored = {}
  if (row?.body) { try { stored = JSON.parse(row.body) } catch { stored = {} } }
  return { ...DEFAULT_LOOK, ...stored }
}

function activeAvatarId(userId) {
  const row = db.prepare('SELECT active_avatar_id FROM avatar_looks WHERE user_id = ?').get(userId)
  return row?.active_avatar_id || null
}

function parseJson(text, fallback = null) {
  if (!text) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}

function clientAvatar(row, owner) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    rig: row.rig,
    detail: row.status_detail || '',
    fileName: row.file_name,
    fileSize: row.file_size,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats: parseJson(row.stats),
    skeleton: parseJson(row.skeleton),
    sourceUrl: owner ? row.source_url : undefined,
    url: row.status === 'ready' ? (row.processed_url || row.source_url) : null,
    thumbnail: row.thumbnail || null,
    equipped: false
  }
}

function accessoryList(userId) {
  return db.prepare(
    `SELECT a.item_id, a.bone, s.name, s.model_url, s.thumbnail, s.category
     FROM avatar_accessories a JOIN shop_items s ON s.id = a.item_id WHERE a.user_id = ?`
  ).all(userId).map(r => ({
    itemId: r.item_id, bone: r.bone, name: r.name, modelUrl: r.model_url, thumbnail: r.thumbnail, category: r.category
  }))
}

/** Public, viewer-safe avatar payload used by profiles and the studio. */
export function publicAvatarFor(userId) {
  const activeId = activeAvatarId(userId)
  const row = activeId ? db.prepare('SELECT * FROM avatars WHERE id = ?').get(activeId) : null
  const usable = row && row.status === 'ready' ? row : null
  return {
    id: usable?.id || null,
    url: usable ? (usable.processed_url || usable.source_url) : null,
    rig: usable?.rig || null,
    animations: parseJson(usable?.stats)?.animations || [],
    look: lookOf(userId),
    accessories: accessoryList(userId).filter(a => !!a.modelUrl)
  }
}

/* ------------------------------------------------------------------ */
/* processing pipeline (in-process worker, no external rigging API)    */
/* ------------------------------------------------------------------ */

function setStatus(id, fields) {
  const keys = Object.keys(fields)
  db.prepare(`UPDATE avatars SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...keys.map(k => fields[k]), now(), id)
}

export function processAvatar(id) {
  const row = db.prepare('SELECT * FROM avatars WHERE id = ?').get(id)
  if (!row) return
  setStatus(id, { status: 'processing', status_detail: 'Inspecting model…', error: null })
  try {
    const src = absPath(row.source_url)
    if (!src || !fs.existsSync(src)) throw new AvatarError('Original upload is missing on disk — upload the model again', 'missing-source')
    const buffer = fs.readFileSync(src)
    const result = analyzeModel(buffer, src)
    const stats = { ...result.stats, bytes: result.bytes, format: result.format }

    let processedUrl = null
    if (result.normalized) {
      const outName = row.id + '-rigged.glb'
      const outAbs = path.join(OUT_DIR, outName)
      fs.writeFileSync(outAbs, result.normalized)
      processedUrl = relUrl(outAbs)
    }

    setStatus(id, {
      status: result.rig.status,
      rig: result.rig.kind,
      status_detail: result.rig.detail,
      stats: JSON.stringify(stats),
      skeleton: JSON.stringify({
        standard: 'asc-humanoid-v1',
        coverage: result.rig.mappingCoverage,
        mappedBones: result.rig.mappedBones,
        coreMissing: result.rig.coreMissing,
        fullMissing: result.rig.fullMissing,
        jointCount: result.rig.jointCount,
        warnings: result.rig.warnings,
        joints: result.rig.joints
      }),
      processed_url: processedUrl,
      error: null
    })
  } catch (err) {
    const invalid = err instanceof AvatarError && ['invalid-glb', 'invalid-gltf', 'external-assets', 'unsupported-format', 'missing-source'].includes(err.code)
    setStatus(id, {
      status: invalid || !(err instanceof AvatarError) ? 'failed' : 'unsupported',
      rig: 'none',
      status_detail: err.message || 'Model processing failed',
      error: err.message || 'Model processing failed',
      processed_url: null
    })
    if (!(err instanceof AvatarError)) console.error('[avatar] processing failed', id, err)
  }
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

router.get('/avatar/me', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM avatars WHERE user_id = ? ORDER BY created_at DESC LIMIT 40').all(req.user.id)
  const equipped = activeAvatarId(req.user.id)
  const ownedAccessories = db.prepare(
    `SELECT s.id, s.name, s.thumbnail, s.model_url, s.category FROM purchases p JOIN shop_items s ON s.id = p.item_id
     WHERE p.user_id = ? AND s.category IN ('accessories','emotes','avatars') ORDER BY p.created_at DESC`
  ).all(req.user.id)
  res.json({
    avatars: rows.map(r => ({ ...clientAvatar(r, true), equipped: r.id === equipped })),
    equipped,
    look: lookOf(req.user.id),
    outfits: db.prepare('SELECT * FROM outfits WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
      .map(o => ({ id: o.id, name: o.name, look: parseJson(o.look, {}), createdAt: o.created_at })),
    accessories: accessoryList(req.user.id),
    ownedAccessories: ownedAccessories.map(a => ({
      id: a.id, name: a.name, thumbnail: a.thumbnail, modelUrl: a.model_url, category: a.category
    })),
    limits: { maxBytes: MAX_BYTES, formats: ['.glb', '.gltf'] }
  })
})

router.post('/avatar/upload', requireAuth, rateLimit(8, 600_000, 'avatar-upload'), modelUpload.single('model'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a .glb or .gltf model to upload' })
  const count = db.prepare('SELECT COUNT(*) c FROM avatars WHERE user_id = ?').get(req.user.id).c
  if (count >= 20) return res.status(400).json({ error: 'Avatar limit reached (20). Delete an old model first.' })
  const id = newId()
  db.prepare(
    `INSERT INTO avatars (id,user_id,source_url,file_name,file_size,name,status,rig,attempts,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, req.user.id, relUrl(req.file.path), String(req.file.originalname || '').slice(0, 120),
    req.file.size, String(req.body?.name || req.file.originalname || 'My avatar').slice(0, 60),
    'queued', 'none', 0, now(), now()
  )
  const row = db.prepare('SELECT * FROM avatars WHERE id = ?').get(id)
  setImmediate(() => processAvatar(id))
  res.json({ avatar: { ...clientAvatar(row, true), status: 'queued' } })
})

router.get('/avatar/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM avatars WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Avatar not found' })
  const owner = row.user_id === req.user.id
  if (!owner && row.status !== 'ready') return res.status(403).json({ error: 'This avatar is not ready' })
  res.json({ avatar: { ...clientAvatar(row, owner), equipped: activeAvatarId(row.user_id) === row.id } })
})

router.post('/avatar/:id/retry', requireAuth, rateLimit(10, 60_000, 'avatar-retry'), (req, res) => {
  const row = db.prepare('SELECT * FROM avatars WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Avatar not found' })
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your avatar' })
  setStatus(row.id, { status: 'queued', attempts: row.attempts + 1, status_detail: 'Queued for reprocessing…', error: null })
  setImmediate(() => processAvatar(row.id))
  res.json({ ok: true })
})

router.post('/avatar/:id/select', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM avatars WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Avatar not found' })
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your avatar' })
  if (row.status !== 'ready') return res.status(400).json({ error: 'Only a processed, rig-compatible avatar can be equipped' })
  db.prepare('INSERT INTO avatar_looks (user_id, body, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING')
    .run(req.user.id, JSON.stringify({}), now())
  db.prepare('UPDATE avatar_looks SET active_avatar_id = ?, updated_at = ? WHERE user_id = ?').run(row.id, now(), req.user.id)
  res.json({ ok: true, equipped: row.id, avatar: publicAvatarFor(req.user.id) })
})

router.post('/avatar/deselect', requireAuth, (req, res) => {
  db.prepare('UPDATE avatar_looks SET active_avatar_id = NULL, updated_at = ? WHERE user_id = ?').run(now(), req.user.id)
  res.json({ ok: true })
})

router.delete('/avatar/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM avatars WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Avatar not found' })
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your avatar' })
  db.prepare('DELETE FROM avatars WHERE id = ?').run(row.id)
  if (activeAvatarId(req.user.id) === row.id) {
    db.prepare('UPDATE avatar_looks SET active_avatar_id = NULL WHERE user_id = ?').run(req.user.id)
  }
  for (const url of [row.source_url, row.processed_url]) {
    const abs = absPath(url)
    if (abs && fs.existsSync(abs)) { try { fs.unlinkSync(abs) } catch { /* ignore */ } }
  }
  res.json({ ok: true })
})

/* ---------------- appearance & outfits ---------------- */

function mergeLook(userId, patch) {
  const current = lookOf(userId)
  const next = { ...current }
  for (const key of LOOK_KEYS) {
    if (patch?.[key] === undefined) continue
    if (patch[key] === null || patch[key] === '') continue
    if (typeof patch[key] !== 'string' || !HEX.test(patch[key])) {
      throw new AvatarError(`Invalid colour for ${key} — use a hex value like #8b5cf6`, 'invalid-look')
    }
    next[key] = patch[key].toLowerCase()
  }
  return next
}

function saveLook(userId, look) {
  db.prepare(
    `INSERT INTO avatar_looks (user_id, body, updated_at) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(look), now())
}

router.put('/avatar/look', requireAuth, (req, res) => {
  try {
    const look = mergeLook(req.user.id, req.body || {})
    saveLook(req.user.id, look)
    res.json({ ok: true, look })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post('/avatar/outfits', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40)
  if (!name) return res.status(400).json({ error: 'Give the outfit a name' })
  const count = db.prepare('SELECT COUNT(*) c FROM outfits WHERE user_id = ?').get(req.user.id).c
  if (count >= 20) return res.status(400).json({ error: 'Outfit limit reached (20)' })
  let look
  try { look = mergeLook(req.user.id, req.body?.look || {}) } catch (err) { return res.status(400).json({ error: err.message }) }
  const id = newId()
  db.prepare('INSERT INTO outfits (id,user_id,name,look,created_at) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, name, JSON.stringify(look), now())
  res.json({ ok: true, outfit: { id, name, look, createdAt: now() } })
})

router.delete('/avatar/outfits/:id', requireAuth, (req, res) => {
  const outfit = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!outfit) return res.status(404).json({ error: 'Outfit not found' })
  if (outfit.user_id !== req.user.id) return res.status(403).json({ error: 'Not your outfit' })
  db.prepare('DELETE FROM outfits WHERE id = ?').run(outfit.id)
  res.json({ ok: true })
})

router.post('/avatar/outfits/:id/apply', requireAuth, (req, res) => {
  const outfit = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!outfit) return res.status(404).json({ error: 'Outfit not found' })
  if (outfit.user_id !== req.user.id) return res.status(403).json({ error: 'Not your outfit' })
  const look = { ...lookOf(req.user.id), ...parseJson(outfit.look, {}) }
  saveLook(req.user.id, look)
  res.json({ ok: true, look })
})

/* ---------------- bone attachments ---------------- */

router.post('/avatar/accessories', requireAuth, (req, res) => {
  const itemId = String(req.body?.itemId || '')
  const bone = String(req.body?.bone || 'head')
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(itemId)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  if (!db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ?').get(req.user.id, itemId)) {
    return res.status(403).json({ error: 'You do not own this item' })
  }
  if (!item.model_url) return res.status(400).json({ error: 'This item has no 3D model attached yet' })
  if (!BONES.includes(bone)) return res.status(400).json({ error: 'Unknown attachment point' })
  if (item.category === 'avatars') return res.status(400).json({ error: 'Full avatars are equipped from the Avatar Studio, not attached as accessories' })
  db.prepare(
    'INSERT INTO avatar_accessories (user_id,item_id,bone,created_at) VALUES (?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET bone = excluded.bone'
  ).run(req.user.id, itemId, bone, now())
  res.json({ ok: true })
})

router.delete('/avatar/accessories/:itemId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM avatar_accessories WHERE user_id = ? AND item_id = ?').run(req.user.id, req.params.itemId)
  res.json({ ok: true })
})

/* ---------------- public lookup ---------------- */

router.get('/users/:username/avatar', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase())
  if (!user) return res.status(404).json({ error: 'User not found' })
  const viewer = req.user?.id
  if (user.privacy === 'private' && viewer !== user.id
    && !(viewer && db.prepare('SELECT 1 FROM follows WHERE follower = ? AND following = ?').get(viewer, user.id))) {
    return res.status(403).json({ error: 'This account is private' })
  }
  res.json({ avatar: publicAvatarFor(user.id) })
})

export default router
