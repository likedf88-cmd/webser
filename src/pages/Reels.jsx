import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, compact, timeAgo } from '../api'
import { useAuth, useToast } from '../store'
import { Avatar, Empty, Spinner } from '../components/ui'

export default function ReelsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [reels, setReels] = useState([])
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(null)
  const [done, setDone] = useState(false)
  const wrap = useRef(null)

  const load = async (reset = false) => {
    try {
      const data = await api(`/reels${reset || !cursor ? '' : '?cursor=' + cursor}`)
      setReels(prev => reset ? data.reels : [...prev, ...data.reels])
      setCursor(data.nextCursor)
      setDone(data.reels.length === 0)
    } catch (e) { toast(e.message, 'error') }
    setLoading(false)
  }

  useEffect(() => { load(true) }, [])

  useEffect(() => {
    const root = wrap.current
    if (!root) return
    const videos = [...root.querySelectorAll('video')]
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const v = entry.target
        if (entry.isIntersecting) {
          v.play().catch(() => {})
          const id = v.dataset.post
          if (id) api('/posts/' + id + '/view', { method: 'POST' }).catch(() => {})
        } else v.pause()
      })
    }, { threshold: 0.6 })
    videos.forEach(v => obs.observe(v))
    const nearEnd = () => {
      if (root.scrollTop + root.clientHeight > root.scrollHeight - 900 && !loading && !done) load()
    }
    root.addEventListener('scroll', nearEnd)
    return () => { obs.disconnect(); root.removeEventListener('scroll', nearEnd) }
  }, [reels.length, loading, done])

  const like = async (id) => {
    try {
      const data = await api('/posts/' + id + '/like', { method: 'POST' })
      setReels(list => list.map(r => r.id === id ? { ...r, liked: data.liked, likes: data.likes } : r))
    } catch (e) { toast(e.message, 'error') }
  }

  const save = async (id) => {
    try {
      const data = await api('/posts/' + id + '/save', { method: 'POST' })
      setReels(list => list.map(r => r.id === id ? { ...r, saved: data.saved } : r))
      toast(data.saved ? 'Saved' : 'Removed', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const follow = async (id) => {
    try {
      const data = await api('/users/' + id + '/follow', { method: 'POST' })
      setReels(list => list.map(r => r.author.id === id ? { ...r, author: { ...r.author, isFollowing: data.following } } : r))
      toast(data.requested ? 'Request sent' : data.following ? 'Following' : 'Unfollowed', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  if (loading) return <Spinner label="Loading reels…" />
  if (reels.length === 0) {
    return (
      <Empty
        emoji="🎬" title="No reels yet"
        hint="Reels are vertical videos. Upload one from the composer with 'Reel' selected."
        action={<Link className="btn btn-primary" to="/">Go to feed</Link>}
      />
    )
  }

  return (
    <div className="reel-wrap" ref={wrap}>
      {reels.map(r => (
        <div className="reel" key={r.id}>
          <video src={r.mediaUrl} data-post={r.id} loop muted playsInline preload="metadata" onClick={e => e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause()} />
          <div className="reel-overlay">
            <div className="grow">
              <Link to={'/u/' + r.author.username} className="row" style={{ gap: 8, marginBottom: 8 }}>
                <Avatar user={r.author} size={36} />
                <strong style={{ color: '#fff' }}>{r.author.displayName}</strong>
                {r.author.verified && <span>✅</span>}
                {r.author.id !== user.id && (
                  <button className="btn btn-sm btn-primary" onClick={e => { e.preventDefault(); follow(r.author.id) }}>
                    {r.author.isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
              </Link>
              <p className="reel-caption">{r.text}</p>
              <p className="reel-meta">🎵 Original audio · @{r.author.username} · 👁 {compact(r.views)} · {timeAgo(r.createdAt)}</p>
            </div>
            <div className="reel-rail">
              <div style={{ textAlign: 'center', color: '#fff', fontSize: 11 }}>
                <button onClick={() => like(r.id)}>{r.liked ? '❤️' : '🤍'}</button>
                <div>{compact(r.likes)}</div>
              </div>
              <div style={{ textAlign: 'center', color: '#fff', fontSize: 11 }}>
                <button onClick={() => { navigator.clipboard.writeText(window.location.origin + '/post/' + r.id); toast('Link copied', 'success') }}>📤</button>
                <div>Share</div>
              </div>
              <div style={{ textAlign: 'center', color: '#fff', fontSize: 11 }}>
                <button onClick={() => save(r.id)}>{r.saved ? '🔖' : '📑'}</button>
                <div>Save</div>
              </div>
              <div style={{ textAlign: 'center', color: '#fff', fontSize: 11 }}>
                <Link to={'/post/' + r.id}><button>💬</button></Link>
                <div>{compact(r.comments)}</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
