export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'include', headers: {} }
  if (form) opts.body = form
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch('/api' + path, opts)
  let data = {}
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const upload = (path, formData, method = 'POST') => api(path, { method, form: formData })

export function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 45) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  if (s < 604800) return Math.floor(s / 86400) + 'd'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function compact(n) {
  if (n == null) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K'
  return String(n)
}

export const initials = (name = '?') => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

export const timeLeft = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const RANK = { user: 0, moderator: 1, admin: 2, owner: 3 }
export const roleLabel = { user: 'User', moderator: 'Moderator', admin: 'Administrator', owner: 'Owner · Ultra Admin' }

export const ZONES = [
  { id: 'plaza', name: 'Neon Plaza', icon: '🌃', blurb: 'The social heart of Avatarverse' },
  { id: 'beach', name: 'Aurora Beach', icon: '🏖️', blurb: 'Sunset sand, music and chill' },
  { id: 'club', name: 'Pulse Club', icon: '🪩', blurb: 'Emotes, music and late night vibes' }
]

export const RINGTONES = [
  { id: 'classic', name: 'Classic Ring', notes: [660, 880, 660, 880] },
  { id: 'chime', name: 'Soft Chime', notes: [880, 1046, 1318] },
  { id: 'pulse', name: 'Neon Pulse', notes: [440, 0, 440, 660] },
  { id: 'orbit', name: 'Orbit', notes: [523, 659, 784, 1046] },
  { id: 'off', name: 'Silent (vibrate only)', notes: [] }
]
