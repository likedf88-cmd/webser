import { useEffect, useState } from 'react'
import { api, RINGTONES, roleLabel, ZONES } from '../api'
import { useAuth, useLive, useToast } from '../store'
import { Avatar, Modal } from '../components/ui'

export default function SettingsPage() {
  const { user, setUser, refresh, logout } = useAuth()
  const { theme, setTheme } = useLive()
  const toast = useToast()
  const [form, setForm] = useState({
    displayName: user.displayName, bio: user.bio || '', privacy: user.privacy,
    ringtone: user.ringtone || 'classic'
  })
  const [avatarFile, setAvatarFile] = useState(null)
  const [bannerFile, setBannerFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '' })
  const [blocked, setBlocked] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    api('/friends/suggestions').catch(() => {})
  }, [])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('displayName', form.displayName)
      fd.append('bio', form.bio)
      fd.append('privacy', form.privacy)
      fd.append('ringtone', form.ringtone)
      if (avatarFile) fd.append('avatar', avatarFile)
      if (bannerFile) fd.append('banner', bannerFile)
      const data = await api('/users/me', { method: 'PATCH', form: fd })
      setUser(data.user)
      toast('Profile saved', 'success')
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  const changePassword = async (e) => {
    e.preventDefault()
    try {
      await api('/auth/password', { method: 'POST', body: pw })
      setPw({ current: '', next: '' })
      toast('Password updated', 'success')
    } catch (err) { toast(err.message, 'error') }
  }

  const exportData = async () => {
    try {
      const [me, wallet, posts] = await Promise.all([
        api('/auth/me'), api('/wallet'), api('/users/' + user.username)
      ])
      const blob = new Blob([JSON.stringify({ me, wallet, posts: posts.posts }, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'avatarverse-' + user.username + '.json'
      a.click()
      toast('Data export downloaded', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const playRingtone = async () => {
    const tone = RINGTONES.find(r => r.id === form.ringtone)
    if (!tone?.notes.length) return toast('Silent mode selected', 'info')
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    let t = ctx.currentTime
    for (const f of tone.notes) {
      if (f) {
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.frequency.value = f; o.type = 'sine'
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.15, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.34)
      }
      t += 0.4
    }
    setTimeout(() => ctx.close().catch(() => {}), 3000)
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="section-title">
        <div><h2>Settings</h2><p className="muted">Profile, privacy, calls and account security.</p></div>
        <span className="badge badge-accent">{roleLabel[user.role] || user.role}</span>
      </div>

      <form className="card stack" onSubmit={save} style={{ marginBottom: 18 }}>
        <div className="tiny">Profile</div>
        <div className="row" style={{ gap: 16 }}>
          <Avatar user={user} size={72} />
          <div className="stack" style={{ gap: 8, flex: 1 }}>
            <div className="field">
              <label className="label">Profile picture</label>
              <input className="input" type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files?.[0] || null)} />
            </div>
            <div className="field">
              <label className="label">Banner image</label>
              <input className="input" type="file" accept="image/*" onChange={e => setBannerFile(e.target.files?.[0] || null)} />
            </div>
          </div>
        </div>
        <div className="field">
          <label className="label">Display name</label>
          <input className="input" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} maxLength={40} />
        </div>
        <div className="field">
          <label className="label">Bio</label>
          <textarea className="textarea" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} maxLength={300} />
        </div>
        <div className="field">
          <label className="label">Account privacy</label>
          <select className="select" value={form.privacy} onChange={e => setForm(f => ({ ...f, privacy: e.target.value }))}>
            <option value="public">Public — anyone can follow and view</option>
            <option value="private">Private — follow requests must be approved</option>
          </select>
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>

      <div className="card stack" style={{ marginBottom: 18 }}>
        <div className="tiny">Appearance</div>
        <div className="row wrap">
          <button className={'btn ' + (theme === 'dark' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTheme('dark')}>🌙 Dark</button>
          <button className={'btn ' + (theme === 'light' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTheme('light')}>☀️ Light</button>
        </div>
        <div className="field" style={{ maxWidth: 320 }}>
          <label className="label">Incoming call ringtone</label>
          <select className="select" value={form.ringtone} onChange={e => setForm(f => ({ ...f, ringtone: e.target.value }))}>
            {RINGTONES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={playRingtone}>▶ Preview ringtone</button>
          <button className="btn btn-ghost btn-sm" onClick={async () => {
            try {
              const fd = new FormData(); fd.append('ringtone', form.ringtone)
              const d = await api('/users/me', { method: 'PATCH', form: fd })
              setUser(d.user); toast('Ringtone saved', 'success')
            } catch (e) { toast(e.message, 'error') }
          }}>Save ringtone</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Ringtone plays for incoming calls in this browser. Your browser may require one click on the page before audio can play.
        </p>
      </div>

      <div className="card stack" style={{ marginBottom: 18 }}>
        <div className="tiny">Security</div>
        <form className="stack" onSubmit={changePassword}>
          <div className="field">
            <label className="label">Current password</label>
            <input className="input" type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} required />
          </div>
          <div className="field">
            <label className="label">New password</label>
            <input className="input" type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} required minLength={6} />
          </div>
          <button className="btn btn-primary">Update password</button>
        </form>
        <p className="muted" style={{ fontSize: 12 }}>Sessions use httpOnly cookies. Changing your password signs out other devices.</p>
      </div>

      <div className="card stack">
        <div className="tiny">Account</div>
        <div className="row wrap">
          <button className="btn btn-ghost" onClick={exportData}>⬇ Export my data</button>
          <button className="btn btn-ghost" onClick={() => logout()}>Sign out</button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete account</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          To permanently delete your account and content, contact an Owner. Owner accounts cannot delete themselves from this
          page — the Ultra Admin panel is the only place accounts can be deleted.
        </p>
      </div>

      {confirmDelete && (
        <Modal title="Delete account" onClose={() => setConfirmDelete(false)}>
          <p>Owner-only action. Ask an Owner to delete your account from the Admin panel. This is a safety measure to prevent
            accidental destruction of data.</p>
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Close</button>
        </Modal>
      )}

      <p className="muted" style={{ marginTop: 16, fontSize: 11.5 }}>
        Live world zones: {ZONES.map(z => z.name).join(' · ')}
      </p>
    </div>
  )
}
