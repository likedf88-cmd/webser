import { useCallback, useEffect, useState } from 'react'
import { api, compact } from '../api'
import { useAuth, useToast } from '../store'
import { Empty, Modal, Spinner } from '../components/ui'
import { RANK } from '../api'
import { Link } from 'react-router-dom'

export default function ShopPage() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [gift, setGift] = useState(null)
  const [giftTo, setGiftTo] = useState('')
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    try {
      const d = await api(`/shop?category=${cat}&q=${encodeURIComponent(q)}`)
      setData(d)
      if (detail) setDetail(d.items.find(i => i.id === detail.id) || null)
    } catch (e) { toast(e.message, 'error') }
  }, [cat, q])

  useEffect(() => { load() }, [load])

  const buy = async (item) => {
    if (!confirm(`Buy ${item.name} for ${item.price} ASC Coins?`)) return
    setBusy(item.id)
    try {
      const r = await api('/shop/' + item.id + '/buy', { method: 'POST' })
      toast(`Purchased ${item.name} · balance ${r.coins}`, 'success')
      refresh()
      load()
    } catch (e) { toast(e.message, 'error') }
    setBusy('')
  }

  const equip = async (item) => {
    try {
      const r = await api('/shop/' + item.id + '/equip', { method: 'POST' })
      toast(r.equipped ? 'Equipped — you will appear with it in the world' : 'Unequipped', 'success')
      refresh()
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const sendGift = async () => {
    setBusy(gift.id)
    try {
      await api('/shop/' + gift.id + '/gift', { method: 'POST', body: { toUsername: giftTo } })
      toast(`Gifted ${gift.name} to @${giftTo.replace(/^@/, '')}`, 'success')
      refresh()
      setGift(null)
      setGiftTo('')
      load()
    } catch (e) { toast(e.message, 'error') }
    setBusy('')
  }

  if (!data) return <div className="page"><Spinner label="Loading marketplace…" /></div>

  return (
    <div className="page">
      <div className="section-title">
        <div>
          <h2>Avatar Marketplace</h2>
          <p className="muted">Spend ASC Coins on avatars, accessories and emotes. Buy one and you appear as it in the world.</p>
        </div>
        <Link to="/wallet" className="badge badge-warn">🪙 {compact(user.coins)} coins</Link>
      </div>

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Search items…" value={q} onChange={e => setQ(e.target.value)} />
        {['all', ...data.categories].map(c => (
          <button key={c} className={'chip ' + (cat === c ? 'active' : '')} onClick={() => setCat(c)}>{c}</button>
        ))}
        {(RANK[user.role] || 0) >= RANK.admin && (
          <Link to="/admin?tab=market" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>🛠 Upload avatar (Meshy)</Link>
        )}
      </div>

      {data.items.length === 0 && <Empty emoji="🛍️" title="No items found" hint="Try a different category or search." />}

      <div className="grid grid-3">
        {data.items.map(item => (
          <div className="shop-card" key={item.id}>
            <button style={{ border: 'none', padding: 0, background: 'none', cursor: 'pointer' }} onClick={() => setDetail(item)}>
              <img className="shop-thumb" src={item.thumbnail || ''} alt={item.name} />
            </button>
            <div className="shop-body">
              <div className="row-between">
                <strong style={{ fontSize: 14.5 }}>{item.name}</strong>
                <span className="badge">{item.category}</span>
              </div>
              <p className="muted clamp2" style={{ fontSize: 12.5 }}>{item.description}</p>
              <div className="row-between">
                <span className="price">🪙 {item.price}</span>
                {item.owned ? <span className="badge badge-good">Owned</span> : <span className="muted" style={{ fontSize: 11 }}>by {item.creator}</span>}
              </div>
              <div className="row wrap">
                {item.owned
                  ? <button className={'btn btn-sm ' + (item.equipped ? 'btn-good' : 'btn-primary')} onClick={() => equip(item)}>
                      {item.equipped ? '✓ Equipped' : 'Equip'}
                    </button>
                  : <button className="btn btn-primary btn-sm" disabled={busy === item.id} onClick={() => buy(item)}>Buy</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setGift(item)}>🎁 Gift</button>
                <button className="btn btn-ghost btn-sm" onClick={() => api('/reports', { method: 'POST', body: { targetType: 'item', targetId: item.id, category: 'other' } }).then(() => toast('Reported', 'success'))}>⚑</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div className="split">
            <img src={detail.thumbnail} alt={detail.name} style={{ width: '100%', borderRadius: 16, border: '1px solid var(--stroke)' }} />
            <div className="stack">
              <div className="row-between"><span className="badge badge-accent">{detail.category}</span><span className="price">🪙 {detail.price}</span></div>
              <p className="muted">{detail.description}</p>
              <p className="muted" style={{ fontSize: 12 }}>Creator: {detail.creator}</p>
              {detail.modelUrl
                ? <a className="btn btn-ghost btn-sm" href={detail.modelUrl} target="_blank" rel="noreferrer">Open 3D model (.glb)</a>
                : <p className="muted" style={{ fontSize: 12 }}>No 3D model attached to this item yet.</p>}
              <div className="row">
                {detail.owned
                  ? <button className="btn btn-primary" onClick={() => { equip(detail); setDetail(null) }}>{detail.equipped ? 'Unequip' : 'Equip'}</button>
                  : <button className="btn btn-primary" onClick={() => { buy(detail); setDetail(null) }}>Buy for 🪙 {detail.price}</button>}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {gift && (
        <Modal title={'Gift ' + gift.name} onClose={() => setGift(null)}>
          <p className="muted">This spends your coins and gives the item permanently to someone else.</p>
          <div className="field">
            <label className="label">Recipient username</label>
            <input className="input" placeholder="@username" value={giftTo} onChange={e => setGiftTo(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setGift(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy === gift.id || !giftTo.trim()} onClick={sendGift}>
              Send gift · 🪙 {gift.price}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
