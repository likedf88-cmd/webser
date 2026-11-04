import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ZONES } from '../api'
import { useAuth, useSocket, useToast } from '../store'
import { Avatar, Empty } from '../components/ui'

const W = 1800
const H = 1200
const PALETTE = ['#8b5cf6', '#22d3ee', '#ec4899', '#f59e0b', '#34d399', '#f472b6', '#60a5fa']
const colorFor = (id = '') => PALETTE[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]

function drawZone(ctx, zone) {
  if (zone === 'beach') {
    ctx.fillStyle = '#1a1630'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#f2d9a0'
    ctx.fillRect(0, 260, W, H - 260)
    ctx.fillStyle = '#1b6fa8'
    ctx.fillRect(0, 0, W, 260)
    for (let i = 0; i < 26; i++) {
      const x = 80 + (i * 197) % (W - 160)
      const y = 380 + (i * 271) % (H - 520)
      ctx.fillStyle = '#2f855a'
      ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#7b5b2e'
      ctx.fillRect(x - 4, y, 8, 42)
    }
    ctx.fillStyle = 'rgba(255,255,255,.7)'
    ctx.font = 'bold 34px system-ui'
    ctx.fillText('Aurora Beach', 60, 120)
  } else if (zone === 'club') {
    ctx.fillStyle = '#0b0713'
    ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = ['#a855f7', '#22d3ee', '#ec4899'][i % 3]
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(W / 2, H / 2, 120 + i * 55, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 34px system-ui'
    ctx.fillText('Pulse Club', 60, 120)
  } else {
    ctx.fillStyle = '#0c0f1a'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#151a2c'
    ctx.lineWidth = 90
    for (let x = 300; x < W; x += 420) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 300; y < H; y += 380) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    ctx.strokeStyle = 'rgba(34,211,238,.28)'
    ctx.lineWidth = 2
    for (let x = 300; x < W; x += 420) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 300; y < H; y += 380) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
    const blocks = [[80, 80], [520, 120], [980, 80], [1400, 140], [120, 760], [600, 800], [1080, 780], [1460, 820]]
    blocks.forEach(([x, y], i) => {
      ctx.fillStyle = i % 2 ? '#1b2138' : '#20284a'
      ctx.fillRect(x, y, 260, 200)
      ctx.fillStyle = 'rgba(139,92,246,.5)'
      for (let wx = 0; wx < 5; wx++) for (let wy = 0; wy < 3; wy++) ctx.fillRect(x + 24 + wx * 44, y + 26 + wy * 52, 18, 24)
    })
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 34px system-ui'
    ctx.fillText('Neon Plaza', 60, 60)
    ctx.font = '16px system-ui'
    ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.fillText('Shops · apartments · central square · teleport hub', 60, 88)
  }
}

