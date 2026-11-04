import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, RANK, roleLabel, timeAgo } from '../api'
import { useAuth, useToast } from '../store'
import { Avatar, Empty, Modal, Spinner } from '../components/ui'

const TABS = ['overview', 'users', 'reports', 'market', 'giftcards', 'announcements', 'audit']

export default function AdminPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'overview'
  const rank = RANK[user.role] || 0

  if (rank < RANK.moderator) {
    return (
      <div className="page">
        <Empty
          emoji="🛡️" title="Staff only"
          hint="This area requires a moderator, administrator or owner role. Roles are enforced by the API, not just the UI."
          action={<Link className="btn btn-primary" to="/">Back home</Link>}
        />
      </div>
    )
  }

  return (
    <div className="page page-wide">
      <div className="section-title">
        <div>
          <h2>Admin control center</h2>
          <p className="muted">Signed in as {user.displayName} · {roleLabel[user.role]}</p>
        </div>
        <span className={'badge ' + (rank >= RANK.owner ? 'badge-accent' : 'badge')}>
          {rank >= RANK.owner ? '👑 Ultra Admin' : rank >= RANK.admin ? '🛡️ Administrator' : '🛡️ Moderator'}
        </span>
      </div>

      <div className="tabs">
        {TABS.filter(t => {
          if (t === 'giftcards') return rank >= RANK.owner
          if (t === 'audit') return rank >= RANK.owner
          return true
        }).map(t => (
          <button key={t} className={'tab ' + (tab === t ? 'active' : '')} onClick={() => setParams({ tab: t })}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users rank={rank} />}
      {tab === 'reports' && <Reports />}
      {tab === 'market' && <Market rank={rank} />}
      {tab === 'giftcards' && <GiftCards />}
      {tab === 'announcements' && <Announcements />}
      {tab === 'audit' && <AuditLog />}
    </div>
  )
}

function Overview() {
  const [data, setData] = useState(null)
  const toast = useToast()
  useEffect(() => { api('/admin/stats').then(setData).catch(e => toast(e.message, 'error')) }, [])
  if (!data) return <Spinner label="Calculating platform stats…" />
  const t = data.totals
  const maxSignup = Math.max(1, ...data.signups.map(s => s.value))
  const maxPosts = Math.max(1, ...data.postsByDay.map(s => s.value))

  return (
    <div className="stack">
      <div className="admin-grid">
        {[
          ['Total users', t.users], ['Online now', t.online], ['New today', t.newToday],
          ['Banned', t.banned], ['Posts', t.posts], ['Reels / videos', t.reels],
          ['Active stories', t.stories], ['Messages', t.messages], ['Pending reports', t.pendingReports],
          ['Coin circulation', t.coins], ['Purchases', t.purchases], ['Daily claims today', t.dailyClaimsToday],
          ['Shop items', t.items], ['Gift cards', t.giftcards]
        ].map(([label, value]) => (
          <div className="metric" key={label}><b>{value}</b><span>{label}</span></div>
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="tiny" style={{ marginBottom: 10 }}>Signups · last 14 days</div>
          <div className="bars">
            {data.signups.map(s => <div key={s.day} className="bar" style={{ height: (s.value / maxSignup) * 100 + '%' }} title={`${s.day}: ${s.value}`} />)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>{data.signups.map(s => <div className="bar-label" key={s.day} style={{ flex: 1 }}>{s.label}</div>)}</div>
        </div>
        <div className="card">
          <div className="tiny" style={{ marginBottom: 10 }}>Posts · last 14 days</div>
          <div className="bars">
            {data.postsByDay.map(s => <div key={s.day} className="bar" style={{ height: (s.value / maxPosts) * 100 + '%' }} title={`${s.day}: ${s.value}`} />)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>{data.postsByDay.map(s => <div className="bar-label" key={s.day} style={{ flex: 1 }}>{s.label}</div>)}</div>
        </div>
      </div>

      <div className="card">
        <div className="tiny" style={{ marginBottom: 10 }}>Top creators</div>
        {data.topCreators.length === 0 && <p className="muted">No users yet.</p>}
        <div className="stack-list">
          {data.topCreators.map(c => (
            <div className="list-item" key={c.id}>
              <Avatar user={c} size={36} />
              <div className="grow"><strong>@{c.username}</strong> <span className="muted">· {c.followers} followers</span></div>
              <Link className="btn btn-ghost btn-sm" to={'/u/' + c.username}>Profile</Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Users({ rank }) {
  const toast = useToast()
  const { user: me } = useAuth()
  const [q, setQ] = useState('')
  const [users, setUsers] = useState(null)
  const [ban, setBan] = useState(null)
  const [reason, setReason] = useState('Violating community rules')
  const [ownerPass, setOwnerPass] = useState('')
  const [promote, setPromote] = useState(null)
  const [coinsFor, setCoinsFor] = useState(null)
  const [coins, setCoins] = useState(100)
  const [note, setNote] = useState('Admin adjustment')

  const load = useCallback(async () => {
    try { setUsers((await api('/admin/users?q=' + encodeURIComponent(q))).users) }
    catch (e) { toast(e.message, 'error') }
  }, [q])

  useEffect(() => { load() }, [load])

  const setRole = async (target, role, pass) => {
    try {
      await api('/admin/users/' + target.id + '/role', { method: 'POST', body: { role, pass } })
      toast(`@${target.username} is now ${role}`, 'success')
      setPromote(null); setOwnerPass('')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const doBan = async () => {
    try {
      await api('/admin/users/' + ban.id + '/ban', { method: 'POST', body: { reason } })
      toast(`@${ban.username} banned`, 'success')
      setBan(null); load()
    } catch (e) { toast(e.message, 'error') }
  }

  const unban = async (u) => {
    try { await api('/admin/users/' + u.id + '/unban', { method: 'POST' }); toast('Unbanned', 'success'); load() }
    catch (e) { toast(e.message, 'error') }
  }

  const verify = async (u) => {
    try { await api('/admin/users/' + u.id + '/verify', { method: 'POST' }); load() }
    catch (e) { toast(e.message, 'error') }
  }

  const remove = async (u) => {
    if (!confirm(`Permanently delete @${u.username}? This cannot be undone.`)) return
    try { await api('/admin/users/' + u.id, { method: 'DELETE' }); toast('Account deleted', 'success'); load() }
    catch (e) { toast(e.message, 'error') }
  }

  const adjust = async () => {
    try {
      await api('/admin/coins', { method: 'POST', body: { userId: coinsFor.id, amount: Number(coins), note } })
      toast('Wallet adjusted', 'success'); setCoinsFor(null); load()
    } catch (e) { toast(e.message, 'error') }
  }

  if (!users) return <Spinner label="Loading users…" />

  return (
    <div className="stack">
      <div className="row">
        <input className="input" placeholder="Search username, display name or email…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>User</th><th>Role</th><th>Coins</th><th>Joined</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map(u => {
              const targetRank = RANK[u.role] || 0
              const canManage = rank > targetRank
              return (
                <tr key={u.id}>
                  <td>
                    <div className="row">
                      <Avatar user={{ displayName: u.displayName, avatarUrl: u.avatarUrl }} size={30} />
                      <div>
                        <div style={{ fontWeight: 700 }}>@{u.username} {u.verified && '✅'}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{u.email || 'hidden'}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="badge badge-accent">{u.role}</span></td>
                  <td>🪙 {u.coins}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{timeAgo(u.createdAt)} ago</td>
                  <td>{u.banned ? <span className="badge badge-bad">banned</span> : <span className="badge badge-good">active</span>}</td>
                  <td>
                    <div className="row wrap" style={{ gap: 4 }}>
                      {rank >= RANK.admin && canManage && (
                        <>
                          <select
                            className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                            value={u.role}
                            onChange={e => {
                              const role = e.target.value
                              if (role === 'owner' || role === 'admin') setPromote({ target: u, role })
                              else setRole(u, role)
                            }}
                          >
                            <option value="user">user</option>
                            <option value="moderator">moderator</option>
                            <option value="admin">admin</option>
                            {rank >= RANK.owner && <option value="owner">owner</option>}
                          </select>
                          {u.banned
                            ? <button className="btn btn-good btn-sm" onClick={() => unban(u)}>Unban</button>
                            : <button className="btn btn-danger btn-sm" onClick={() => setBan(u)}>Ban</button>}
                        </>
                      )}
                      {rank >= RANK.admin && <button className="btn btn-ghost btn-sm" onClick={() => verify(u)}>{u.verified ? 'Unverify' : 'Verify'}</button>}
                      {rank >= RANK.owner && (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => setCoinsFor(u)}>🪙</button>
                          {u.id !== me.id && <button className="btn btn-danger btn-sm" onClick={() => remove(u)}>Delete</button>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Hierarchy is enforced on the server: you can only act on users ranked below you. Ban requires Administrator+.
        Granting admin/owner requires the owner password. The last owner cannot be banned or demoted.
      </p>

      {ban && (
        <Modal title={`Ban @${ban.username}`} onClose={() => setBan(null)}>
          <div className="field">
            <label className="label">Reason (shown to the banned user)</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setBan(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doBan}>Ban account</button>
          </div>
        </Modal>
      )}

      {promote && (
        <Modal title={`Grant ${promote.role} to @${promote.target.username}`} onClose={() => setPromote(null)}>
          <p className="muted">Enter the owner password to grant elevated access.</p>
          <input className="input" type="password" placeholder="Owner password" value={ownerPass} onChange={e => setOwnerPass(e.target.value)} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setPromote(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => setRole(promote.target, promote.role, ownerPass)}>Confirm</button>
          </div>
        </Modal>
      )}

      {coinsFor && (
        <Modal title={`Adjust coins for @${coinsFor.username}`} onClose={() => setCoinsFor(null)}>
          <div className="field">
            <label className="label">Amount (negative to remove)</label>
            <input className="input" type="number" value={coins} onChange={e => setCoins(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Ledger note</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setCoinsFor(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={adjust}>Apply</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Reports() {
  const toast = useToast()
  const [status, setStatus] = useState('all')
  const [reports, setReports] = useState(null)
  const [notes, setNotes] = useState({})

  const load = useCallback(async () => {
    try { setReports((await api('/admin/reports?status=' + status)).reports) }
    catch (e) { toast(e.message, 'error') }
  }, [status])

  useEffect(() => { load() }, [load])

  const resolve = async (r, next) => {
    try {
      await api('/admin/reports/' + r.id, { method: 'POST', body: { status: next, notes: notes[r.id] ?? r.notes ?? '' } })
      toast('Report updated', 'success'); load()
    } catch (e) { toast(e.message, 'error') }
  }

  const removeContent = async (r) => {
    if (r.type !== 'post') return toast('Only post content can be removed here', 'error')
    try {
      await api('/admin/content/' + r.targetId + '/remove', { method: 'POST' })
      toast('Content removed', 'success')
      await api('/admin/reports/' + r.id, { method: 'POST', body: { status: 'action', notes: 'Content removed' } })
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  if (!reports) return <Spinner label="Loading reports…" />

  return (
    <div className="stack">
      <div className="row wrap">
        {['all', 'pending', 'review', 'action', 'dismissed', 'escalated'].map(s => (
          <button key={s} className={'chip ' + (status === s ? 'active' : '')} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {reports.length === 0 && <Empty emoji="🧾" title="No reports in this filter" />}
      {reports.map(r => (
        <div className="card" key={r.id}>
          <div className="row-between">
            <div className="row">
              <span className="badge badge-bad">{r.category}</span>
              <span className="badge">{r.type}</span>
              <span className="badge badge-accent">{r.status}</span>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{timeAgo(r.createdAt)} ago</span>
          </div>
          <p style={{ marginTop: 8 }}>{r.description || 'No description provided.'}</p>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Reporter: @{r.reporter?.username || 'unknown'} · Target: {r.target?.label || r.targetId}
          </p>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Internal notes…" defaultValue={r.notes || ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} />
            <button className="btn btn-good btn-sm" onClick={() => resolve(r, 'action')}>Action taken</button>
            <button className="btn btn-ghost btn-sm" onClick={() => resolve(r, 'dismissed')}>Dismiss</button>
            <button className="btn btn-ghost btn-sm" onClick={() => resolve(r, 'review')}>Under review</button>
            <button className="btn btn-danger btn-sm" onClick={() => resolve(r, 'escalated')}>Escalate</button>
            {r.type === 'post' && <button className="btn btn-danger btn-sm" onClick={() => removeContent(r)}>Remove content</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Market({ rank }) {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', category: 'avatars', price: 500 })
  const [thumb, setThumb] = useState(null)
  const [model, setModel] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api('/admin/items').then(d => setItems(d.items)).catch(e => toast(e.message, 'error'))
  }, [])
  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name)
      fd.append('description', form.description)
      fd.append('category', form.category)
      fd.append('price', form.price)
      if (thumb) fd.append('thumbnail', thumb)
      if (model) fd.append('model', model)
      await api('/admin/items', { method: 'POST', form: fd })
      toast('Item published to the marketplace', 'success')
      setForm({ name: '', description: '', category: 'avatars', price: 500 })
      setThumb(null); setModel(null)
      load()
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  const toggle = async (id) => {
    try { await api('/admin/items/' + id + '/toggle', { method: 'POST' }); load() }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={submit}>
        <div className="tiny">Publish an avatar / marketplace item</div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Download your model from Meshy as <b>.glb</b>, then upload it with a preview image here. The preview is what people
          see in the shop and on the world map; the .glb is stored so it can be opened or used by a 3D viewer later.
          Automatic rigging is <b>not</b> wired up — that needs a rigging service (see the notes in the admin README).
        </p>
        <div className="grid grid-2">
          <div className="field">
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required maxLength={60} />
          </div>
          <div className="field">
            <label className="label">Price (ASC Coins)</label>
            <input className="input" type="number" min={0} value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </div>
          <div className="field">
            <label className="label">Category</label>
            <select className="select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {['avatars', 'hair', 'clothing', 'shoes', 'accessories', 'animations', 'emotes', 'limited'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Preview image (PNG/JPG/WebP)</label>
            <input className="input" type="file" accept="image/*" onChange={e => setThumb(e.target.files?.[0] || null)} />
          </div>
          <div className="field">
            <label className="label">3D model (.glb / .gltf)</label>
            <input className="input" type="file" accept=".glb,.gltf" onChange={e => setModel(e.target.files?.[0] || null)} />
          </div>
        </div>
        <div className="field">
          <label className="label">Description</label>
          <textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} maxLength={500} />
        </div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Publish item'}</button>
      </form>

      {!items ? <Spinner /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Model</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td>
                    <div className="row">
                      {i.thumbnail && <img src={i.thumbnail} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />}
                      <strong>{i.name}</strong>
                    </div>
                  </td>
                  <td>{i.category}</td>
                  <td>🪙 {i.price}</td>
                  <td>{i.model_url ? <a href={i.model_url} target="_blank" rel="noreferrer">GLB</a> : <span className="muted">none</span>}</td>
                  <td>{i.active ? <span className="badge badge-good">live</span> : <span className="badge badge-bad">hidden</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => toggle(i.id)}>{i.active ? 'Hide' : 'Show'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function GiftCards() {
  const toast = useToast()
  const [cards, setCards] = useState(null)
  const [amount, setAmount] = useState(500)
  const [qty, setQty] = useState(1)
  const [issued, setIssued] = useState([])

  const load = useCallback(() => { api('/admin/giftcards').then(d => setCards(d.cards)).catch(e => toast(e.message, 'error')) }, [])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    try {
      const r = await api('/admin/giftcards', { method: 'POST', body: { amount: Number(amount), count: Number(qty) } })
      setIssued(r.codes)
      toast(`${r.codes.length} gift card(s) issued`, 'success')
      load()
    } catch (err) { toast(err.message, 'error') }
  }

  const disable = async (id) => {
    try { await api('/admin/giftcards/' + id + '/disable', { method: 'POST' }); load() }
    catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={create}>
        <div className="tiny">Issue gift cards (owner only)</div>
        <div className="row wrap">
          <div className="field" style={{ maxWidth: 180 }}>
            <label className="label">Coin value</label>
            <input className="input" type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label className="label">How many</label>
            <input className="input" type="number" min={1} max={25} value={qty} onChange={e => setQty(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary">Generate codes</button>
        {issued.length > 0 && (
          <div>

            <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Copy these now — codes are stored hashed and cannot be shown again.</p>
            <div className="code-list">{issued.map(c => <div key={c}>{c}</div>)}</div>
          </div>
        )}
      </form>

      {!cards ? <Spinner /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Card</th><th>Value</th><th>Created</th><th>Redeemed by</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {cards.map(c => (
                <tr key={c.id}>
                  <td className="muted">#{c.id.slice(0, 8)}</td>
                  <td>🪙 {c.amount}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{timeAgo(c.createdAt)} ago</td>
                  <td>{c.redeemedBy ? '@' + c.redeemedBy : '—'}</td>
                  <td>{c.disabled ? <span className="badge badge-bad">disabled</span> : c.redeemedBy ? <span className="badge">used</span> : <span className="badge badge-good">active</span>}</td>
                  <td>{!c.redeemedBy && <button className="btn btn-ghost btn-sm" onClick={() => disable(c.id)}>{c.disabled ? 'Enable' : 'Disable'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Announcements() {
  const toast = useToast()
  const [text, setText] = useState('')
  const [list, setList] = useState([])

  const load = () => api('/announcements').then(d => setList(d.announcements)).catch(() => {})
  useEffect(() => { load() }, [])

  const send = async (e) => {
    e.preventDefault()
    try {
      await api('/admin/announcements', { method: 'POST', body: { text } })
      setText('')
      toast('Announcement published and pushed to every user', 'success')
      load()
    } catch (err) { toast(err.message, 'error') }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={send}>
        <div className="tiny">Platform announcement</div>
        <textarea className="textarea" placeholder="What should everyone know?" value={text} onChange={e => setText(e.target.value)} maxLength={500} />
        <button className="btn btn-primary" disabled={!text.trim()}>Publish announcement</button>
      </form>
      <div className="card stack">
        <div className="tiny">Recent announcements</div>
        {list.length === 0 && <p className="muted">None yet.</p>}
        {list.map(a => <div className="tx" key={a.id}><span>{a.text}</span><span className="muted" style={{ fontSize: 12 }}>{timeAgo(a.createdAt)}</span></div>)}
      </div>
    </div>
  )
}

function AuditLog() {
  const toast = useToast()
  const [entries, setEntries] = useState(null)
  useEffect(() => {
    api('/admin/audit').then(d => setEntries(d.entries)).catch(e => toast(e.message, 'error'))
  }, [])
  if (!entries) return <Spinner label="Loading audit log…" />
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Append-only administrative audit trail. Owner-only.</p>
      <table className="table">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td className="muted" style={{ fontSize: 12 }}>{timeAgo(e.createdAt)} ago</td>
              <td>@{e.actor}</td>
              <td><span className="badge">{e.action}</span></td>
              <td className="muted" style={{ fontSize: 12 }}>{e.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <Empty emoji="📜" title="No audit entries yet" />}
    </div>
  )
}
