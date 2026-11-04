import { useCallback, useEffect, useState } from 'react'
import { api, timeAgo } from '../api'
import { Avatar, Empty, Spinner, StoryViewer } from '../components/ui'
import { StoryComposer } from './Feed'
import { useToast } from '../store'

export default function StoriesPage() {
  const toast = useToast()
  const [groups, setGroups] = useState(null)
  const [viewer, setViewer] = useState(-1)
  const [create, setCreate] = useState(false)

  const load = useCallback(() => {
    api('/stories').then(d => setGroups(d.groups || [])).catch(e => toast(e.message, 'error'))
  }, [toast])

  useEffect(() => { load() }, [load])

  if (!groups) return <div className="page"><Spinner label="Loading stories…" /></div>

  return (
    <div className="page">
      <div className="section-title">
        <div>
          <h2>Stories</h2>
          <p className="muted">24-hour updates from people you follow.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreate(true)}>＋ New story</button>
      </div>

      {groups.length === 0
        ? <Empty emoji="📸" title="No active stories" hint="Stories disappear after 24 hours. Post the first one." action={<button className="btn btn-primary" onClick={() => setCreate(true)}>Create story</button>} />
        : (
          <div className="grid grid-3">
            {groups.map((g, i) => (
              <button key={g.user.id} className="shop-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setViewer(i)}>
                <div style={{ position: 'relative' }}>
                  {g.stories[0]?.mediaType === 'image'
                    ? <img className="shop-thumb" src={g.stories[0].mediaUrl} alt="" />
                    : <div className="shop-thumb" style={{ background: 'var(--grad-soft)', display: 'grid', placeItems: 'center', fontSize: 40 }}>📸</div>}
                  <div style={{ position: 'absolute', bottom: 8, left: 8 }} className="avatar-ring">
                    <Avatar user={g.user} size={38} />
                  </div>
                </div>
                <div className="shop-body">
                  <strong>{g.user.displayName}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{g.stories.length} update{g.stories.length > 1 ? 's' : ''} · {timeAgo(g.stories[g.stories.length - 1].createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

      {create && <StoryComposer onClose={() => setCreate(false)} onCreated={() => { setCreate(false); load(); toast('Story posted', 'success') }} />}
      {viewer >= 0 && <StoryViewer groups={groups} startIndex={viewer} onClose={() => setViewer(-1)} onChanged={load} />}
    </div>
  )
}
