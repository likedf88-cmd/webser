import { Router } from 'express'
import crypto from 'node:crypto'
import { db, now, newId, notify, addCoins, dayKey } from '../db.js'
import { requireAuth } from '../auth.js'
import { rateLimit } from '../rate.js'

const router = Router()
export const DAILY_BASE = 100

const isoDay = (offsetDays = 0) => dayKey(new Date(Date.now() - offsetDays * 86400_000))

function streakOf(userId) {
  const days = new Set(db.prepare('SELECT day FROM daily_claims WHERE user_id = ? ORDER BY day DESC LIMIT 90').all(userId).map(r => r.day))
  let streak = 0
  for (let i = 1; i <= 90; i++) {
    if (days.has(isoDay(i))) streak++
    else break
  }
  return streak
}

function ownedItemIds(userId) {
  return db.prepare('SELECT item_id FROM purchases WHERE user_id = ?').all(userId).map(r => r.item_id)
}

router.get('/wallet', requireAuth, (req, res) => {
  const claimedToday = !!db.prepare('SELECT 1 FROM daily_claims WHERE user_id = ? AND day = ?').get(req.user.id, isoDay(0))
  const streak = streakOf(req.user.id)
  const tomorrow = new Date()
  tomorrow.setUTCHours(24, 0, 0, 0)
  const owned = ownedItemIds(req.user.id)
  res.json({
    coins: req.user.coins,
    daily: {
      amount: DAILY_BASE + Math.min(50, Math.max(0, streak) * 10),
      claimedToday,
      streak,
      nextClaimAt: tomorrow.getTime()
    },
    transactions: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id)
      .map(t => ({ id: t.id, amount: t.amount, kind: t.kind, note: t.note, createdAt: t.created_at })),
    purchases: db.prepare(
      `SELECT p.*, s.name, s.thumbnail, s.category FROM purchases p JOIN shop_items s ON s.id = p.item_id
       WHERE p.user_id = ? ORDER BY p.created_at DESC`
    ).all(req.user.id).map(p => ({ itemId: p.item_id, name: p.name, thumbnail: p.thumbnail, category: p.category, price: p.price, at: p.created_at })),
    equipped: req.user.avatar_item_id,
    owned
  })
})

router.post('/wallet/daily', requireAuth, rateLimit(20, 60_000, 'daily'), (req, res) => {
  const day = isoDay(0)
  try {
    const streak = streakOf(req.user.id)
    const amount = DAILY_BASE + Math.min(50, streak * 10)
    db.tx(() => {
      db.prepare('INSERT INTO daily_claims (user_id,day,amount,created_at) VALUES (?,?,?,?)').run(req.user.id, day, amount, now())
      addCoins(req.user.id, amount, 'daily', `Daily reward (${streak + 1} day streak)`)
    })
    notify(req.user.id, req.user.id, 'daily', `You collected ${amount} ASC Coins for day ${streak + 1}.`, '/wallet')
    const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
    res.json({ ok: true, amount, streak: streak + 1, coins: user.coins })
  } catch (err) {
    const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
    res.status(409).json({ error: 'Already claimed today — come back tomorrow.', coins: user?.coins })
  }
})

router.post('/wallet/gift', requireAuth, rateLimit(20, 60_000, 'gift'), (req, res) => {
  const amount = Math.floor(Number(req.body?.amount))
  const to = String(req.body?.toUsername || '').trim().replace(/^@/, '').toLowerCase()
  if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ error: 'Enter a gift amount' })
  if (amount > 5000) return res.status(400).json({ error: 'Maximum gift is 5000 coins' })
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(to)
  if (!target) return res.status(404).json({ error: 'No user with that username' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot gift yourself' })
  if (req.user.coins < amount) return res.status(400).json({ error: 'Not enough coins' })
  db.tx(() => {
    addCoins(req.user.id, -amount, 'gift-out', `Gift to @${target.username}`)
    addCoins(target.id, amount, 'gift-in', `Gift from @${req.user.username}`)
  })
  notify(target.id, req.user.id, 'gift', `${req.user.display_name} gifted you ${amount} ASC Coins`, '/wallet')
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  res.json({ ok: true, coins: user.coins })
})

router.post('/wallet/redeem', requireAuth, rateLimit(8, 60_000, 'redeem'), (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase()
  if (!code) return res.status(400).json({ error: 'Enter a gift card code' })
  const hash = crypto.createHash('sha256').update(code).digest('hex')
  const card = db.prepare('SELECT * FROM gift_cards WHERE code_hash = ?').get(hash)
  if (!card) return res.status(404).json({ error: 'Invalid code' })
  if (card.disabled) return res.status(400).json({ error: 'This card has been disabled' })
  if (card.redeemed_by) return res.status(400).json({ error: 'This card was already redeemed' })
  db.tx(() => {
    const changed = db.prepare('UPDATE gift_cards SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL').run(req.user.id, now(), card.id)
    if (!changed.changes) throw new Error('Already redeemed')
    addCoins(req.user.id, card.amount, 'giftcard', 'Gift card ' + card.id.slice(0, 6))
  })
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  notify(req.user.id, req.user.id, 'giftcard', `Gift card redeemed: +${card.amount} ASC Coins`, '/wallet')
  res.json({ ok: true, amount: card.amount, coins: user.coins })
})

