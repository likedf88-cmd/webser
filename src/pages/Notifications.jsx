import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useLive, useToast } from '../store'
import { Avatar, Empty, Spinner } from '../components/ui'

const ICONS = {
  like: '❤️', comment: '💬', reply: '↩️', follow: '➕', follow_accept: '✅', follow_request: '🔒',
  mention: '@', message: '💬', gift: '🎁', call: '📞', story_reaction: '✨', daily: '🪙',
  giftcard: '🎟️', moderation: '🛡️', announcement: '📣', repost: '🔁', security: '🔐'
}

export default function NotificationsPage() {
  const toast = useToast()
  const { setUnread, refreshNotifs } = useLive()
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  const load = async () => {
    try {
      const d = await api('/notifications')
      setData(d)
      setUnread(d.unread)
    } catch (e) { toast(e.message, 'error') }
  }

  useEffect(() => { load() }, [])

  const markAll = async () => {
    try {
      await api('/notifications/read', { method: 'POST' })
      setUnread(0)
      setData(d => ({ ...d, notifications: d.notifications.map(n => ({ ...n, read: true })), unread: 0 }))
      refreshNotifs()
      toast('All caught up', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  if (!data) return <div className="page"><Spinner label="Loading notifications…" /></div>

  return (
    <div className="page">
      <div className="section-title">
        <div>
          <h2>Notifications</h2>
          <p className="muted">{data.unread} unread</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={markAll} disabled={data.unread === 0}>Mark all read</button>
      </div>

      {data.notifications.length === 0
        ? <Empty emoji="🔔" title="No notifications yet" hint="Likes, comments, follows, gifts and calls show up here." />
        : (
          <div className="stack">
            {data.notifications.map(n => (
              <button
                key={n.id}
                className="card card-tight row"
                style={{ textAlign: 'left', cursor: n.link ? 'pointer' : 'default', borderColor: n.read ? 'var(--stroke)' : 'rgba(139,92,246,.45)' }}
                onClick={() => n.link && navigate(n.link)}
              >
                <div style={{ fontSize: 20, width: 34, textAlign: 'center' }}>{ICONS[n.type] || '🔔'}</div>
                {n.actor ? <Avatar user={n.actor} size={38} /> : <div className="avatar" style={{ width: 38, height: 38 }}>🌐</div>}
                <div className="grow">
                  <div style={{ fontSize: 13.5 }}>{n.text}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{timeAgo(n.createdAt)} ago</div>
                </div>
                {!n.read && <span className="badge badge-accent">new</span>}
              </button>
            ))}
          </div>
        )}

      <p className="muted" style={{ marginTop: 20, fontSize: 12 }}>
        Notification preferences live in <Link to="/settings" style={{ color: 'var(--accent-2)' }}>Settings</Link>.
      </p>
    </div>
  )
}
