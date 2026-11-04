import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, compact } from '../api'
import { Avatar, Empty, Spinner } from '../components/ui'
import { useAuth, useToast } from '../store'

export default function ExplorePage() {
  const { user } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const tag = params.get('tag') || ''
  const [input, setInput] = useState(q)
  const [data, setData] = useState(null)
  const [users, setUsers] = useState([])
  const [tagPosts, setTagPosts] = useState(null)

  useEffect(() => {
    api('/explore').then(setData).catch(e => toast(e.message, 'error'))
  }, [])

  useEffect(() => {
    setInput(q)
    if (q) api('/users/search?q=' + encodeURIComponent(q)).then(d => setUsers(d.users)).catch(() => {})
    else setUsers([])
  }, [q])

  useEffect(() => {
    if (!tag) return setTagPosts(null)
    api('/feed?mode=for-you&limit=25').then(d => {
      setTagPosts(d.posts.filter(p => (p.text || '').toLowerCase().includes('#' + tag.toLowerCase())))
    }).catch(() => setTagPosts([]))
  }, [tag])

  const follow = async (id) => {
    try {
      const r = await api('/users/' + id + '/follow', { method: 'POST' })
      toast(r.requested ? 'Follow request sent' : r.following ? 'Following' : 'Unfollowed', 'success')
      setData(d => ({ ...d, creators: d.creators.map(c => c.id === id ? { ...c, isFollowing: r.following } : c) }))
    } catch (e) { toast(e.message, 'error') }
  }

  if (!data) return <div className="page"><Spinner label="Loading explore…" /></div>

  return (
    <div className="page page-wide">
      <div className="card" style={{ marginBottom: 18 }}>
        <form onSubmit={e => { e.preventDefault(); setParams(input.trim() ? { q: input.trim() } : {}) }} className="row">
          <input className="input" placeholder="Search users, videos, hashtags…" value={input} onChange={e => setInput(e.target.value)} />
          <button className="btn btn-primary">Search</button>
        </form>
        {q && (
          <div style={{ marginTop: 14 }}>
            <div className="tiny">People matching “{q}”</div>
            {users.length === 0 && <p className="muted" style={{ marginTop: 8 }}>No users found.</p>}
            <div className="stack-list" style={{ marginTop: 8 }}>
              {users.map(u => (
                <div className="list-item" key={u.id}>
                  <Avatar user={u} size={38} />
                  <div className="grow">
                    <Link to={'/u/' + u.username} style={{ fontWeight: 700 }}>{u.displayName}</Link>
                    <div className="muted">@{u.username} · {compact(u.followers)} followers</div>
                  </div>
                  {u.id !== user.id && (
                    <button className={'btn btn-sm ' + (u.isFollowing ? 'btn-ghost' : 'btn-primary')} onClick={() => follow(u.id)}>
                      {u.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {tag && (
        <section style={{ marginBottom: 22 }}>
          <div className="section-title">
            <h2>#{tag}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}>Clear</button>
          </div>
          {tagPosts === null && <Spinner />}
          {tagPosts?.length === 0 && <Empty emoji="#️⃣" title="No posts with this hashtag yet" hint="Be the first to post it." />}
          <div className="grid grid-2">
            {tagPosts?.map(p => (
              <Link to={'/post/' + p.id} className="card card-tight" key={p.id}>
                {p.mediaUrl && p.mediaType === 'image' && <img src={p.mediaUrl} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 8 }} />}
                <p className="clamp2">{p.text}</p>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>@{p.author.username} · ❤️ {p.likes}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="split">
        <section>
          <div className="section-title"><h2>Trending posts</h2></div>
          <div className="grid grid-3">
            {data.posts.map(p => (
              <Link to={'/post/' + p.id} key={p.id} className="shop-card">
                {p.mediaType === 'video'
                  ? <video className="shop-thumb" src={p.mediaUrl} muted />
                  : <img className="shop-thumb" src={p.mediaUrl} alt="" loading="lazy" />}
                <div className="shop-body">
                  <div className="row" style={{ gap: 6 }}>
                    <Avatar user={p.author} size={22} />
                    <span className="muted" style={{ fontSize: 12 }}>@{p.author.username}</span>
                  </div>
                  <p className="clamp2" style={{ fontSize: 13 }}>{p.text || 'Media post'}</p>
                  <span className="muted" style={{ fontSize: 11.5 }}>❤️ {compact(p.likes)} · 💬 {compact(p.comments)}</span>
                </div>
              </Link>
            ))}
          </div>
          {data.posts.length === 0 && <Empty emoji="🧭" title="Nothing trending yet" hint="Post something with media to appear here." />}
        </section>

        <aside className="stack">
          <div className="card">
            <div className="tiny" style={{ marginBottom: 10 }}>Trending hashtags</div>
            {data.hashtags.length === 0 && <p className="muted">No hashtags yet.</p>}
            <div className="row wrap">
              {data.hashtags.map(h => (
                <button key={h.tag} className="chip" onClick={() => setParams({ tag: h.tag })}>#{h.tag} · {h.count}</button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="tiny" style={{ marginBottom: 10 }}>Suggested creators</div>
            {data.creators.length === 0 && <p className="muted">Invite friends to join.</p>}
            <div className="stack-list">
              {data.creators.map(c => (
                <div className="list-item" key={c.id}>
                  <Avatar user={c} size={36} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link to={'/u/' + c.username} className="truncate" style={{ fontWeight: 700, display: 'block' }}>{c.displayName}</Link>
                    <span className="muted" style={{ fontSize: 11.5 }}>{compact(c.followers)} followers</span>
                  </div>
                  {c.id !== user.id && (
                    <button className={'btn btn-sm ' + (c.isFollowing ? 'btn-ghost' : 'btn-primary')} onClick={() => follow(c.id)}>
                      {c.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="tiny" style={{ marginBottom: 10 }}>Marketplace picks</div>
            <div className="grid" style={{ gap: 8 }}>
              {data.items.map(i => (
                <Link to="/shop" key={i.id} className="row" style={{ gap: 10 }}>
                  <img src={i.thumbnail} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover' }} />
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{i.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>🪙 {i.price}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {data.announcements?.length > 0 && (
            <div className="card" style={{ borderColor: 'rgba(139,92,246,.4)' }}>
              <div className="tiny" style={{ marginBottom: 8 }}>Platform announcements</div>
              {data.announcements.map(a => <p key={a.id} style={{ fontSize: 13.5, marginBottom: 6 }}>{a.text}</p>)}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
