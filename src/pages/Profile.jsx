import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, compact, RANK, timeAgo } from '../api'
import { useAuth, useToast } from '../store'
import { Avatar, Empty, Modal, Spinner } from '../components/ui'

export default function ProfilePage() {
  const { username } = useParams()
  const { user: me, onlineIds, refresh } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('posts')
  const [saved, setSaved] = useState([])
  const [reportOpen, setReportOpen] = useState(false)
  const [reason, setReason] = useState('harassment')

  const load = useCallback(async () => {
    try { setData(await api('/users/' + username)) } catch (e) { toast(e.message, 'error') }
  }, [username, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab === 'saved' && me) api('/saved').then(d => setSaved(d.posts)).catch(() => {})
  }, [tab, me?.id])

  if (!data) return <div className="page"><Spinner label="Loading profile…" /></div>
  if (!data.user) return <div className="page"><Empty emoji="👻" title="User not found" /></div>

  const u = data.user
  const isMe = u.id === me.id
  const posts = data.posts || []
  const reels = posts.filter(p => p.mediaType === 'video')
  const visible = tab === 'reels' ? reels : tab === 'saved' ? saved : posts
  const online = onlineIds.includes(u.id)

  const follow = async () => {
    try {
      const r = await api('/users/' + u.id + '/follow', { method: 'POST' })
      toast(r.requested ? 'Follow request sent — account is private' : r.following ? 'Following' : 'Unfollowed', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const block = async () => {
    if (!confirm('Block @' + u.username + '? They will not be able to find or message you.')) return
    try {
      const r = await api('/users/' + u.id + '/block', { method: 'POST' })
      toast(r.blocked ? 'User blocked' : 'User unblocked', 'success')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const message = async () => {
    try {
      const conv = await api('/conversations', { method: 'POST', body: { userId: u.id } })
      navigate('/messages/' + conv.id)
    } catch (e) { toast(e.message, 'error') }
  }

  const report = async () => {
    try {
      await api('/reports', { method: 'POST', body: { targetType: 'user', targetId: u.id, category: reason } })
      toast('Report submitted to moderators', 'success')
      setReportOpen(false)
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="page">
      <div className="banner">
        {u.bannerUrl && <img src={u.bannerUrl} alt="banner" />}
      </div>

      <div className="profile-head">
        <Avatar user={u} size={118} className="profile-avatar" />
        <div className="grow">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 24 }}>{u.displayName}</h2>
            {u.verified && <span title="Verified account">✅</span>}
            {(RANK[u.role] || 0) >= RANK.moderator && <span className="badge badge-accent">{u.role === 'owner' ? '👑 Owner' : u.role === 'admin' ? '🛡️ Admin' : '🛡️ Moderator'}</span>}
            {online && <span className="badge badge-good">● online</span>}
          </div>
          <div className="muted">@{u.username} · joined {timeAgo(u.createdAt)} ago</div>
          {u.bio && <p style={{ marginTop: 8, maxWidth: 560 }}>{u.bio}</p>}
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          {isMe ? (
            <>
              <Link to="/settings" className="btn btn-primary">Edit profile</Link>
              <Link to="/wallet" className="badge badge-warn">🪙 {compact(u.coins)}</Link>
            </>
          ) : (
            <>
              <button className={'btn ' + (u.isFollowing ? 'btn-ghost' : 'btn-primary')} onClick={follow}>
                {u.isFollowing ? 'Following' : data.requested ? 'Requested' : 'Follow'}
              </button>
              <button className="btn btn-ghost" onClick={message}>💬 Message</button>
              <button className="btn btn-ghost" onClick={() => window.__ascStartCall?.([u.id], true, { [u.id]: u.displayName })}>🎥 Call</button>
              <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(window.location.href).then(() => toast('Profile link copied', 'success'))}>🔗</button>
            </>
          )}
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 18 }}>
        <div className="stats">
          <div className="stat"><b>{compact(u.posts)}</b><span>Posts</span></div>
          <div className="stat"><b>{compact(u.followers)}</b><span>Followers</span></div>
          <div className="stat"><b>{compact(u.following)}</b><span>Following</span></div>
          <div className="stat"><b>{compact(u.ownedItems?.length || 0)}</b><span>Items</span></div>
        </div>
        {!isMe && (
          <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={block}>{u.isBlocked ? 'Unblock' : 'Block'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setReportOpen(true)}>Report</button>
          </div>
        )}
      </div>

      <div className="tabs" style={{ marginTop: 20 }}>
        {[['posts', 'Posts'], ['reels', 'Videos'], ...(isMe ? [['saved', 'Saved']] : [])].map(([id, label]) => (
          <button key={id} className={'tab ' + (tab === id ? 'active' : '')} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {data.locked
        ? <Empty emoji="🔒" title="This account is private" hint="Follow this account to see their posts and stories." />
        : visible.length === 0
          ? <Empty emoji="🖼️" title={tab === 'saved' ? 'Nothing saved yet' : 'No posts here yet'} hint={isMe ? 'Create your first post from the home feed.' : ''} />
          : (
            <div className="post-grid">
              {visible.map(p => (
                <Link to={'/post/' + p.id} className="tile" key={p.id}>
                  {p.mediaType === 'image' && <img src={p.mediaUrl} alt="" loading="lazy" />}
                  {p.mediaType === 'video' && <video src={p.mediaUrl} muted preload="metadata" />}
                  {!p.mediaUrl && <div className="tile-text clamp2">{p.text || 'Text post'}</div>}
                  <div className="tile-overlay">❤️ {p.likes} · 💬 {p.comments}</div>
                </Link>
              ))}
            </div>
          )}

      {reportOpen && (
        <Modal title={'Report @' + u.username} onClose={() => setReportOpen(false)}>
          <div className="field">
            <label className="label">Category</label>
            <select className="select" value={reason} onChange={e => setReason(e.target.value)}>
              {['harassment', 'bullying', 'threats', 'scams', 'impersonation', 'spam', 'inappropriate', 'other'].map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <p className="muted">Reports are reviewed by moderators and admins. Your username is only visible to staff.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setReportOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={report}>Submit report</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
