import { Server } from 'socket.io'
import crypto from 'node:crypto'
import { COOKIE, userFromToken } from './auth.js'
import { db, publicUser, notify } from './db.js'
import { setIO, trackOnline, emitToUser, online } from './bus.js'

export const ZONE_IDS = ['plaza', 'beach', 'club']
const WORLD = { w: 1800, h: 1200 }
const players = new Map() // socket.id -> player
const calls = new Map()   // callId -> { from, video, participants:Set, startedAt }

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

function playerOf(socket, zone) {
  const u = socket.data.user
  const item = u.avatar_item_id ? db.prepare('SELECT thumbnail FROM shop_items WHERE id = ?').get(u.avatar_item_id) : null
  return {
    socketId: socket.id,
    userId: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: item?.thumbnail || u.avatar_url || null,
    zone,
    x: 300 + Math.random() * (WORLD.w - 600),
    y: 300 + Math.random() * (WORLD.h - 600),
    dir: 'down',
    moving: false,
    equipped: u.avatar_item_id || null
  }
}

export function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e6
  })
  setIO(io)

  io.use((socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie || '')[COOKIE]
    const user = userFromToken(token)
    if (!user) return next(new Error('unauthorized'))
    socket.data.user = user
    next()
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    socket.join('user:' + user.id)
    trackOnline(user.id, 1)
    io.emit('presence:update', { userId: user.id, online: true })
    socket.emit('presence:list', [...online.keys()])

    /* ---------------- world ---------------- */
    socket.on('world:join', ({ zone } = {}) => {
      const z = ZONE_IDS.includes(zone) ? zone : 'plaza'
      const prev = players.get(socket.id)
      if (prev) socket.leave('world:' + prev.zone)
      const p = playerOf(socket, z)
      players.set(socket.id, p)
      socket.join('world:' + z)
      const peers = [...players.values()].filter(o => o.zone === z && o.socketId !== socket.id)
      socket.emit('world:state', { you: p, players: peers, zone: z, size: WORLD })
      socket.to('world:' + z).emit('world:join', p)
    })

    socket.on('world:move', (data = {}) => {
      const p = players.get(socket.id)
      if (!p) return
      const x = Math.max(0, Math.min(WORLD.w, Number(data.x) || 0))
      const y = Math.max(0, Math.min(WORLD.h, Number(data.y) || 0))
      p.x = x
      p.y = y
      p.dir = String(data.dir || p.dir).slice(0, 6)
      p.moving = !!data.moving
      socket.to('world:' + p.zone).emit('world:move', { socketId: p.socketId, userId: p.userId, x, y, dir: p.dir, moving: p.moving })
    })

    socket.on('world:chat', ({ text } = {}) => {
      const p = players.get(socket.id)
      if (!p) return
      const clean = String(text || '').slice(0, 240)
      if (!clean.trim()) return
      io.to('world:' + p.zone).emit('world:chat', {
        userId: p.userId, username: p.username, displayName: p.displayName, text: clean, at: Date.now()
      })
    })

    socket.on('world:emote', ({ emote } = {}) => {
      const p = players.get(socket.id)
      if (!p) return
      io.to('world:' + p.zone).emit('world:emote', { userId: p.userId, socketId: p.socketId, emote: String(emote || '👋').slice(0, 4) })
    })

    socket.on('world:whisper', ({ toUserId, text } = {}) => {
      const p = players.get(socket.id)
      if (!p) return
      emitToUser(String(toUserId), 'world:whisper', { from: p.displayName, text: String(text || '').slice(0, 200) })
    })

    /* ---------------- direct messages ---------------- */
    socket.on('dm:typing', ({ conversationId } = {}) => {
      const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, user.id)
      if (!member) return
      const rows = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId)
      for (const r of rows) if (r.user_id !== user.id) emitToUser(r.user_id, 'dm:typing', { conversationId, userId: user.id, name: user.display_name })
    })

    /* ---------------- calls ---------------- */
    socket.on('call:start', ({ to, video = true, conversationId = null } = {}) => {
      const targets = (Array.isArray(to) ? to : [to]).filter(id => id && id !== user.id)
      if (!targets.length) return
      const callId = crypto.randomBytes(8).toString('hex')
      calls.set(callId, { from: user.id, video: !!video, participants: new Set([user.id]), startedAt: Date.now() })
      const payload = {
        callId,
        from: publicUser(user, null),
        video: !!video,
        group: targets.length > 1,
        conversationId
      }
      for (const t of targets) {
        emitToUser(t, 'call:incoming', payload)
        notify(t, user.id, 'call', `${user.display_name} is calling you`, '/messages')
      }
      socket.emit('call:ringing', { callId, to: targets })
    })

    socket.on('call:accept', ({ callId } = {}) => {
      const call = calls.get(callId)
      if (!call) return
      call.participants.add(user.id)
      socket.emit('call:roster', { callId, participants: [...call.participants] })
      for (const p of call.participants) {
        if (p !== user.id) emitToUser(p, 'call:accepted', { callId, by: publicUser(user, null), participants: [...call.participants] })
      }
    })

    socket.on('call:decline', ({ callId } = {}) => {
      const call = calls.get(callId)
      if (call) calls.delete(callId)
      for (const p of call?.participants || []) emitToUser(p, 'call:ended', { callId, reason: 'declined' })
      socket.emit('call:ended', { callId, reason: 'declined' })
    })

    socket.on('call:signal', ({ callId, to, data } = {}) => {
      if (!calls.has(callId)) return
      emitToUser(String(to), 'call:signal', { callId, from: user.id, data })
    })

    socket.on('call:end', ({ callId } = {}) => {
      const call = calls.get(callId)
      if (call) {
        for (const p of call.participants) emitToUser(p, 'call:ended', { callId, reason: 'ended' })
        calls.delete(callId)
      }
      socket.emit('call:ended', { callId, reason: 'ended' })
    })

    socket.on('call:reaction', ({ callId, emoji } = {}) => {
      const call = calls.get(callId)
      if (!call) return
      for (const p of call.participants) emitToUser(p, 'call:reaction', { emoji: String(emoji || '❤️').slice(0, 4), from: user.display_name })
    })

    socket.on('disconnect', () => {
      trackOnline(user.id, -1)
      io.emit('presence:update', { userId: user.id, online: online.has(user.id) })
      const p = players.get(socket.id)
      if (p) {
        io.to('world:' + p.zone).emit('world:leave', { socketId: p.socketId, userId: p.userId })
        players.delete(socket.id)
      }
      for (const [callId, call] of calls) {
        if (call.participants.has(user.id) || call.from === user.id) {
          for (const pid of call.participants) emitToUser(pid, 'call:ended', { callId, reason: 'disconnected' })
          calls.delete(callId)
        }
      }
    })
  })

  return io
}

export { WORLD }
