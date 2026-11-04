import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { api } from './api'

const AuthCtx = createContext(null)
const ToastCtx = createContext(null)
const SocketCtx = createContext(null)
const LiveCtx = createContext(null)

export function useAuth() { return useContext(AuthCtx) }
export function useToast() { return useContext(ToastCtx) }
export function useSocket() { return useContext(SocketCtx) }
export function useLive() { return useContext(LiveCtx) }

export function AppProviders({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [toasts, setToasts] = useState([])
  const [socket, setSocket] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('asc-theme') || 'dark')
  const [unread, setUnread] = useState(0)
  const [onlineIds, setOnlineIds] = useState([])

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  const refresh = useCallback(async () => {
    const data = await api('/auth/me')
    setUser(data.user)
    return data.user
  }, [])

  const refreshNotifs = useCallback(async () => {
    if (!user) return
    try {
      const data = await api('/notifications')
      setUnread(data.unread)
    } catch { /* offline */ }
  }, [user?.id])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('asc-theme', theme)
  }, [theme])

  useEffect(() => {
    refresh().catch(() => {}).finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!user) {
      if (socket) socket.disconnect()
      setSocket(null)
      return
    }
    const s = io({ withCredentials: true, transports: ['websocket', 'polling'] })
    setSocket(s)
    s.on('presence:list', ids => setOnlineIds(ids))
    s.on('presence:update', ({ userId, online }) =>
      setOnlineIds(prev => online ? [...new Set([...prev, userId])] : prev.filter(id => id !== userId)))
    s.on('notify', () => refreshNotifs())
    return () => { s.disconnect(); setSocket(null) }
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    refreshNotifs()
    const t = setInterval(refreshNotifs, 45000)
    return () => clearInterval(t)
  }, [user?.id, refreshNotifs])

  const login = useCallback(async (identifier, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { identifier, password } })
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (payload) => {
    const data = await api('/auth/register', { method: 'POST', body: payload })
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, setUser, ready, refresh, login, register, logout, onlineIds }}>
      <SocketCtx.Provider value={socket}>
        <ToastCtx.Provider value={toast}>
          <LiveCtx.Provider value={{ unread, setUnread, refreshNotifs, theme, setTheme }}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
              {toasts.map(t => (
                <div key={t.id} className={'toast toast-' + t.type}>{t.message}</div>
              ))}
            </div>
          </LiveCtx.Provider>
        </ToastCtx.Provider>
      </SocketCtx.Provider>
    </AuthCtx.Provider>
  )
}
