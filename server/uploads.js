import multer from 'multer'
import path from 'node:path'
import crypto from 'node:crypto'
import { UPLOAD_DIR } from './db.js'

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'])
const VIDEO = new Set(['.mp4', '.webm', '.mov', '.m4v'])
const AUDIO = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm'])
const MODEL = new Set(['.glb', '.gltf'])

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
})

export const upload = multer({
  storage,
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (IMAGE.has(ext) || VIDEO.has(ext) || AUDIO.has(ext) || MODEL.has(ext)) return cb(null, true)
    cb(new Error('Unsupported file type: ' + ext))
  }
})

export function mediaTypeOf(file) {
  if (!file) return null
  const ext = path.extname(file.filename).toLowerCase()
  const mime = file.mimetype || ''
  if (IMAGE.has(ext)) return 'image'
  if (VIDEO.has(ext)) return mime.startsWith('audio/') ? 'audio' : 'video'
  if (AUDIO.has(ext)) return 'audio'
  if (MODEL.has(ext)) return 'model'
  return null
}

export const fileUrl = (file) => (file ? '/uploads/' + file.filename : null)