router.get('/shop', (req, res) => {
  const q = String(req.query.q || '').trim()
  const category = String(req.query.category || '')
  const owned = req.user ? ownedItemIds(req.user.id) : []
  let rows = db.prepare('SELECT * FROM shop_items WHERE active = 1 ORDER BY created_at DESC').all()
  if (category && category !== 'all') rows = rows.filter(r => r.category === category)
  if (q) rows = rows.filter(r => (r.name + ' ' + r.description).toLowerCase().includes(q.toLowerCase()))
  res.json({
    items: rows.map(r => ({
      id: r.id, name: r.name, description: r.description, category: r.category, price: r.price,
      thumbnail: r.thumbnail, modelUrl: r.model_url, creator: r.creator, createdAt: r.created_at,
      owned: owned.includes(r.id), equipped: req.user?.avatar_item_id === r.id
    })),
    categories: [...new Set(db.prepare('SELECT category FROM shop_items WHERE active = 1').all().map(r => r.category))]
  })
})

router.post('/shop/:id/buy', requireAuth, rateLimit(30, 60_000, 'buy'), (req, res) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(req.params.id)
  if (!item) return res.status(404).json({ error: 'Item not available' })
  if (db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id)) {
    return res.status(400).json({ error: 'You already own this item' })
  }
  const fresh = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  if (fresh.coins < item.price) return res.status(400).json({ error: `You need ${item.price - fresh.coins} more coins` })
  db.tx(() => {
    const debit = db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(item.price, req.user.id, item.price)
    if (!debit.changes) throw new Error('Insufficient coins')
    db.prepare('INSERT INTO purchases (id,user_id,item_id,price,created_at) VALUES (?,?,?,?,?)').run(newId(), req.user.id, item.id, item.price, now())
    db.prepare('INSERT INTO transactions (id,user_id,amount,kind,note,created_at) VALUES (?,?,?,?,?,?)').run(
      newId(), req.user.id, -item.price, 'purchase', `Bought ${item.name}`, now()
    )
  })
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  res.json({ ok: true, coins: user.coins, item })
})

router.post('/shop/:id/gift', requireAuth, rateLimit(20, 60_000, 'itemgift'), (req, res) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(req.params.id)
  if (!item) return res.status(404).json({ error: 'Item not available' })
  const to = String(req.body?.toUsername || '').trim().replace(/^@/, '').toLowerCase()
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(to)
  if (!target) return res.status(404).json({ error: 'No user with that username' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'Gift it to someone else, or just buy it.' })
  if (db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ?').get(target.id, item.id)) {
    return res.status(400).json({ error: 'They already own this item' })
  }
  const fresh = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  if (fresh.coins < item.price) return res.status(400).json({ error: 'Not enough coins for this gift' })
  db.tx(() => {
    const debit = db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').run(item.price, req.user.id, item.price)
    if (!debit.changes) throw new Error('Insufficient coins')
    db.prepare('INSERT INTO purchases (id,user_id,item_id,price,created_at) VALUES (?,?,?,?,?)').run(newId(), target.id, item.id, item.price, now())
    db.prepare('INSERT INTO transactions (id,user_id,amount,kind,note,created_at) VALUES (?,?,?,?,?,?)').run(
      newId(), req.user.id, -item.price, 'gift-item', `Gifted ${item.name} to @${target.username}`, now()
    )
    db.prepare('INSERT INTO transactions (id,user_id,amount,kind,note,created_at) VALUES (?,?,?,?,?,?)').run(
      newId(), target.id, 0, 'gift-received', `Received ${item.name} from @${req.user.username}`, now()
    )
  })
  notify(target.id, req.user.id, 'gift', `${req.user.display_name} gifted you ${item.name}`, '/shop')
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  res.json({ ok: true, coins: user.coins })
})

router.post('/shop/:id/equip', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  if (!db.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id)) {
    return res.status(403).json({ error: 'Buy this item first' })
  }
  const unequip = item.category !== 'avatars' && req.user.avatar_item_id === item.id
  db.prepare('UPDATE users SET avatar_item_id = ? WHERE id = ?').run(unequip ? null : item.id, req.user.id)
  res.json({ ok: true, equipped: unequip ? null : item.id })
})

router.post('/games/flappy/score', requireAuth, rateLimit(30, 60_000, 'flappy'), (req, res) => {
  const score = Math.floor(Number(req.body?.score))
  if (!Number.isFinite(score) || score < 0 || score > 500) return res.status(400).json({ error: 'Invalid score' })
  const last = db.prepare("SELECT created_at FROM transactions WHERE user_id = ? AND kind = 'game' ORDER BY created_at DESC LIMIT 1").get(req.user.id)
  if (last && now() - last.created_at < 15_000) return res.status(429).json({ error: 'Too fast — wait a few seconds between rounds' })
  const coins = Math.min(75, Math.floor(score / 3))
  if (coins > 0) addCoins(req.user.id, coins, 'game', `Flappy ASC score ${score}`)
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id)
  res.json({ coins, balance: user.coins })
})

export default router