export default function WorldPage() {
  const { user, onlineIds } = useAuth()
  const socket = useSocket()
  const toast = useToast()
  const navigate = useNavigate()
  const [zone, setZone] = useState('plaza')
  const [players, setPlayers] = useState([])
  const [chat, setChat] = useState([])
  const [msg, setMsg] = useState('')
  const [connected, setConnected] = useState(false)
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const me = useRef({ x: 900, y: 600 })
  const others = useRef(new Map())
  const keys = useRef({})
  const emotes = useRef(new Map())
  const imgCache = useRef(new Map())
  const lastSend = useRef(0)
  const zoneRef = useRef(zone)

  useEffect(() => { zoneRef.current = zone }, [zone])

  useEffect(() => {
    if (!socket) return
    const join = () => socket.emit('world:join', { zone })
    join()

    const onState = ({ you, players: peers, size }) => {
      me.current = { x: you.x, y: you.y }
      others.current = new Map(peers.map(p => [p.userId, p]))
      setPlayers(peers)
      setConnected(true)
      setChat(c => [...c.slice(-40), { system: true, text: `Arrived in ${zone}. ${peers.length} player(s) online here.` }])
    }
    const onJoin = (p) => {
      others.current.set(p.userId, p)
      setPlayers([...others.current.values()])
      setChat(c => [...c, { system: true, text: `${p.displayName} joined the world` }])
    }
    const onMove = (p) => {
      const prev = others.current.get(p.userId) || {}
      others.current.set(p.userId, { ...prev, ...p })
    }
    const onLeave = ({ userId }) => {
      others.current.delete(userId)
      setPlayers([...others.current.values()])
    }
    const onChat = (m) => setChat(c => [...c.slice(-60), { ...m }])
    const onEmote = ({ userId, emote }) => {
      emotes.current.set(userId, { emote, until: Date.now() + 2600 })
      setTimeout(() => setPlayers(p => [...p]), 0)
    }
    const onWhisper = ({ from, text }) => {
      setChat(c => [...c.slice(-60), { system: true, text: `🔒 ${from} whispers: ${text}` }])
    }

    socket.on('world:state', onState)
    socket.on('world:join', onJoin)
    socket.on('world:move', onMove)
    socket.on('world:leave', onLeave)
    socket.on('world:chat', onChat)
    socket.on('world:emote', onEmote)
    socket.on('world:whisper', onWhisper)

    return () => {
      socket.off('world:state', onState)
      socket.off('world:join', onJoin)
      socket.off('world:move', onMove)
      socket.off('world:leave', onLeave)
      socket.off('world:chat', onChat)
      socket.off('world:emote', onEmote)
      socket.off('world:whisper', onWhisper)
    }
  }, [socket, zone])

  useEffect(() => {
    const down = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      keys.current[e.key.toLowerCase()] = true
      if (e.key === ' ') e.preventDefault()
    }
    const up = (e) => { keys.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  useEffect(() => {
    let raf
    const loop = () => {
      const canvas = canvasRef.current
      if (!canvas) { raf = requestAnimationFrame(loop); return }
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (canvas.width !== Math.floor(rect.width * dpr)) {
        canvas.width = Math.floor(rect.width * dpr)
        canvas.height = Math.floor(rect.height * dpr)
      }
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const vw = rect.width
      const vh = rect.height

      // movement
      const k = keys.current
      let dx = 0
      let dy = 0
      if (k['a'] || k['arrowleft']) dx -= 1
      if (k['d'] || k['arrowright']) dx += 1
      if (k['w'] || k['arrowup']) dy -= 1
      if (k['s'] || k['arrowdown']) dy += 1
      const sprint = !!k['shift']
      const speed = sprint ? 7 : 4
      const moving = dx || dy
      if (moving) {
        const len = Math.hypot(dx, dy) || 1
        me.current.x = Math.max(20, Math.min(W - 20, me.current.x + (dx / len) * speed))
        me.current.y = Math.max(20, Math.min(H - 20, me.current.y + (dy / len) * speed))
        if (Date.now() - lastSend.current > 90) {
          lastSend.current = Date.now()
          socket?.emit('world:move', {
            x: me.current.x, y: me.current.y,
            dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'),
            moving: true
          })
        }
      } else if (Date.now() - lastSend.current > 400) {
        lastSend.current = Date.now()
        socket?.emit('world:move', { x: me.current.x, y: me.current.y, moving: false })
      }

      // camera
      const camX = Math.max(0, Math.min(W - vw, me.current.x - vw / 2))
      const camY = Math.max(0, Math.min(H - vh, me.current.y - vh / 2))

      ctx.clearRect(0, 0, vw, vh)
      ctx.save()
      ctx.translate(-camX, -camY)
      drawZone(ctx, zoneRef.current)

      const drawPlayer = (id, x, y, name, avatarUrl, isMe) => {
        const bob = moving && isMe ? Math.sin(Date.now() / 120) * 2 : 0
        const py = y + bob
        if (avatarUrl) {
          let img = imgCache.current.get(avatarUrl)
          if (!img) {
            img = new Image()
            img.src = avatarUrl
            img.onload = () => imgCache.current.set(avatarUrl, img)
            imgCache.current.set(avatarUrl, img)
          }
          if (img.complete && img.naturalWidth) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(x, py, 26, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(img, x - 26, py - 26, 52, 52)
            ctx.restore()
            ctx.strokeStyle = isMe ? '#22d3ee' : 'rgba(255,255,255,.6)'
            ctx.lineWidth = 3
            ctx.beginPath(); ctx.arc(x, py, 26, 0, Math.PI * 2); ctx.stroke()
          } else {
            ctx.fillStyle = colorFor(id)
            ctx.beginPath(); ctx.arc(x, py, 24, 0, Math.PI * 2); ctx.fill()
          }
        } else {
          ctx.fillStyle = colorFor(id)
          ctx.beginPath(); ctx.arc(x, py, 24, 0, Math.PI * 2); ctx.fill()
          ctx.strokeStyle = isMe ? '#22d3ee' : 'rgba(255,255,255,.55)'
          ctx.lineWidth = 3
          ctx.stroke()
          ctx.fillStyle = '#fff'
          ctx.font = 'bold 13px system-ui'
          ctx.textAlign = 'center'
          ctx.fillText((name || '?').slice(0, 2).toUpperCase(), x, py + 5)
        }
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(0,0,0,.55)'
        const w = ctx.measureText(name).width + 16
        ctx.fillRect(x - w / 2, py - 52, w, 20)
        ctx.fillStyle = '#fff'
        ctx.font = '600 12px system-ui'
        ctx.fillText(name, x, py - 38)
        const e = emotes.current.get(id)
        if (e && e.until > Date.now()) {
          ctx.font = '24px system-ui'
          ctx.fillText(e.emote, x, py - 64)
        }
        ctx.textAlign = 'left'
      }

      for (const p of others.current.values()) drawPlayer(p.userId, p.x, p.y, p.displayName, p.avatarUrl, false)
      drawPlayer(user.id, me.current.x, me.current.y, user.displayName + ' (you)', user.avatarUrl, true)

      ctx.restore()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [socket, user])

  const sendChat = (e) => {
    e.preventDefault()
    if (!msg.trim()) return
    socket?.emit('world:chat', { text: msg.trim() })
    setMsg('')
  }

  const emote = (e) => {
    socket?.emit('world:emote', { emote: e })
    const firstName = user.displayName
    setChat(c => [...c.slice(-60), { system: true, text: `${firstName} did ${e}` }])
  }

  const messagePlayer = async (p) => {
    try {
      const data = await api('/conversations', { method: 'POST', body: { userId: p.userId } })
      navigate('/messages/' + data.id)
    } catch (e) { toast(e.message, 'error') }
  }

  const followPlayer = async (p) => {
    try {
      const r = await api('/users/' + p.userId + '/follow', { method: 'POST' })
      toast(r.following ? 'Following ' + p.displayName : r.requested ? 'Request sent' : 'Unfollowed', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="page page-wide">
      <div className="section-title">
        <div>
          <h2>Avatarverse World</h2>
          <p className="muted">Move with WASD / arrows · Shift to sprint · chat live with everyone in the zone.</p>
        </div>
        <span className={'badge ' + (connected ? 'badge-good' : 'badge-warn')}>{connected ? '● Live' : 'connecting…'}</span>
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        {ZONES.map(z => (
          <button key={z.id} className={'chip ' + (zone === z.id ? 'active' : '')} onClick={() => { setZone(z.id); setChat([]) }}>
            {z.icon} {z.name}
          </button>
        ))}
      </div>

      <div className="split">
        <div className="world-shell" ref={wrapRef}>
          <canvas className="world-canvas" ref={canvasRef} />
          <div className="world-hud">
            <div className="badge badge-accent">{ZONES.find(z => z.id === zone)?.name}</div>
            <div className="badge">{players.length + 1} in zone</div>
          </div>
          <div className="world-chatlog">
            {chat.slice(-5).map((c, i) => (
              <div className="world-line" key={i}>
                {c.system ? <em style={{ opacity: .8 }}>{c.text}</em> : <><b>{c.displayName}</b> {c.text}</>}
              </div>
            ))}
          </div>
          <div className="dpad">
            {['', '↑', '', '←', '', '→', '', '↓', ''].map((lbl, i) => lbl ? (
              <button
                key={i}
                onPointerDown={() => { keys.current[lbl === '↑' ? 'w' : lbl === '↓' ? 's' : lbl === '←' ? 'a' : 'd'] = true }}
                onPointerUp={() => { keys.current[lbl === '↑' ? 'w' : lbl === '↓' ? 's' : lbl === '←' ? 'a' : 'd'] = false }}
                onPointerLeave={() => { keys.current[lbl === '↑' ? 'w' : lbl === '↓' ? 's' : lbl === '←' ? 'a' : 'd'] = false }}
              >{lbl}</button>
            ) : <span key={i} />)}
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <div className="tiny" style={{ marginBottom: 8 }}>World chat</div>
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6, marginBottom: 10 }}>
              {chat.length === 0 && <p className="muted">Say hi to the zone 👋</p>}
              {chat.map((c, i) => (
                <div key={i} style={{ fontSize: 12.5 }}>
                  {c.system ? <span className="muted">{c.text}</span> : <><b>{c.displayName}</b>: {c.text}</>}
                </div>
              ))}
            </div>
            <form className="row" onSubmit={sendChat}>
              <input className="input" placeholder="Message the world…" value={msg} onChange={e => setMsg(e.target.value)} maxLength={240} />
              <button className="btn btn-primary btn-sm">Send</button>
            </form>
            <div className="row wrap" style={{ marginTop: 8 }}>
              {['👋', '💃', '🕺', '😂', '❤️', '🎉'].map(e => (
                <button key={e} className="chip" onClick={() => emote(e)}>{e}</button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="tiny" style={{ marginBottom: 8 }}>Players here · {players.length}</div>
            {players.length === 0 && <p className="muted">You're alone in this zone. Invite a friend!</p>}
            <div className="stack-list">
              {players.map(p => (
                <div className="list-item" key={p.socketId}>
                  <Avatar user={{ displayName: p.displayName, avatarUrl: p.avatarUrl }} size={36} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 700, fontSize: 13 }}>{p.displayName}</div>
                    <div className="muted" style={{ fontSize: 11 }}>@{p.username} {onlineIds.includes(p.userId) ? '· online' : ''}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => messagePlayer(p)}>💬</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => followPlayer(p)}>＋</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="tiny" style={{ marginBottom: 6 }}>Your look</div>
            <div className="row">
              <Avatar user={user} size={52} />
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{user.displayName}</div>
                <p className="muted" style={{ fontSize: 12 }}>
                  {user.avatarItemId ? 'Wearing your marketplace avatar' : 'Default circle — buy an avatar in the Marketplace'}
                </p>
              </div>
            </div>
            <a className="btn btn-primary btn-sm btn-block" href="/shop" style={{ marginTop: 10 }}>Open Marketplace</a>
          </div>
        </aside>
      </div>
    </div>
  )
}
