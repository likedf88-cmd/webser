import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, compact, RANK } from './api'
import { useAuth, useLive, useSocket } from './store'
import { Avatar, CallOverlay, Spinner } from './components/ui'
import AuthPage from './pages/Auth'
import FeedPage from './pages/Feed'
import ExplorePage from './pages/Explore'
import ReelsPage from './pages/Reels'
import StoriesPage from './pages/Stories'
import MessagesPage from './pages/Messages'
import FriendsPage from './pages/Friends'
import NotificationsPage from './pages/Notifications'
import WorldPage from './pages/World'
import AvatarStudioPage from './pages/AvatarStudio'
import ShopPage from './pages/Shop'
import WalletPage from './pages/Wallet'
import ProfilePage from './pages/Profile'
import SettingsPage from './pages/Settings'
import AdminPage from './pages/Admin'
import GamesPage from './pages/Games'
import PostPage from './pages/Post'

const NAV = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/explore', label: 'Explore', icon: '🧭' },
  { to: '/reels', label: 'Reels', icon: '🎬' },
  { to: '/stories', label: 'Stories', icon: '📸' },
  { to: '/messages', label: 'Messages', icon: '💬', badge: 'dm' },
  { to: '/friends', label: 'Friends', icon: '🫂' },
  { to: '/world', label: 'World', icon: '🌐' },
  { to: '/avatar', label: 'Avatar Studio', icon: '🧍' },
  { to: '/shop', label: 'Marketplace', icon: '🛍️' },
  { to: '/games', label: 'Games', icon: '🎮' },
  { to: '/wallet', label: 'Wallet', icon: '🪙' },
  { to: '/notifications', label: 'Notifications', icon: '🔔', badge: 'notif' },
  { to: '/settings', label: 'Settings', icon: '⚙️' }
]

export default function App() {
  const { user, ready, refresh } = useAuth()
  const { unread } = useLive()
  const socket = useSocket()
  const location = useLocation()
  const navigate = useNavigate()
  const [dms, setDms] = useState(0)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!user) return
    api('/conversations').then(d => setDms(d.conversations.reduce((a, c) => a + c.unread, 0))).catch(() => {})
  }, [user?.id, location.pathname])

  useEffect(() => {
    if (!socket) return
    const bump = () => setDms(v => v + 1)
    socket.on('dm:message', bump)
    return () => socket.off('dm:message', bump)
  }, [socket])

  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  if (!ready) {
    return <div style={{ minHeight: '100vh' }}><Spinner label="Loading Avatarverse…" /></div>
  }
  if (!user) return <AuthPage />

  const submitSearch = (e) => {
    e.preventDefault()
    if (q.trim()) { navigate('/explore?q=' + encodeURIComponent(q.trim())); setQ('') }
  }

  const isAdmin = (RANK[user.role] || 0) >= RANK.moderator

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <div className="brand-mark">🌐</div>
          <div>
            <div className="brand-text">Avatarverse</div>
            <div className="brand-sub">Avatar Social Club</div>
          </div>
        </Link>
        <nav className="nav">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}>
              <span className="ico">{item.icon}</span>
              <span>{item.label}</span>
              {item.badge === 'notif' && unread > 0 && <span className="pill">{unread > 9 ? '9+' : unread}</span>}
              {item.badge === 'dm' && dms > 0 && <span className="pill">{dms > 9 ? '9+' : dms}</span>}
            </NavLink>
          ))}
          {isAdmin && <NavLink to="/admin" className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}>
            <span className="ico">🛡️</span><span>Admin panel</span>
          </NavLink>}
        </nav>
        <div className="sidebar-foot">
          <Link to={'/u/' + user.username} className="row">
            <Avatar user={user} size={38} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 700, fontSize: 13.5 }}>{user.displayName}</div>
              <div className="muted truncate" style={{ fontSize: 11.5 }}>@{user.username}</div>
            </div>
          </Link>
          <div className="row-between">
            <Link to="/wallet" className="badge badge-warn">🪙 {compact(user.coins)}</Link>
            <Link to="/games" className="badge badge-accent">🎮 Earn</Link>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <Link to="/" className="brand" style={{ display: 'none', padding: 0 }} />
          <form onSubmit={submitSearch} className="grow" style={{ maxWidth: 460 }}>
            <input
              className="input" placeholder="Search people, hashtags…" value={q}
              onChange={e => setQ(e.target.value)} aria-label="Search"
            />
          </form>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <Link to="/wallet" className="badge badge-warn" title="ASC Coins">🪙 {compact(user.coins)}</Link>
            <Link to="/notifications" className="btn btn-ghost btn-sm" title="Notifications">
              🔔{unread > 0 ? ` ${unread}` : ''}
            </Link>
            <Link to={'/u/' + user.username}><Avatar user={user} size={34} /></Link>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/reels" element={<ReelsPage />} />
          <Route path="/stories" element={<StoriesPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:id" element={<MessagesPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/world" element={<WorldPage />} />
          <Route path="/avatar" element={<AvatarStudioPage />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/post/:id" element={<PostPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<div className="center-pad"><h2>404</h2><Link className="btn btn-primary" to="/">Go home</Link></div>} />
        </Routes>
      </main>

      <nav className="mobile-nav">
        {[
          { to: '/', icon: '🏠', label: 'Home', end: true },
          { to: '/explore', icon: '🧭', label: 'Explore' },
          { to: '/reels', icon: '🎬', label: 'Reels' },
          { to: '/world', icon: '🌐', label: 'World' },
          { to: '/messages', icon: '💬', label: 'Chats' },
          { to: '/shop', icon: '🛍️', label: 'Shop' },
          { to: '/wallet', icon: '🪙', label: 'Wallet' },
          { to: '/u/' + user.username, icon: '👤', label: 'Me' }
        ].map(i => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => isActive ? 'active' : ''}>
            <span className="ico">{i.icon}</span><span>{i.label}</span>
          </NavLink>
        ))}
      </nav>

      <CallOverlay />
    </div>
  )
}
