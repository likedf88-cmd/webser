/** tiny in-process event bus so REST handlers can push realtime events */
let io = null
export function setIO(instance) {
  io = instance
}
export function emitToUser(userId, event, payload) {
  if (io && userId) io.to('user:' + userId).emit(event, payload)
}
export function emitToAll(event, payload) {
  if (io) io.emit(event, payload)
}
export function onlineUserIds() {
  if (!io) return []
  return [...online]
}
export const online = new Map() // userId -> connection count
export function trackOnline(userId, delta) {
  const next = (online.get(userId) || 0) + delta
  if (next <= 0) online.delete(userId)
  else online.set(userId, next)
}
