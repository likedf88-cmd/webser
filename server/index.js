import express from 'express'
import cookieParser from 'cookie-parser'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachUser } from './auth.js'
import { UPLOAD_DIR, db } from './db.js'
import { initRealtime, ZONE_IDS } from './realtime.js'
import { setIO } from './bus.js'
import authRoutes from './routes/auth.js'
import socialRoutes from './routes/social.js'
import messageRoutes from './routes/messages.js'
import economyRoutes from './routes/economy.js'
import adminRoutes from './routes/admin.js'
import avatarRoutes from './routes/avatar.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const server = http.createServer(app)
const PORT = Number(process.env.PORT) || 8787

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})
app.use(attachUser)

app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    zones: ZONE_IDS,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    time: Date.now()
  })
})

app.use('/api', authRoutes)
app.use('/api', socialRoutes)
app.use('/api', messageRoutes)
app.use('/api', economyRoutes)
app.use('/api', avatarRoutes)
app.use('/api/admin', adminRoutes)

// production static build
const dist = path.join(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  if (!err) return next()
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
  console.error('[api error]', req.method, req.originalUrl, err.message)
  res.status(status).json({ error: err.message || 'Request failed' })
})

const io = initRealtime(server.listen(PORT, '0.0.0.0', () => {
  console.log(`ASC api listening on :${PORT}`)
}))

// initRealtime expects an http.Server; socket.io attaches to it
setIO(io)
