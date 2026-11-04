import { useState } from 'react'
import { useAuth, useToast } from '../store'

export default function AuthPage() {
  const { login, register } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ identifier: '', password: '', username: '', email: '', displayName: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await login(form.identifier, form.password)
      else await register(form)
      toast('Welcome to Avatarverse', 'success')
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <section className="auth-hero">
        <div>
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">🌐</div>
            <div>
              <div className="brand-text">Avatarverse</div>
              <div className="brand-sub">Avatar Social Club</div>
            </div>
          </div>
          <h1 style={{ marginTop: 44 }}>
            Your world.<br />Your <span>avatar</span>.<br />Everyone else.
          </h1>
          <p className="muted" style={{ marginTop: 16, fontSize: 16, maxWidth: 520 }}>
            A social universe where you can post, stream stories, DM, call friends, buy 3D avatars with ASC Coins,
            and hang out on a live multiplayer map — as your avatar, or as a glowing circle until you grab one.
          </p>

          <div className="feature-list">
            {[
              ['🛍️', 'Avatar marketplace', 'Buy or gift avatars and cosmetics with ASC Coins from the shop.'],
              ['🗺️', 'Live world map', 'WASD movement, real players, world chat and emotes.'],
              ['📞', 'Calls that ring', 'Real WebRTC video and voice calls with a ringtone you choose.'],
              ['🪙', 'Earn coins daily', 'Daily 100, Flappy ASC, and gifts from friends.']
            ].map(([icon, title, sub]) => (
              <div className="feature" key={title}>
                <div className="dot">{icon}</div>
                <div>
                  <strong>{title}</strong>
                  <p className="muted">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 32, fontSize: 12 }}>
          First account registered becomes Owner · Ultra Admin.
        </p>
        <div className="auth-blob" />
      </section>

      <section className="auth-panel">
        <form className="auth-card card" onSubmit={submit}>
          <div>
            <h2 style={{ fontSize: 24 }}>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
            <p className="muted">{mode === 'login' ? 'Welcome back to the club.' : 'Pick a username — it becomes your profile URL.'}</p>
          </div>

          <div className="tabs" style={{ marginBottom: 0 }}>
            <button type="button" className={'tab ' + (mode === 'login' ? 'active' : '')} onClick={() => setMode('login')}>Sign in</button>
            <button type="button" className={'tab ' + (mode === 'register' ? 'active' : '')} onClick={() => setMode('register')}>Register</button>
          </div>

          {mode === 'register' && (
            <>
              <div className="field">
                <label className="label">Username</label>
                <input className="input" value={form.username} onChange={set('username')} placeholder="avatarfan" required />
              </div>
              <div className="field">
                <label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required />
              </div>
              <div className="field">
                <label className="label">Display name</label>
                <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Your name" />
              </div>
            </>
          )}

          {mode === 'login' && (
            <div className="field">
              <label className="label">Username or email</label>
              <input className="input" value={form.identifier} onChange={set('identifier')} placeholder="you@example.com" required />
            </div>
          )}

          <div className="field">
            <label className="label">Password</label>
            <input className="input" type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required minLength={6} />
          </div>

          {error && <div className="badge badge-bad" style={{ padding: 10 }}>{error}</div>}

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <p className="muted" style={{ fontSize: 11.5, textAlign: 'center' }}>
            Sessions are httpOnly cookies. Passwords are bcrypt hashed. Never share your login.
          </p>
        </form>
      </section>
    </div>
  )
}
