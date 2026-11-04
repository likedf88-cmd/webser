import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, compact, timeAgo, timeLeft } from '../api'
import { useAuth, useToast } from '../store'
import { Empty, Spinner } from '../components/ui'

export default function WalletPage() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [giftTo, setGiftTo] = useState('')
  const [giftAmount, setGiftAmount] = useState(100)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setData(await api('/wallet')) } catch (e) { toast(e.message, 'error') }
  }, [toast])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const claim = async () => {
    setBusy('daily')
    try {
      const r = await api('/wallet/daily', { method: 'POST' })
      toast(`+${r.amount} ASC Coins · day ${r.streak} streak`, 'success')
      await load()
      refresh()
    } catch (e) { toast(e.message, 'error') }
    setBusy('')
  }

  const gift = async (e) => {
    e.preventDefault()
    setBusy('gift')
    try {
      await api('/wallet/gift', { method: 'POST', body: { toUsername: giftTo, amount: Number(giftAmount) } })
      toast(`Sent ${giftAmount} coins to @${giftTo.replace(/^@/, '')}`, 'success')
      setGiftTo('')
      await load()
      refresh()
    } catch (e) { toast(e.message, 'error') }
    setBusy('')
  }

  const redeem = async (e) => {
    e.preventDefault()
    setBusy('redeem')
    try {
      const r = await api('/wallet/redeem', { method: 'POST', body: { code } })
      toast(`Redeemed +${r.amount} ASC Coins`, 'success')
      setCode('')
      await load()
      refresh()
    } catch (e) { toast(e.message, 'error') }
    setBusy('')
  }

  if (!data) return <div className="page"><Spinner label="Opening wallet…" /></div>

  const canClaim = !data.daily.claimedToday

  return (
    <div className="page">
      <div className="section-title">
        <div>
          <h2>Wallet</h2>
          <p className="muted">ASC Coins are the currency of Avatarverse. Every change is recorded in a server-side ledger.</p>
        </div>
        <Link to="/shop" className="btn btn-primary">🛍️ Marketplace</Link>
      </div>

      <div className="wallet-hero" style={{ marginBottom: 18 }}>
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <span className="tiny">ASC balance</span>
          <div className="balance">🪙 {compact(data.coins)}</div>
          <div className="row wrap">
            <span className="badge">{data.transactions.length} ledger entries</span>
            <span className="badge badge-accent">{data.purchases.length} items owned</span>
          </div>
          <div className="divider" />
          <div className="row wrap" style={{ gap: 8 }}>
            <Link className="btn btn-ghost btn-sm" to="/games">🎮 Earn in games</Link>
            <Link className="btn btn-ghost btn-sm" to="/shop">🛍️ Spend coins</Link>
          </div>
        </div>

        <div className="claim-box">
          <div className="tiny">Daily reward</div>
          <div style={{ fontSize: 40, fontWeight: 900 }}>🪙 {data.daily.amount}</div>
          <p className="muted">{canClaim ? `Streak: day ${data.daily.streak} · claim now` : 'Collected today. Come back soon!'}</p>
          <button className="btn btn-primary" disabled={!canClaim || busy === 'daily'} onClick={claim}>
            {canClaim ? (busy === 'daily' ? 'Collecting…' : 'Collect 100+ coins') : 'Next claim in ' + timeLeft(data.daily.nextClaimAt - now)}
          </button>
          <p className="muted" style={{ fontSize: 11 }}>One claim per UTC day, enforced by a database constraint.</p>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <form className="card stack" onSubmit={gift}>
          <div className="tiny">Gift coins to a friend</div>
          <div className="field">
            <label className="label">Recipient</label>
            <input className="input" placeholder="@username" value={giftTo} onChange={e => setGiftTo(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label">Amount</label>
            <input className="input" type="number" min={1} max={5000} value={giftAmount} onChange={e => setGiftAmount(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy === 'gift'}>Send coins</button>
        </form>

        <form className="card stack" onSubmit={redeem}>
          <div className="tiny">Redeem a gift card</div>
          <div className="field">
            <label className="label">Code</label>
            <input className="input" placeholder="ASC-XXXX-XXXX-XXXX" value={code} onChange={e => setCode(e.target.value)} required />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Codes are stored as SHA-256 hashes and can only be redeemed once.</p>
          <button className="btn btn-primary" disabled={busy === 'redeem'}>Redeem</button>
        </form>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="section-title"><h2>Transaction history</h2></div>
          {data.transactions.length === 0 && <Empty emoji="🧾" title="No transactions yet" />}
          {data.transactions.map(t => (
            <div className="tx" key={t.id}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.note}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{t.kind} · {timeAgo(t.createdAt)} ago</div>
              </div>
              <span className={t.amount >= 0 ? 'tx-pos' : 'tx-neg'}>{t.amount >= 0 ? '+' : ''}{t.amount}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <div className="section-title"><h2>Your items</h2></div>
          {data.purchases.length === 0 && <Empty emoji="🎒" title="Nothing owned yet" hint="Buy an avatar in the marketplace." />}
          <div className="grid" style={{ gap: 10 }}>
            {data.purchases.map(p => (
              <div className="list-item" key={p.itemId}>
                <img src={p.thumbnail} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />
                <div className="grow">
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{p.category} · 🪙 {p.price} · {timeAgo(p.at)} ago</div>
                </div>
                {data.equipped === p.itemId
                  ? <span className="badge badge-good">Equipped</span>
                  : <button className="btn btn-ghost btn-sm" onClick={() => api('/shop/' + p.itemId + '/equip', { method: 'POST' }).then(() => { load(); refresh(); toast('Equipped', 'success') }).catch(e => toast(e.message, 'error'))}>Equip</button>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
