import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { initials, timeAgo, RINGTONES } from '../api'
import { useAuth, useSocket, useToast } from '../store'

/* ---------------- atoms ---------------- */

export function Avatar({ user, size = 42, ring = false, seen = false, className = '' }) {
  const label = user?.displayName || user?.username || '?'
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.36) }
  const inner = user?.avatarUrl
    ? <img className={'avatar ' + className} style={style} src={user.avatarUrl} alt={label} />
    : <div className={'avatar avatar-fallback ' + className} style={style}>{initials(label)}</div>
  if (!ring) return inner
  return <div className={'avatar-ring ' + (seen ? 'seen' : '')}>{inner}</div>
}

export function Spinner({ label }) {
  return <div className="center-pad"><div className="spinner" />{label && <p className="muted">{label}</p>}</div>
}

export function Empty({ emoji = '✨', title, hint, action }) {
  return (
    <div className="empty">
      <div className="emoji">{emoji}</div>
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
      {action}
    </div>
  )
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal ' + (wide ? 'modal-lg' : '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="x-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  )
}

export function RichText({ text }) {
  const nodes = useMemo(() => {
    if (!text) return null
    const re = /(#[\p{L}\p{N}_]{2,40}|@[a-zA-Z0-9_.]{3,20})/gu
    const out = []
    let last = 0
    let m
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index))
      const token = m[0]
      if (token.startsWith('#')) {
        out.push(<Link key={m.index} className="mention" to={'/explore?tag=' + encodeURIComponent(token.slice(1))}>{token}</Link>)
      } else {
        out.push(<Link key={m.index} className="mention" to={'/u/' + token.slice(1).toLowerCase()}>{token}</Link>)
      }
      last = m.index + token.length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }, [text])
  return <p className="post-text">{nodes}</p>
}

const EMOJIS = ['😀','😂','🥹','😍','😎','🤩','😭','😡','🤔','👍','👏','🙌','🔥','💜','❤️','✨','🎉','🥳','😴','🤯','🙏','💯','🌐','🕹️','🎮','🏆','💰','🪙','🛍️','📸','🎥','🎧','🕺','💃','🌙','☀️','🍕','🍩','☕','🚀','🪩','🐦','👑','🛡️','⚡','🌈','💎']
const GIFS = [
  'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
  'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif',
  'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
  'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
  'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
  'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
  'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif'
]

export function EmojiPicker({ onPick, className = '' }) {
  return (
    <div className={'popover ' + className}>
      <div className="emoji-grid">
        {EMOJIS.map(e => <button key={e} onClick={() => onPick(e)} type="button">{e}</button>)}
      </div>
    </div>
  )
}

export function GifPicker({ onPick }) {
  return (
    <div className="popover" style={{ width: 340 }}>
      <div className="tiny" style={{ marginBottom: 8 }}>Quick GIFs</div>
      <div className="gif-grid">
        {GIFS.map(g => <img key={g} src={g} alt="gif" loading="lazy" onClick={() => onPick(g)} />)}
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
        GIF search needs a Giphy/Tenor API key — these quick picks work without one.
      </p>
    </div>
  )
}

/* ---------------- ringtone ---------------- */

export function useRingtone(playing, name) {
  useEffect(() => {
    if (!playing) return
    const tone = RINGTONES.find(r => r.id === name) || RINGTONES[0]
    if (!tone.notes.length) return
    let ctx
    try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { return }
    let timer
    const playPattern = () => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      let t = ctx.currentTime
      for (const freq of tone.notes) {
        if (freq) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.0001, t)
          gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
          osc.connect(gain).connect(ctx.destination)
          osc.start(t)
          osc.stop(t + 0.36)
        }
        t += 0.42
      }
    }
    playPattern()
    timer = setInterval(playPattern, 2600)
    return () => { clearInterval(timer); ctx.close().catch(() => {}) }
  }, [playing, name])
}

/* ---------------- WebRTC calls ---------------- */

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }

