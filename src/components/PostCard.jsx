import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, compact, timeAgo, RANK } from '../api'
import { useAuth, useToast } from '../store'
import { Avatar, Modal, RichText } from './ui'

export default function PostCard({ post, onUpdate, compactMode = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const [p, setP] = useState(post)
  const [open, setOpen] = useState(!compactMode)
  const [comments, setComments] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(false)
  const [reason, setReason] = useState('harassment')
  const lastTap = useRef(0)
  const mediaRef = useRef(null)

  useEffect(() => { setP(post) }, [post])

  const update = (patch) => {
    const next = { ...p, ...patch }
    setP(next)
    onUpdate?.(next)
  }

  const like = async () => {
    try {
      const data = await api('/posts/' + p.id + '/like', { method: 'POST' })
      update({ liked: data.liked, likes: data.likes })
    } catch (e) { toast(e.message, 'error') }
  }

  const save = async () => {
    try {
      const data = await api('/posts/' + p.id + '/save', { method: 'POST' })
      update({ saved: data.saved })
      toast(data.saved ? 'Saved to your collection' : 'Removed from saved', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const repost = async () => {
    try {
      const data = await api('/posts/' + p.id + '/repost', { method: 'POST' })
      toast(data.reposted ? 'Reposted to your profile' : 'Repost removed', 'success')
      update({ reposted: data.reposted })
    } catch (e) { toast(e.message, 'error') }
  }

  const share = async () => {
    const url = window.location.origin + '/post/' + p.id
    try { await navigator.clipboard.writeText(url); toast('Link copied', 'success') }
    catch { toast(url, 'info') }
  }

  const loadComments = async () => {
    try {
      const data = await api('/posts/' + p.id + '/comments')
      setComments(data.comments)
    } catch (e) { toast(e.message, 'error') }
  }

  const toggleComments = () => {
    const next = !open
    setOpen(next)
    if (next && !comments) loadComments()
  }

  const addComment = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      const data = await api('/posts/' + p.id + '/comments', { method: 'POST', body: { text: text.trim() } })
      setComments(c => [...(c || []), data.comment])
      setText('')
      update({ comments: p.comments + 1 })
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  const del = async () => {
    if (!confirm('Delete this post?')) return
    try {
      await api('/posts/' + p.id, { method: 'DELETE' })
      toast('Post deleted', 'success')
      update({ deleted: true })
    } catch (e) { toast(e.message, 'error') }
  }

  const submitReport = async () => {
    try {
      await api('/reports', { method: 'POST', body: { targetType: 'post', targetId: p.id, category: reason } })
      toast('Report sent to moderators', 'success')
      setReport(false)
    } catch (e) { toast(e.message, 'error') }
  }

  const onMediaTap = () => {
    const now = Date.now()
    if (now - lastTap.current < 320) {
      if (!p.liked) like()
      const el = mediaRef.current
      if (el) { el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 320) }
    }
    lastTap.current = now
  }

  if (p.deleted) return null
  const canDelete = p.author?.id === user?.id || (RANK[user?.role] || 0) >= RANK.moderator

  return (
    <article className="post">
      <div className="post-head">
        <Link to={'/u/' + p.author.username}><Avatar user={p.author} size={38} /></Link>
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <Link to={'/u/' + p.author.username} style={{ fontWeight: 700, fontSize: 14 }}>{p.author.displayName}</Link>
            {p.author.verified && <span title="Verified">✅</span>}
            <span className="muted" style={{ fontSize: 12 }}>@{p.author.username}</span>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>{timeAgo(p.createdAt)} · {p.kind === 'reel' ? 'Reel' : 'Post'}</div>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setReport(true)}>⋯</button>
        </div>
      </div>

      {p.text && <RichText text={p.text} />}

      {p.repostOf && (
        <div className="repost-card">
          <div className="row" style={{ gap: 6, marginBottom: 4 }}>
            <Avatar user={p.repostOf.author} size={22} />
            <strong style={{ fontSize: 12.5 }}>{p.repostOf.author?.displayName}</strong>
            <span className="muted" style={{ fontSize: 11 }}>@{p.repostOf.author?.username}</span>
          </div>
          {p.repostOf.text && <RichText text={p.repostOf.text} />}
        </div>
      )}

      {p.mediaUrl && (
        <div className="post-media" onDoubleClick={onMediaTap} onClick={onMediaTap} ref={mediaRef}>
          {p.mediaType === 'video'
            ? <video src={p.mediaUrl} controls playsInline preload="metadata" onPlay={() => api('/posts/' + p.id + '/view', { method: 'POST' }).catch(() => {})} />
            : <img src={p.mediaUrl} alt="post media" loading="lazy" />}
        </div>
      )}

      <div className="row-between">
        <div className="post-actions">
          <button className={'action like ' + (p.liked ? 'on' : '')} onClick={like} aria-label="Like">
            {p.liked ? '❤️' : '🤍'} {compact(p.likes)}
          </button>
          <button className="action" onClick={toggleComments}>💬 {compact(p.comments)}</button>
          <button className="action" onClick={repost} title="Repost">🔁 Repost</button>
          <button className="action" onClick={share}>📤 Share</button>
        </div>
        <button className={'action save ' + (p.saved ? 'on' : '')} onClick={save} aria-label="Save">
          {p.saved ? '🔖' : '📑'} Save
        </button>
      </div>

      {open && (
        <div className="comments">
          {comments === null && <div className="muted">Loading comments…</div>}
          {comments?.length === 0 && <div className="muted">No comments yet — start the conversation.</div>}
          {comments?.map(c => (
            <div className="comment" key={c.id}>
              <Avatar user={c.author} size={30} />
              <div className="comment-bubble">
                <Link to={'/u/' + c.author.username} className="name">{c.author.displayName}</Link>
                <div>{c.text}</div>
              </div>
              <span className="muted" style={{ fontSize: 10.5, alignSelf: 'center' }}>{timeAgo(c.createdAt)}</span>
            </div>
          ))}
          <form className="row" onSubmit={addComment}>
            <input className="input" placeholder="Add a comment…" value={text} onChange={e => setText(e.target.value)} maxLength={1000} />
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>Post</button>
          </form>
        </div>
      )}

      {report && (
        <Modal title="Report post" onClose={() => setReport(false)}>
          <div className="field">
            <label className="label">Reason</label>
            <select className="select" value={reason} onChange={e => setReason(e.target.value)}>
              {['harassment', 'threats', 'spam', 'impersonation', 'inappropriate', 'exploitation', 'other'].map(r =>
                <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {canDelete && <button className="btn btn-danger" onClick={() => { setReport(false); del() }}>Delete post</button>}
            <button className="btn btn-ghost" onClick={() => setReport(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitReport}>Send report</button>
          </div>
        </Modal>
      )}
    </article>
  )
}
