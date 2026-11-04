import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useAuth, useSocket, useToast } from '../store'
import { Avatar, EmojiPicker, Empty, GifPicker, Modal, Spinner } from '../components/ui'

export default function MessagesPage() {
  const { user } = useAuth()
  const socket = useSocket()
  const toast = useToast()
  const { id } = useParams()
  const navigate = useNavigate()

  const [convs, setConvs] = useState(null)
  const [active, setActive] = useState(null)
  const [messages, setMessages] = useState([])
  const [members, setMembers] = useState([])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [file, setFile] = useState(null)
  const [picker, setPicker] = useState('')
  const [newChat, setNewChat] = useState(false)
  const [search, setSearch] = useState('')
  const [recording, setRecording] = useState(false)
  const [sending, setSending] = useState(false)
  const bodyRef = useRef(null)
  const recorder = useRef(null)
  const chunks = useRef([])

  const loadConvs = useCallback(async () => {
    try {
      const data = await api('/conversations')
      setConvs(data.conversations)
      return data.conversations
    } catch (e) { toast(e.message, 'error'); return [] }
  }, [toast])

  useEffect(() => { loadConvs() }, [loadConvs])

  const openConversation = useCallback(async (convId) => {
    try {
      const [meta, msgs] = await Promise.all([
        api('/conversations/' + convId),
        api('/conversations/' + convId + '/messages')
      ])
      setActive(meta.conversation)
      setMembers(msgs.members || meta.conversation.members)
      setMessages(msgs.messages)
      await api('/conversations/' + convId + '/read', { method: 'POST' })
      loadConvs()
    } catch (e) { toast(e.message, 'error') }
  }, [loadConvs, toast])

  useEffect(() => {
    if (id) openConversation(id)
    else { setActive(null); setMessages([]) }
  }, [id, openConversation])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages.length, active?.id])

  useEffect(() => {
    if (!socket) return
    const onMsg = ({ conversationId, message }) => {
      if (conversationId === active?.id) {
        setMessages(m => m.some(x => x.id === message.id) ? m : [...m, message])
        api('/conversations/' + conversationId + '/read', { method: 'POST' }).catch(() => {})
      }
      loadConvs()
    }
    const onTyping = ({ conversationId, name }) => {
      if (conversationId === active?.id) {
        setTyping(name + ' is typing')
        clearTimeout(window.__ascTyping)
        window.__ascTyping = setTimeout(() => setTyping(''), 2200)
      }
    }
    const onReaction = ({ messageId, reactions }) =>
      setMessages(m => m.map(x => x.id === messageId ? { ...x, reactions } : x))
    const onDeleted = ({ messageId }) =>
      setMessages(m => m.map(x => x.id === messageId ? { ...x, deleted: true, text: '', mediaUrl: null } : x))
    const onRead = ({ conversationId }) => { if (conversationId === active?.id) loadConvs() }

    socket.on('dm:message', onMsg)
    socket.on('dm:typing', onTyping)
    socket.on('dm:reaction', onReaction)
    socket.on('dm:deleted', onDeleted)
    socket.on('dm:read', onRead)
    return () => {
      socket.off('dm:message', onMsg)
      socket.off('dm:typing', onTyping)
      socket.off('dm:reaction', onReaction)
      socket.off('dm:deleted', onDeleted)
      socket.off('dm:read', onRead)
    }
  }, [socket, active?.id, loadConvs])

  const send = async (extra = {}) => {
    if (!active) return
    const content = extra.text ?? text
    if (!content.trim() && !file && !extra.mediaUrl) return
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('text', content)
      if (replyTo) fd.append('replyTo', replyTo.id)
      if (file) fd.append('media', file)
      if (extra.mediaUrl) fd.append('mediaUrl', extra.mediaUrl)
      const data = await api('/conversations/' + active.id + '/messages', { method: 'POST', form: fd })
      setMessages(m => m.some(x => x.id === data.message.id) ? m : [...m, data.message])
      setText('')
      setFile(null)
      setReplyTo(null)
      setPicker('')
      loadConvs()
    } catch (e) { toast(e.message, 'error') }
    setSending(false)
  }

  const typingPing = () => {
    if (socket && active) socket.emit('dm:typing', { conversationId: active.id })
  }

  const react = async (messageId, emoji) => {
    try { await api('/messages/' + messageId + '/react', { method: 'POST', body: { emoji } }) } catch (e) { toast(e.message, 'error') }
  }

  const removeMessage = async (messageId) => {
    try { await api('/messages/' + messageId, { method: 'DELETE' }) } catch (e) { toast(e.message, 'error') }
  }

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      rec.ondataavailable = e => e.data.size && chunks.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        setFile(new File([blob], 'voice.webm', { type: 'audio/webm' }))
        toast('Voice note ready — press send', 'success')
      }
      rec.start()
      recorder.current = rec
      setRecording(true)
    } catch { toast('Microphone permission denied', 'error') }
  }

  const stopVoice = () => {
    recorder.current?.stop()
    setRecording(false)
  }

  const call = (video) => {
    const others = (active?.members || []).filter(m => m.id !== user.id)
    if (others.length === 0) return toast('Nobody to call here', 'error')
    const names = Object.fromEntries(others.map(m => [m.id, m.displayName]))
    window.__ascStartCall?.(others.map(m => m.id), video, names)
  }

  const filtered = (convs || []).filter(c => c.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="dm">
      <aside className={'dm-list ' + (active ? 'hide-mobile' : '')}>
        <div className="dm-head">
          <div className="row-between">
            <strong>Messages</strong>
            <button className="btn btn-primary btn-sm" onClick={() => setNewChat(true)}>＋ New</button>
          </div>
          <input className="input" placeholder="Search conversations…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {!convs && <Spinner />}
        {convs?.length === 0 && <Empty emoji="💬" title="No chats yet" action={<button className="btn btn-primary btn-sm" onClick={() => setNewChat(true)}>Start a chat</button>} />}
        {filtered.map(c => (
          <button key={c.id} className={'dm-conv ' + (active?.id === c.id ? 'active' : '')} onClick={() => navigate('/messages/' + c.id)}>
            {c.isGroup
              ? <div className="avatar avatar-fallback" style={{ width: 42, height: 42 }}>👥</div>
              : <Avatar user={{ displayName: c.name, avatarUrl: c.avatarUrl }} size={42} />}
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row-between">
                <span className="truncate" style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</span>
                {c.lastMessage && <span className="muted" style={{ fontSize: 10.5 }}>{timeAgo(c.lastMessage.createdAt)}</span>}
              </div>
              <div className="row-between">
                <span className="muted truncate" style={{ fontSize: 12 }}>
                  {c.lastMessage ? (c.lastMessage.text || (c.lastMessage.mediaType === 'audio' ? '🎙 Voice note' : c.lastMessage.mediaType === 'video' ? '🎬 Video' : '📷 Photo')) : 'Say hi 👋'}
                </span>
                {c.unread > 0 && <span className="badge badge-accent">{c.unread}</span>}
              </div>
            </div>
          </button>
        ))}
      </aside>

      {!active ? (
        <div className="dm-thread">
          <Empty emoji="📨" title="Select a conversation" hint="Or start a new chat from the left." />
        </div>
      ) : (
        <div className="dm-thread">
          <div className="dm-thread-head">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/messages')} style={{ display: 'none' }}>←</button>
            {active.isGroup
              ? <div className="avatar avatar-fallback" style={{ width: 38, height: 38 }}>👥</div>
              : <Avatar user={active.members.find(m => m.id !== user.id) || {}} size={38} />}
            <div className="grow">
              <div style={{ fontWeight: 800 }}>{active.name}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {active.isGroup ? `${active.members.length} members` : `@${active.members.find(m => m.id !== user.id)?.username || ''}`}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => call(false)} title="Voice call">📞</button>
            <button className="btn btn-ghost btn-sm" onClick={() => call(true)} title="Video call">🎥</button>
          </div>

          <div className="dm-body" ref={bodyRef}>
            {messages.length === 0 && <Empty emoji="👋" title="No messages yet" hint="Send the first message." />}
            {messages.map(m => (
              <div key={m.id} style={{ display: 'grid', gap: 4, justifyItems: m.mine ? 'end' : 'start', maxWidth: '100%' }}>
                <div className={'bubble ' + (m.mine ? 'mine' : '') + (m.deleted ? ' deleted' : '')}>
                  {!m.mine && active.isGroup && <span className="who">{m.author.displayName}</span>}
                  {m.replyTo && (
                    <div className="reaction-pill" style={{ fontSize: 11 }}>
                      ↩ {m.replyTo.author}: {m.replyTo.text.slice(0, 60)}
                    </div>
                  )}
                  {m.deleted ? <em>Message deleted</em> : (
                    <>
                      {m.text && <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>}
                      {m.mediaType === 'image' || m.mediaType === 'gif'
                        ? <img src={m.mediaUrl} alt="attachment" loading="lazy" />
                        : null}
                      {m.mediaType === 'video' && <video src={m.mediaUrl} controls playsInline />}
                      {m.mediaType === 'audio' && <audio src={m.mediaUrl} controls />}
                      {m.mediaType === 'model' && <a className="btn btn-sm" href={m.mediaUrl} target="_blank" rel="noreferrer">Open 3D file</a>}
                    </>
                  )}
                  <span className="bubble-time">{timeAgo(m.createdAt)}</span>
                </div>
                {m.reactions?.length > 0 && (
                  <div className="reactions">{m.reactions.map(r => <span key={r.emoji} className="reaction-pill">{r.emoji} {r.c}</span>)}</div>
                )}
                <div className="row" style={{ gap: 2, opacity: 0.65 }}>
                  <button className="action" style={{ padding: 2, fontSize: 11 }} onClick={() => setReplyTo(m)}>reply</button>
                  <button className="action" style={{ padding: 2, fontSize: 11 }} onClick={() => react(m.id, '❤️')}>❤️</button>
                  <button className="action" style={{ padding: 2, fontSize: 11 }} onClick={() => react(m.id, '😂')}>😂</button>
                  {m.mine && <button className="action" style={{ padding: 2, fontSize: 11 }} onClick={() => removeMessage(m.id)}>delete</button>}
                </div>
              </div>
            ))}
            <div className="typing">{typing}</div>
          </div>

          <div className="dm-input" style={{ position: 'relative' }}>
            {replyTo && (
              <div className="row-between badge badge-accent" style={{ padding: 8 }}>
                <span className="truncate">Replying to {replyTo.author.displayName}: {replyTo.text?.slice(0, 40)}</span>
                <button className="action" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}
            {file && (
              <div className="row-between badge" style={{ padding: 8 }}>
                <span>📎 {file.name}</span>
                <button className="action" onClick={() => setFile(null)}>✕</button>
              </div>
            )}
            <div className="dm-input-row">
              <label className="btn btn-ghost btn-icon" title="Attach photo, video or voice">
                📎
                <input type="file" accept="image/*,video/*,audio/*" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
              <button className={'btn btn-ghost btn-icon ' + (recording ? 'btn-danger' : '')} onClick={recording ? stopVoice : startVoice} title="Voice note">
                {recording ? '⏹' : '🎙'}
              </button>
              <textarea
                className="input" rows={1} placeholder="Message…" value={text}
                onChange={e => { setText(e.target.value); typingPing() }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              />
              <div className="row" style={{ gap: 2 }}>
                <button className="btn btn-ghost btn-icon" onClick={() => setPicker(p => p === 'emoji' ? '' : 'emoji')}>😊</button>
                <button className="btn btn-ghost btn-icon" onClick={() => setPicker(p => p === 'gif' ? '' : 'gif')}>GIF</button>
              </div>
              <button className="btn btn-primary" onClick={() => send()} disabled={sending}>{sending ? '…' : 'Send'}</button>
            </div>
            {picker === 'emoji' && <EmojiPicker onPick={e => setText(t => t + e)} />}
            {picker === 'gif' && <GifPicker onPick={url => send({ text, mediaUrl: url })} />}
          </div>
        </div>
      )}

      {newChat && (
        <NewChatModal
          onClose={() => setNewChat(false)}
          onCreated={(convId) => { setNewChat(false); loadConvs(); navigate('/messages/' + convId) }}
        />
      )}
    </div>
  )
}