export function CallOverlay() {
  const { user } = useAuth()
  const socket = useSocket()
  const toast = useToast()
  const [call, setCall] = useState(null)
  const callRef = useRef(null)
  const [remotes, setRemotes] = useState([])
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [facing, setFacing] = useState('user')
  const [seconds, setSeconds] = useState(0)
  const localStream = useRef(null)
  const pcs = useRef(new Map())
  const localVideo = useRef(null)

  const setCallState = useCallback((next) => { callRef.current = next; setCall(next) }, [])

  const cleanup = useCallback(() => {
    localStream.current?.getTracks().forEach(t => t.stop())
    localStream.current = null
    pcs.current.forEach(pc => { try { pc.close() } catch {} })
    pcs.current.clear()
    setRemotes([])
    setMuted(false)
    setCamOff(false)
    setSeconds(0)
    setCallState(null)
  }, [setCallState])

  const getMedia = useCallback(async (video) => {
    if (localStream.current) return localStream.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false })
      localStream.current = stream
      return stream
    } catch (err) {
      toast('Camera/microphone permission denied — call needs both.', 'error')
      throw err
    }
  }, [toast])

  const makePeer = useCallback(async (remoteId, remoteName) => {
    if (!socket || !callRef.current) return null
    if (pcs.current.has(remoteId)) return pcs.current.get(remoteId)
    const stream = await getMedia(callRef.current.video)
    const pc = new RTCPeerConnection(ICE)
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('call:signal', { callId: callRef.current?.callId, to: remoteId, data: { candidate: e.candidate } })
    }
    pc.ontrack = e => {
      const [remoteStream] = e.streams
      setRemotes(prev => {
        const rest = prev.filter(r => r.id !== remoteId)
        return [...rest, { id: remoteId, name: remoteName || 'Guest', stream: remoteStream }]
      })
    }
    pcs.current.set(remoteId, pc)
    return pc
  }, [socket, getMedia])

  /* public API exposed for other pages */
  useEffect(() => {
    const start = async (targets, video = true, names = {}) => {
      if (!user) return toast('Sign in to call', 'error')
      try {
        await getMedia(video)
      } catch { return }
      setCallState({ callId: null, video, incoming: false, ringing: true, group: targets.length > 1, names, connected: false })
      window.__ascCallNames = names
      socket?.emit('call:start', { to: targets, video })
    }
    window.__ascStartCall = start
    return () => { delete window.__ascStartCall }
  }, [socket, user, getMedia, setCallState, toast])

  useEffect(() => {
    if (!socket) return

    const onRinging = ({ callId }) => {
      setCallState({ ...callRef.current, callId, ringing: true })
    }

    const onIncoming = async ({ callId, from, video, group }) => {
      if (callRef.current) {
        socket.emit('call:decline', { callId })
        return
      }
      setCallState({
        callId, video, incoming: true, from, ringing: true, group, connected: false,
        names: { [from.id]: from.displayName }
      })
    }

    const onAccepted = async ({ callId, by, participants }) => {
      const current = callRef.current
      if (!current) return
      setCallState({ ...current, callId, ringing: false, connected: true })
      const pc = await makePeer(by.id, by.displayName)
      if (!pc) return
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socket.emit('call:signal', { callId, to: by.id, data: { sdp: pc.localDescription } })
    }

    const onSignal = async ({ callId, from, data }) => {
      const current = callRef.current
      if (!current) return
      if (data?.sdp?.type === 'offer') {
        const pc = await makePeer(from, window.__ascCallNames?.[from] || 'Guest')
        if (!pc) return
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('call:signal', { callId, to: from, data: { sdp: pc.localDescription } })
        setCallState({ ...current, connected: true, ringing: false })
      } else if (data?.sdp) {
        const pc = pcs.current.get(from)
        if (pc && pc.signalingState !== 'stable') await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      } else if (data?.candidate) {
        const pc = pcs.current.get(from)
        if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)) } catch {} }
      }
    }

    const onEnded = ({ reason }) => {
      if (!callRef.current) return
      toast(reason === 'declined' ? 'Call declined' : 'Call ended', 'info')
      cleanup()
    }

    socket.on('call:ringing', onRinging)
    socket.on('call:incoming', onIncoming)
    socket.on('call:accepted', onAccepted)
    socket.on('call:signal', onSignal)
    socket.on('call:ended', onEnded)
    return () => {
      socket.off('call:ringing', onRinging)
      socket.off('call:incoming', onIncoming)
      socket.off('call:accepted', onAccepted)
      socket.off('call:signal', onSignal)
      socket.off('call:ended', onEnded)
    }
  }, [socket, makePeer, cleanup, setCallState, toast])

  const accepted = call?.connected
  useRingtone(!!call?.ringing, user?.ringtone || 'classic')

  useEffect(() => {
    if (!accepted) return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [accepted])

  useEffect(() => {
    if (localVideo.current && localStream.current) localVideo.current.srcObject = localStream.current
  }, [call, accepted])

  const accept = async () => {
    if (!call) return
    try { await getMedia(call.video) } catch { socket.emit('call:decline', { callId: call.callId }); return }
    socket.emit('call:accept', { callId: call.callId })
    setCallState({ ...call, incoming: false, ringing: false, connected: true })
    window.__ascCallNames = { ...(call.names || {}), [call.from?.id]: call.from?.displayName }
  }

  const decline = () => {
    socket?.emit('call:decline', { callId: call.callId })
    cleanup()
  }

  const hangup = () => {
    socket?.emit('call:end', { callId: call.callId })
    cleanup()
  }

  const toggleMute = () => {
    const track = localStream.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  const toggleCam = () => {
    const track = localStream.current?.getVideoTracks()[0]
    if (!track) return toast('No camera on this call', 'error')
    track.enabled = !track.enabled
    setCamOff(!track.enabled)
  }

  const switchCamera = async () => {
    if (!call?.video) return
    const next = facing === 'user' ? 'environment' : 'user'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next }, audio: false })
      const track = stream.getVideoTracks()[0]
      for (const pc of pcs.current.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) await sender.replaceTrack(track)
      }
      const old = localStream.current?.getVideoTracks()[0]
      if (old) { old.stop(); localStream.current.removeTrack(old) }
      localStream.current.addTrack(track)
      if (localVideo.current) localVideo.current.srcObject = localStream.current
      setFacing(next)
      toast('Camera switched', 'success')
    } catch {
      toast('This device has no second camera', 'error')
    }
  }

  const pip = async () => {
    try { await localVideo.current?.requestPictureInPicture() } catch { toast('Picture-in-picture unavailable', 'error') }
  }

  if (!call) return null

  const nameFor = (id) => call.names?.[id] || remotes.find(r => r.id === id)?.name || 'Guest'
  const dur = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="call-layer">
      <div className="call-card">
        <div className="call-info">
          <strong style={{ fontSize: 16 }}>
            {call.incoming ? `Incoming ${call.video ? 'video' : 'voice'} call` : call.group ? 'Group call' : (call.from ? nameFor(call.from.id) : 'Calling…')}
          </strong>
          <span className="call-status">
            {call.incoming ? (call.from?.displayName || 'Someone') + ' is calling'
              : call.ringing ? 'Ringing…' : dur}
          </span>
        </div>

        <div className={'call-videos ' + (remotes.length > 1 ? 'multi' : '')}>
          {remotes.length === 0 && (
            <div className="call-video">
              {call.incoming && call.from && (
                <>
                  <Avatar user={call.from} size={120} className="ring-avatar" />
                  <div className="tag">{call.from.displayName}</div>
                </>
              )}
              {!call.incoming && <div className="call-status">{call.ringing ? 'Calling…' : 'Connecting media…'}</div>}
            </div>
          )}
          {remotes.map(r => (
            <div className="call-video" key={r.id}>
              <video autoPlay playsInline ref={el => { if (el && el.srcObject !== r.stream) el.srcObject = r.stream }} />
              <div className="tag">{r.name}</div>
            </div>
          ))}
          {call.video && (
            <div className="call-local">
              <video autoPlay playsInline muted ref={localVideo} />
            </div>
          )}
        </div>

        <div className="call-bar">
          {call.incoming ? (
            <>
              <button className="call-btn on" onClick={accept} title="Accept">📞</button>
              <button className="call-btn danger" onClick={decline} title="Decline">✕</button>
            </>
          ) : (
            <>
              <button className={'call-btn ' + (muted ? 'on' : '')} onClick={toggleMute} title="Mute">{muted ? '🔇' : '🎙️'}</button>
              <button className={'call-btn ' + (camOff ? 'on' : '')} onClick={toggleCam} title="Camera">{camOff ? '📷' : '📹'}</button>
              {call.video && <button className="call-btn" onClick={switchCamera} title="Switch camera">🔄</button>}
              <button className="call-btn" onClick={pip} title="Picture in picture">🪟</button>
              <button className="call-btn danger" onClick={hangup} title="End call">📴</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- story viewer ---------------- */

const STORY_EMOJI = ['❤️', '🔥', '😂', '😮', '👏', '💜']

export function StoryViewer({ groups, startIndex = 0, onClose, onChanged }) {
  const { user } = useAuth()
  const toast = useToast()
  const [gi, setGi] = useState(startIndex)
  const [si, setSi] = useState(0)
  const [progress, setProgress] = useState(0)
  const [reply, setReply] = useState('')
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState([])
  const timer = useRef(null)

  const group = groups[gi]
  const story = group?.stories[si]

  useEffect(() => {
    if (!story) return
    setProgress(0)
    api('/stories/' + story.id + '/view', { method: 'POST' }).catch(() => {})
  }, [story?.id])

  useEffect(() => {
    if (!story) return
    clearInterval(timer.current)
    const duration = story.mediaType === 'video' ? 12000 : 6000
    const startedAt = Date.now()
    timer.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - startedAt) / duration) * 100)
      setProgress(pct)
      if (pct >= 100) next()
    }, 100)
    return () => clearInterval(timer.current)
  }, [story?.id])

  const next = useCallback(() => {
    const g = groups[gi]
    if (g && si < g.stories.length - 1) { setSi(si + 1); return }
    if (gi < groups.length - 1) { setGi(gi + 1); setSi(0); return }
    onClose?.()
  }, [gi, si, groups, onClose])

  const prev = () => {
    if (si > 0) return setSi(si - 1)
    if (gi > 0) { setGi(gi - 1); setSi(0) }
  }

  const react = async (emoji) => {
    try {
      await api('/stories/' + story.id + '/react', { method: 'POST', body: { emoji } })
      toast('Reaction sent ' + emoji, 'success')
      onChanged?.()
    } catch (e) { toast(e.message, 'error') }
  }

  const sendReply = async () => {
    if (!reply.trim()) return
    try {
      const { id } = await api('/conversations', { method: 'POST', body: { userId: group.user.id } })
      await api('/conversations/' + id + '/messages', {
        method: 'POST', body: { text: `Replied to your story: ${reply.trim()}` }
      })
      setReply('')
      toast('Reply sent', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const openViewers = async () => {
    try {
      const data = await api('/stories/' + story.id + '/viewers')
      setViewers(data.users)
      setShowViewers(true)
    } catch (e) { toast(e.message, 'error') }
  }

  const remove = async () => {
    try {
      await api('/stories/' + story.id, { method: 'DELETE' })
      toast('Story deleted', 'success')
      onChanged?.()
      onClose?.()
    } catch (e) { toast(e.message, 'error') }
  }

  if (!group || !story) return null
  const mine = group.user.id === user?.id

  return (
    <div className="story-viewer">
      <div className="story-list">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <strong>Stories</strong>
          <button className="x-btn" onClick={onClose}>✕</button>
        </div>
        {groups.map((g, i) => (
          <button key={g.user.id} className={'dm-conv ' + (i === gi ? 'active' : '')} onClick={() => { setGi(i); setSi(0) }}>
            <Avatar user={g.user} size={40} ring seen={g.seen} />
            <div className="grow">
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{g.user.displayName}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{g.stories.length} update{g.stories.length > 1 ? 's' : ''}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="story-stage">
        <div className="story-progress">
          {group.stories.map((s, i) => (
            <div key={s.id} className={'story-bar-seg ' + (i < si ? 'done' : '')}>
              <i style={{ width: i === si ? progress + '%' : i < si ? '100%' : '0%' }} />
            </div>
          ))}
        </div>

        <div className="story-head">
          <Avatar user={group.user} size={38} />
          <div className="grow">
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{group.user.displayName} <span style={{ opacity: .6 }}>@{group.user.username}</span></div>
            <div className="call-status">{timeAgo(story.createdAt)} ago</div>
          </div>
          {mine && <button className="x-btn" onClick={openViewers} title="Viewers">{story.views}</button>}
        </div>

        {story.mediaType === 'video'
          ? <video src={story.mediaUrl} autoPlay muted playsInline onEnded={next} />
          : story.mediaUrl
            ? <img src={story.mediaUrl} alt="story" />
            : <div className="story-text-slide">{story.text || '✨'}</div>}

        {story.mediaUrl && story.text && (
          <div style={{ position: 'absolute', bottom: 78, left: 16, right: 16, color: '#fff', fontWeight: 700, textShadow: '0 2px 10px #000' }}>
            {story.text}
          </div>
        )}

        <button className="x-btn" style={{ position: 'absolute', top: 74, right: 12 }} onClick={prev}>‹</button>
        <button className="x-btn" style={{ position: 'absolute', top: 74, right: 52 }} onClick={next}>›</button>

        <div className="story-actions">
          {mine ? (
            <button className="btn btn-danger btn-sm" onClick={remove}>Delete story</button>
          ) : (
            <>
              <input
                className="input" placeholder="Reply to story…" value={reply}
                onChange={e => setReply(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendReply()}
              />
              <button className="btn btn-primary btn-sm" onClick={sendReply}>Send</button>
              <div className="row" style={{ gap: 2 }}>
                {STORY_EMOJI.map(e => <button key={e} className="action" onClick={() => react(e)}>{e}</button>)}
              </div>
            </>
          )}
        </div>
      </div>

      {showViewers && (
        <Modal title={`Viewers · ${story.views}`} onClose={() => setShowViewers(false)}>
          {viewers.length === 0
            ? <Empty emoji="👀" title="No viewers yet" />
            : <div className="stack-list">
                {viewers.map(v => (
                  <Link className="list-item" key={v.id} to={'/u/' + v.username} onClick={() => setShowViewers(false)}>
                    <Avatar user={v} size={36} />
                    <div className="grow"><div style={{ fontWeight: 700 }}>{v.displayName}</div><div className="muted">@{v.username}</div></div>
                  </Link>
                ))}
              </div>}
        </Modal>
      )}
    </div>
  )
}
