import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, upload } from '../api'
import { useAuth, useToast } from '../store'
import { Avatar, Empty, Modal, Spinner, StoryViewer } from '../components/ui'
import PostCard from '../components/PostCard'

export default function FeedPage() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState('for-you')
  const [posts, setPosts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [groups, setGroups] = useState([])
  const [viewer, setViewer] = useState(-1)
  const [createStory, setCreateStory] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const sentinel = useRef(null)

  const loadStories = useCallback(() => {
    api('/stories').then(d => setGroups(d.groups || [])).catch(() => {})
  }, [])

  const load = useCallback(async (reset = false) => {
    setLoading(true)
    try {
      const data = await api(`/feed?mode=${mode}${reset || !cursor ? '' : '&cursor=' + cursor}`)
      setPosts(prev => reset ? data.posts : [...prev, ...data.posts])
      setCursor(data.nextCursor)
      setDone(data.posts.length === 0)
    } catch (e) {
      toast(e.message, 'error')
    }
    setLoading(false)
  }, [mode, cursor, toast])

  useEffect(() => {
    setPosts([]); setCursor(null); setDone(false)
    api(`/feed?mode=${mode}`).then(d => { setPosts(d.posts); setCursor(d.nextCursor); setDone(d.posts.length === 0) }).catch(e => toast(e.message, 'error'))
  }, [mode])

  useEffect(() => { loadStories() }, [loadStories])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && !done) load()
    }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [load, loading, done])

  const updatePost = (next) => setPosts(list => list.map(p => p.id === next.id ? next : p))

  const onCreated = (post) => {
    setPosts(list => [post, ...list])
    setComposerOpen(false)
    refresh().catch(() => {})
    toast('Posted 🎉', 'success')
  }

  return (
    <div className="page">
      <div className="story-bar">
        <button className="story-chip" onClick={() => setCreateStory(true)}>
          <div className="story-add">＋</div>
          <span className="lbl">Your story</span>
        </button>
        {groups.map((g, i) => (
          <button key={g.user.id} className="story-chip" onClick={() => setViewer(i)}>
            <div className={'avatar-ring ' + (g.seen ? 'seen' : '')}>
              <Avatar user={g.user} size={54} />
            </div>
            <span className="lbl">{g.user.id === user.id ? 'You' : g.user.displayName}</span>
          </button>
        ))}
      </div>

      <button className="card btn-block" style={{ textAlign: 'left', cursor: 'pointer', marginBottom: 16 }} onClick={() => setComposerOpen(true)}>
        <div className="row">
          <Avatar user={user} size={38} />
          <span className="muted">What's happening in your universe?</span>
          <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>📷 Post</span>
        </div>
      </button>

      <div className="tabs">
        {[['for-you', 'For you'], ['following', 'Following'], ['trending', 'Trending']].map(([id, label]) => (
          <button key={id} className={'tab ' + (mode === id ? 'active' : '')} onClick={() => setMode(id)}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        {posts.length === 0 && !loading && (
          <Empty
            emoji="🪐" title="Nothing here yet"
            hint={mode === 'following' ? 'Follow some people to fill this feed.' : 'Be the first to post something.'}
            action={<button className="btn btn-primary" onClick={() => setComposerOpen(true)}>Create a post</button>}
          />
        )}
        {posts.map(p => <PostCard key={p.id} post={p} onUpdate={updatePost} />)}
        {loading && <Spinner />}
        <div ref={sentinel} style={{ height: 1 }} />
        {done && posts.length > 0 && <p className="muted" style={{ textAlign: 'center', padding: 12 }}>You're all caught up ✨</p>}
      </div>

      {composerOpen && <Composer user={user} onClose={() => setComposerOpen(false)} onCreated={onCreated} />}

      {createStory && (
        <StoryComposer
          onClose={() => setCreateStory(false)}
          onCreated={() => { setCreateStory(false); loadStories(); toast('Story posted — live for 24h', 'success') }}
        />
      )}

      {viewer >= 0 && (
        <StoryViewer
          groups={groups}
          startIndex={viewer}
          onClose={() => setViewer(-1)}
          onChanged={loadStories}
        />
      )}
    </div>
  )
}

export function Composer({ user, onClose, onCreated }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [kind, setKind] = useState('post')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)

  const pick = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 120 * 1024 * 1024) return toast('File is too large (120MB max)', 'error')
    setFile(f)
    setPreview({ url: URL.createObjectURL(f), type: f.type })
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim() && !file) return toast('Add text or media first', 'error')
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('text', text)
      fd.append('kind', kind)
      if (file) fd.append('media', file)
      const data = await upload('/posts', fd)
      onCreated(data.post)
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  return (
    <Modal title="Create" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="composer">
          <Avatar user={user} size={40} />
          <textarea
            className="textarea" style={{ minHeight: 110, border: 'none', background: 'transparent' }}
            placeholder="Share something, tag @friends, add #hashtags…" value={text}
            onChange={e => setText(e.target.value)} maxLength={2000} autoFocus
          />
        </div>

        {preview && (
          <div className="preview-media">
            {preview.type.startsWith('video')
              ? <video src={preview.url} controls />
              : <img src={preview.url} alt="preview" />}
          </div>
        )}

        <div className="row wrap">
          <label className="btn btn-sm">
            📷 Photo / 🎬 Video
            <input type="file" accept="image/*,video/*" onChange={pick} hidden />
          </label>
          <select className="select" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="post">Feed post</option>
            <option value="reel">Reel (video only)</option>
          </select>
          <span className="muted" style={{ marginLeft: 'auto' }}>{text.length}/2000</span>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Publish'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function StoryComposer({ onClose, onCreated }) {
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [privacy, setPrivacy] = useState('followers')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!file && !text.trim()) return toast('Add a photo, video or text', 'error')
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('text', text)
      fd.append('privacy', privacy)
      if (file) fd.append('media', file)
      await upload('/stories', fd)
      onCreated()
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  return (
    <Modal title="New story" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label className="label">Photo or video (disappears in 24h)</label>
          <input className="input" type="file" accept="image/*,video/*" onChange={e => setFile(e.target.files?.[0] || null)} />
        </div>
        <div className="field">
          <label className="label">Caption</label>
          <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder="Add a caption…" maxLength={300} />
        </div>
        <div className="field">
          <label className="label">Who can see it</label>
          <select className="select" value={privacy} onChange={e => setPrivacy(e.target.value)}>
            <option value="followers">Followers only</option>
            <option value="public">Everyone</option>
          </select>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Share story'}</button>
        </div>
      </form>
    </Modal>
  )
}
