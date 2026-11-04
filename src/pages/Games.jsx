import { useEffect, useRef, useState } from 'react'
import { api, compact, RANK } from '../api'
import { useAuth, useToast } from '../store'
import { Link } from 'react-router-dom'

const BW = 420
const BH = 560

export default function GamesPage() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const canvasRef = useRef(null)
  const state = useRef('idle')
  const bird = useRef({ y: BH / 2, vy: 0 })
  const pipes = useRef([])
  const frames = useRef(0)
  const scoreRef = useRef(0)
  const best = useRef(Number(localStorage.getItem('asc-flappy-best') || 0))
  const raf = useRef(null)
  const [ui, setUi] = useState('idle')
  const [score, setScore] = useState(0)
  const [earned, setEarned] = useState(0)

  const draw = () => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const g = ctx.createLinearGradient(0, 0, 0, BH)
    g.addColorStop(0, '#0b1030')
    g.addColorStop(1, '#26093a')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, BW, BH)

    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % BW
      const y = (i * 53) % BH
      ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + (i % 3) * 0.1) + ')'
      ctx.fillRect(x, y, 2, 2)
    }

    for (const p of pipes.current) {
      ctx.fillStyle = '#22c55e'
      ctx.fillRect(p.x, 0, 62, p.top)
      ctx.fillRect(p.x, p.top + 160, 62, BH - p.top - 160)
      ctx.fillStyle = '#16a34a'
      ctx.fillRect(p.x - 4, p.top - 22, 70, 22)
      ctx.fillRect(p.x - 4, p.top + 160, 70, 22)
    }

    const b = bird.current
    ctx.fillStyle = '#fbbf24'
    ctx.beginPath()
    ctx.arc(110, b.y, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#111827'
    ctx.beginPath()
    ctx.arc(116, b.y - 5, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f97316'
    ctx.beginPath()
    ctx.moveTo(126, b.y)
    ctx.lineTo(140, b.y + 4)
    ctx.lineTo(126, b.y + 8)
    ctx.fill()

    ctx.fillStyle = '#fff'
    ctx.font = 'bold 34px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(String(scoreRef.current), BW / 2, 60)
    ctx.font = '600 13px system-ui'
    ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.fillText('BEST ' + best.current, BW / 2, 84)
    ctx.textAlign = 'left'

    if (state.current === 'idle') {
      ctx.fillStyle = 'rgba(5,5,15,.65)'
      ctx.fillRect(0, 0, BW, BH)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.font = 'bold 26px system-ui'
      ctx.fillText('Flappy ASC', BW / 2, BH / 2 - 30)
      ctx.font = '14px system-ui'
      ctx.fillStyle = 'rgba(255,255,255,.75)'
      ctx.fillText('Tap or press Space to flap', BW / 2, BH / 2 + 4)
      ctx.fillText('Every 3 points = 1 ASC Coin', BW / 2, BH / 2 + 28)
      ctx.fillStyle = '#a78bfa'
      ctx.font = 'bold 15px system-ui'
      ctx.fillText('▶ Click to start', BW / 2, BH / 2 + 70)
      ctx.textAlign = 'left'
    }
    if (state.current === 'over') {
      ctx.fillStyle = 'rgba(5,5,15,.75)'
      ctx.fillRect(0, 0, BW, BH)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.font = 'bold 24px system-ui'
      ctx.fillText('Game over', BW / 2, BH / 2 - 40)
      ctx.font = 'bold 44px system-ui'
      ctx.fillText(String(scoreRef.current), BW / 2, BH / 2 + 10)
      ctx.font = '14px system-ui'
      ctx.fillStyle = 'rgba(255,255,255,.8)'
      ctx.fillText(earned ? `+${earned} ASC Coins earned` : 'No coins this round', BW / 2, BH / 2 + 44)
      ctx.fillStyle = '#a78bfa'
      ctx.font = 'bold 15px system-ui'
      ctx.fillText('Click to play again', BW / 2, BH / 2 + 86)
      ctx.textAlign = 'left'
    }
  }

  const endGame = async () => {
    state.current = 'over'
    setUi('over')
    if (scoreRef.current > best.current) {
      best.current = scoreRef.current
      localStorage.setItem('asc-flappy-best', String(scoreRef.current))
    }
    draw()
    try {
      const r = await api('/games/flappy/score', { method: 'POST', body: { score: scoreRef.current } })
      setEarned(r.coins)
      if (r.coins > 0) { toast(`+${r.coins} ASC Coins`, 'success'); refresh() }
    } catch (e) { toast(e.message, 'error') }
  }

  const loop = () => {
    if (state.current !== 'playing') return
    const b = bird.current
    b.vy += 0.42
    b.y += b.vy
    frames.current++

    if (frames.current % 88 === 0) {
      const top = 70 + Math.random() * (BH - 380)
      pipes.current.push({ x: BW + 40, top, passed: false })
    }
    for (const p of pipes.current) {
      p.x -= 2.7
      if (!p.passed && p.x + 62 < 110) {
        p.passed = true
        scoreRef.current++
        setScore(scoreRef.current)
      }
    }
    pipes.current = pipes.current.filter(p => p.x > -90)

    for (const p of pipes.current) {
      if (110 + 16 > p.x && 110 - 16 < p.x + 62 && (b.y - 16 < p.top || b.y + 16 > p.top + 160)) return endGame()
    }
    if (b.y > BH - 16 || b.y < 16) return endGame()

    draw()
    raf.current = requestAnimationFrame(loop)
  }

  const start = () => {
    bird.current = { y: BH / 2, vy: -6 }
    pipes.current = []
    frames.current = 0
    scoreRef.current = 0
    setScore(0)
    setEarned(0)
    state.current = 'playing'
    setUi('playing')
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(loop)
  }

  const flap = () => {
    if (state.current === 'idle' || state.current === 'over') return start()
    bird.current.vy = -7.2
  }

  useEffect(() => {
    draw()
    const onKey = (e) => {
      if (e.code === 'Space') { e.preventDefault(); flap() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); cancelAnimationFrame(raf.current) }
  }, [])

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="section-title">
        <div>
          <h2>Games</h2>
          <p className="muted">Earn ASC Coins by playing. Rewards are validated server-side and rate-limited.</p>
        </div>
        <Link to="/wallet" className="badge badge-warn">🪙 {compact(user.coins)}</Link>
      </div>

      <div className="split">
        <div className="game-wrap">
          <canvas
            className="game-canvas"
            width={BW}
            height={BH}
            ref={canvasRef}
            onClick={flap}
            onTouchStart={e => { e.preventDefault(); flap() }}
          />
          <div className="game-hud">
            <span>Score: {score}</span>
            <span>Best: {best.current}</span>
            {ui === 'over' && <span className="badge badge-good">+{earned} 🪙</span>}
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <div className="tiny" style={{ marginBottom: 8 }}>Flappy ASC</div>
            <p className="muted">Tap / Space to flap. Pass pipes to score. 3 points = 1 ASC Coin, max 75 per round.</p>
            <div className="divider" />
            <div className="tiny">How rewards work</div>
            <ul className="muted" style={{ fontSize: 13, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Scores are validated on the server (max 500).</li>
              <li>One submission per 15 seconds to prevent spam.</li>
              <li>Every payout is written to your coin ledger.</li>
            </ul>
          </div>
          <div className="card">
            <div className="tiny" style={{ marginBottom: 8 }}>More ways to earn</div>
            <p className="muted" style={{ fontSize: 13 }}>• Daily 100 in Wallet<br />• Gifts from friends<br />• Gift cards from admins</p>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <Link className="btn btn-ghost btn-sm" to="/wallet">Open wallet</Link>
              {(RANK[user.role] || 0) >= RANK.moderator && <Link className="btn btn-ghost btn-sm" to="/admin?tab=giftcards">Create gift cards</Link>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