function NewChatModal({ onClose, onCreated }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState([])
  const [name, setName] = useState('')
  const [group, setGroup] = useState(false)

  useEffect(() => {
    api('/friends/suggestions').then(d => setUsers(d.users)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!q.trim()) return
    api('/users/search?q=' + encodeURIComponent(q)).then(d => setUsers(d.users)).catch(() => {})
  }, [q])

  const toggle = (u) => setSelected(s => s.some(x => x.id === u.id) ? s.filter(x => x.id !== u.id) : [...s, u])

  const create = async () => {
    if (!selected.length) return toast('Pick at least one person', 'error')
    try {
      const data = await api('/conversations', {
        method: 'POST',
        body: group || selected.length > 1 ? { userIds: selected.map(u => u.id), name: name || 'Group chat' } : { userId: selected[0].id }
      })
      onCreated(data.id)
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <Modal title="New message" onClose={onClose}>
      <input className="input" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="row wrap">
        {selected.map(u => <span className="chip active" key={u.id} onClick={() => toggle(u)}>@{u.username} ✕</span>)}
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} /> Create a group chat
      </label>
      {group && <input className="input" placeholder="Group name" value={name} onChange={e => setName(e.target.value)} />}
      <div className="stack-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {users.map(u => (
          <button key={u.id} className={'list-item'} style={{ border: 'none', background: selected.some(s => s.id === u.id) ? 'var(--panel-2)' : 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => toggle(u)}>
            <Avatar user={u} size={36} />
            <div className="grow">
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u.displayName}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>@{u.username}</div>
            </div>
            {selected.some(s => s.id === u.id) && <span>✓</span>}
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={create}>Start chat</button>
      </div>
    </Modal>
  )
}
