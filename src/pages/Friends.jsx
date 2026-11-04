import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, compact } from '../api'
import { useAuth, useToast } from '../store'
import { Avatar, Empty, Spinner } from '../components/ui'

export default function FriendsPage() {
  const { user, onlineIds } = useAuth()
  const toast = useToast()
  const [requests, setRequests] = useState([])
  const [suggested, setSuggested] = useState([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([api('/follow-requests'), api('/friends/suggestions')])
      setRequests(r.requests)
      setSuggested(s.users)
    } catch (e) { toast(e.message, 'error') }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!q.trim()) return setResults([])
    api('/users/search?q=' + encodeURIComponent(q)).then(d => setResults(d.users)).catch(() => {})
  }, [q])

  const follow = async (id) => {
    try {
      const r = await api('/users/' + id + '/follow', { method: 'POST' })
      setSuggested(list => list.map(u => u.id === id ? { ...u, isFollowing: r.following } : u))
      toast(r.requested ? 'Follow request sent' : r.following ? 'Following' : 'Unfollowed', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const respond = async (username, accept) => {
    try {
      await api(`/follow-requests/${username}/${accept ? 'accept' : 'decline'}`, { method: 'POST' })
      setRequests(list => list.filter(r => r.follower.username !== username))
      toast(accept ? 'Follow request accepted' : 'Request declined', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  if (loading) return <div className="page"><Spinner label="Finding friends…" /></div>

  return (
    <div className="page">
      <div className="section-title">
        <div>
          <h2>Friends</h2>
          <p className="muted">Follow people to see their stories and posts.</p>
        </div>
      </div>

      <input className="input" placeholder="Search people by name or @username…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 18 }} />

      {q && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="tiny" style={{ marginBottom: 8 }}>Search results</div>
          {results.length === 0 && <p className="muted">No people found.</p>}
          <div className="stack-list">
            {results.map(u => (
              <div className="list-item" key={u.id}>
                <Avatar user={u} size={40} />
                <div className="grow">
                  <Link to={'/u/' + u.username} style={{ fontWeight: 700 }}>{u.displayName}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>@{u.username} · {compact(u.followers)} followers</div>
                </div>
                {u.id !== user.id && <FollowBtn user={u} onToggle={follow} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {requests.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <div className="section-title"><h2>Follow requests · {requests.length}</h2></div>
          <div className="grid grid-2">
            {requests.map(r => (
              <div className="card card-tight row" key={r.follower.id} style={{ justifyContent: 'space-between' }}>
                <Link to={'/u/' + r.follower.username} className="row">
                  <Avatar user={r.follower} size={42} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.follower.displayName}</div>
                    <div className="muted" style={{ fontSize: 12 }}>@{r.follower.username}</div>
                  </div>
                </Link>
                <div className="row">
                  <button className="btn btn-primary btn-sm" onClick={() => respond(r.follower.username, true)}>Accept</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => respond(r.follower.username, false)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-title"><h2>People you may know</h2></div>
        {suggested.length === 0
          ? <Empty emoji="🫂" title="No suggestions yet" hint="Invite friends — more people will show up as the platform grows." />
          : (
            <div className="grid grid-3">
              {suggested.map(u => (
                <div className="card" key={u.id} style={{ display: 'grid', gap: 10, justifyItems: 'center', textAlign: 'center' }}>
                  <Link to={'/u/' + u.username}><Avatar user={u} size={72} ring /></Link>
                  <div>
                    <Link to={'/u/' + u.username} style={{ fontWeight: 700 }}>{u.displayName} {u.verified && '✅'}</Link>
                    <div className="muted" style={{ fontSize: 12 }}>
                      @{u.username} {onlineIds.includes(u.id) && <span style={{ color: 'var(--good)' }}>· online</span>}
                    </div>
                  </div>
                  <p className="muted clamp2" style={{ fontSize: 12 }}>{u.bio || 'New to Avatarverse'}</p>
                  <FollowBtn user={u} onToggle={follow} />
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}

function FollowBtn({ user, onToggle }) {
  return (
    <button className={'btn btn-sm ' + (user.isFollowing ? 'btn-ghost' : 'btn-primary')} onClick={() => onToggle(user.id)}>
      {user.isFollowing ? 'Following' : 'Follow'}
    </button>
  )
}
