const buckets = new Map()

/** simple fixed-window limiter keyed by IP + label */
export function rateLimit(max, windowMs, label = 'default') {
  return (req, res, next) => {
    const key = label + ':' + (req.ip || req.socket?.remoteAddress || 'unknown')
    const now = Date.now()
    let entry = buckets.get(key)
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs }
      buckets.set(key, entry)
    }
    entry.count++
    if (entry.count > max) {
      res.status(429).json({ error: 'Too many requests, slow down a little.' })
      return
    }
    next()
  }
}
