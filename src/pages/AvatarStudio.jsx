import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, timeAgo } from '../api'
import { useAuth, useToast } from '../store'
import { Empty, Spinner } from '../components/ui'
import Avatar3D, { DEFAULT_LOOK } from '../components/Avatar3D'

const SLOTS = [
  { key: 'skin', label: 'Skin', presets: ['#f1c7a8', '#d9a066', '#a1663f', '#6b4226', '#3f2a1d', '#f7d9c4'] },
  { key: 'hair', label: 'Hair', presets: ['#3b2a4a', '#1f2937', '#8b5cf6', '#ec4899', '#22d3ee', '#f59e0b', '#e5e7eb'] },
  { key: 'shirt', label: 'Top', presets: ['#8b5cf6', '#22d3ee', '#ec4899', '#34d399', '#f97316', '#111827', '#f8fafc'] },
  { key: 'pants', label: 'Bottom', presets: ['#1f2937', '#334155', '#0ea5e9', '#7c3aed', '#166534', '#4b5563', '#f8fafc'] },
  { key: 'eyes', label: 'Eyes', presets: ['#111827', '#2563eb', '#059669', '#7c3aed', '#b45309', '#0891b2'] }
]

const STATUS_META = {
  queued: { label: 'Queued', tone: 'badge-warn' },
  processing: { label: 'Processing', tone: 'badge-warn' },
  ready: { label: 'Ready', tone: 'badge-good' },
  unsupported: { label: 'Needs rigging', tone: 'badge-bad' },
  failed: { label: 'Rejected', tone: 'badge-bad' }
}

function uploadWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('model', file)
    form.append('name', file.name.replace(/\.(glb|gltf)$/i, '').slice(0, 60))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/avatar/upload')
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data.error || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — check your connection'))
    xhr.send(form)
  })
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const fmtBytes = (n) => (!n ? '—' : n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB')

export default function AvatarStudioPage() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [look, setLook] = useState(DEFAULT_LOOK)
  const [selectedId, setSelectedId] = useState(null)
  const [clip, setClip] = useState(0)
  const [info, setInfo] = useState(null)
  const [uploading, setUploading] = useState(null)
  const [outfitName, setOutfitName] = useState('')
  const [bone, setBone] = useState('head')
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const d = await api('/avatar/me')
      setData(d)
      setLook({ ...DEFAULT_LOOK, ...d.look })
      setSelectedId(prev => {
        if (prev && d.avatars.some(a => a.id === prev)) return prev
        return d.equipped || d.avatars.find(a => a.status === 'ready')?.id || d.avatars[0]?.id || null
      })
    } catch (e) { toast(e.message, 'error') }
  }, [toast])

  useEffect(() => { load() }, [load])

  const avatars = data?.avatars || []
  const selected = avatars.find(a => a.id === selectedId) || null
  const previewUrl = selected?.status === 'ready' ? selected.url : null
  const equipped = avatars.find(a => a.equipped) || null
  const accessories = data?.accessories || []
  const clips = useMemo(() => info?.clips || selected?.stats?.animations?.map(a => a.name) || [], [info, selected])

  const poll = async (id) => {
    for (let i = 0; i < 45; i++) {
      await sleep(900)
      try {
        const { avatar } = await api('/avatar/' + id)
        if (['ready', 'unsupported', 'failed'].includes(avatar.status)) return avatar
      } catch { /* keep polling */ }
    }
    return null
  }

  const onFile = async (file) => {
    if (!file) return
    if (!/\.(glb|gltf)$/i.test(file.name)) return toast('Only .glb or .gltf models are accepted', 'error')
    if (file.size > 20 * 1024 * 1024) return toast('Model is larger than the 20 MB limit', 'error')
    setUploading({ name: file.name, progress: 0 })
    try {
      const { avatar } = await uploadWithProgress(file, p => setUploading(u => u ? { ...u, progress: p } : u))
      setUploading(u => u ? { ...u, progress: 100, processing: true } : u)
      const finished = await poll(avatar.id)
      await load()
      if (finished) {
        setSelectedId(finished.id)
        if (finished.status === 'ready') toast('Avatar processed and ready to equip', 'success')
        else toast(finished.detail || 'Model could not be rigged', 'error')
      }
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setUploading(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const retry = async (id) => {
    try {
      await api('/avatar/' + id + '/retry', { method: 'POST' })
      toast('Model queued for reprocessing', 'info')
      await poll(id)
      await load()
    } catch (e) { toast(e.message, 'error') }
  }

  const remove = async (id) => {
    if (!confirm('Delete this avatar model? This cannot be undone.')) return
    try {
      await api('/avatar/' + id, { method: 'DELETE' })
      toast('Avatar deleted', 'success')
      setSelectedId(null)
      await load()
    } catch (e) { toast(e.message, 'error') }
  }

  const equip = async (id) => {
    try {
      await api('/avatar/' + id + '/select', { method: 'POST' })
      toast('Avatar equipped — it now shows on your profile', 'success')
      await load()
      refresh().catch(() => {})
    } catch (e) { toast(e.message, 'error') }
  }

  const saveLook = async () => {
    try {
      const d = await api('/avatar/look', { method: 'PUT', body: look })
      setLook({ ...DEFAULT_LOOK, ...d.look })
      toast('Appearance saved', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const saveOutfit = async () => {
    if (!outfitName.trim()) return toast('Name the outfit first', 'error')
    try {
      await api('/avatar/outfits', { method: 'POST', body: { name: outfitName.trim(), look } })
      setOutfitName('')
      toast('Outfit saved', 'success')
      await load()
    } catch (e) { toast(e.message, 'error') }
  }

  const applyOutfit = async (id) => {
    try {
      const d = await api('/avatar/outfits/' + id + '/apply', { method: 'POST' })
      setLook({ ...DEFAULT_LOOK, ...d.look })
      toast('Outfit applied — save the look if you want it as your default', 'info')
    } catch (e) { toast(e.message, 'error') }
  }

  const deleteOutfit = async (id) => {
    try {
      await api('/avatar/outfits/' + id, { method: 'DELETE' })
      await load()
    } catch (e) { toast(e.message, 'error') }
  }

  const attach = async (itemId) => {
    try {
      await api('/avatar/accessories', { method: 'POST', body: { itemId, bone } })
      toast('Attached to ' + bone, 'success')
      await load()
    } catch (e) { toast(e.message, 'error') }
  }

  const detach = async (itemId) => {
    try {
      await api('/avatar/accessories/' + itemId, { method: 'DELETE' })
      await load()
    } catch (e) { toast(e.message, 'error') }
  }

  if (!data) return <div className="page"><Spinner label="Opening Avatar Studio…" /></div>

  const stats = selected?.stats
  const skeleton = selected?.skeleton

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Avatar Studio</h1>
          <p className="muted">Upload a 3D model, verify its humanoid rig, and dress your look for profiles and the world.</p>
        </div>
        <Link className="btn btn-ghost btn-sm" to={'/u/' + user.username}>View my profile</Link>
      </div>

      <div className="studio-grid">
        <section className="card studio-viewer">
          <div className="section-title">
            <h2>{selected?.name || 'Your avatar'}</h2>
            {selected && (
              <span className={'badge ' + (STATUS_META[selected.status]?.tone || 'badge')}>
                {equipped?.id === selected.id ? 'Equipped' : STATUS_META[selected.status]?.label || selected.status}
              </span>
            )}
          </div>

          <Avatar3D
            key={previewUrl || 'default'}
            url={previewUrl}
            look={look}
            accessories={accessories}
            height={400}
            interactive
            autoRotate
            clip={clip}
            onInfo={setInfo}
          />

          <div className="row wrap studio-controls">
            {clips.length > 0 ? (
              <label className="field" style={{ minWidth: 170 }}>
                <span className="label">Animation</span>
                <select className="select" value={clip} onChange={e => setClip(Number(e.target.value))}>
                  {clips.map((c, i) => <option key={c + i} value={i}>{c}</option>)}
                </select>
              </label>
            ) : <span className="badge">{info?.defaultAvatar ? 'Default platform avatar' : 'No animation clips in this model'}</span>}
            {selected?.status === 'ready' && equipped?.id !== selected.id && (
              <button className="btn btn-primary btn-sm" onClick={() => equip(selected.id)}>Equip this avatar</button>
            )}
            {selected && (
              <button className="btn btn-ghost btn-sm" onClick={() => remove(selected.id)}>Delete</button>
            )}
          </div>

          {selected?.detail && <p className="muted studio-detail">{selected.detail}</p>}

          {stats && (
            <div className="studio-stats">
              <div><b>{stats.triangles?.toLocaleString?.() || 0}</b><span>triangles</span></div>
              <div><b>{stats.meshes}</b><span>meshes</span></div>
              <div><b>{stats.textures}</b><span>textures</span></div>
              <div><b>{skeleton?.jointCount || 0}</b><span>joints</span></div>
              <div><b>{stats.animations?.length || 0}</b><span>clips</span></div>
              <div><b>{Math.round((skeleton?.coverage || 0) * 100)}%</b><span>rig match</span></div>
            </div>
          )}

          {skeleton?.fullMissing?.length > 0 && (
            <p className="hint">Unmapped optional bones: {skeleton.fullMissing.join(', ')}</p>
          )}
          {skeleton?.warnings?.length > 0 && (
            <p className="hint">{skeleton.warnings.join(' · ')}</p>
          )}
          {selected?.status === 'unsupported' && (
            <button className="btn btn-ghost btn-sm" onClick={() => retry(selected.id)}>Retry processing</button>
          )}
        </section>

        <div className="stack-list">
          <section className="card">
            <div className="section-title"><h2>Upload a model</h2><span className="badge">GLB · glTF</span></div>
            <p className="hint">
              Self-contained .glb or .gltf, up to {fmtBytes(data.limits.maxBytes)}. The server inspects the real
              geometry, textures and skeleton — nothing is rigged by guesswork.
            </p>
            <input
              ref={fileRef}
              className="input"
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              onChange={e => onFile(e.target.files?.[0])}
              disabled={!!uploading}
            />
            {uploading && (
              <div className="upload-progress">
                <div className="row-between hint">
                  <span className="truncate">{uploading.name}</span>
                  <span>{uploading.processing ? 'Inspecting…' : uploading.progress + '%'}</span>
                </div>
                <div className="bar"><i style={{ width: (uploading.processing ? 100 : uploading.progress) + '%' }} /></div>
              </div>
            )}
            <p className="hint">
              No skeleton? The studio reports it honestly. Automatic rigging requires an external rigging
              provider, which is not connected to this deployment — upload a pre-rigged humanoid model instead.
            </p>
          </section>

          <section className="card">
            <div className="section-title"><h2>Your models</h2><span className="badge">{avatars.length}/20</span></div>
            {avatars.length === 0
              ? <Empty emoji="🧍" title="No models yet" hint="Upload a rigged GLB to get started." />
              : (
                <div className="stack-list">
                  {avatars.map(a => (
                    <div key={a.id} className={'studio-model ' + (a.id === selectedId ? 'active' : '')}>
                      <button className="studio-model-main" onClick={() => { setSelectedId(a.id); setClip(0) }}>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontWeight: 700 }}>{a.name}</div>
                          <div className="hint truncate">{fmtBytes(a.fileSize)} · {timeAgo(a.createdAt)} ago · {a.rig}</div>
                        </div>
                        <span className={'badge ' + (STATUS_META[a.status]?.tone || 'badge')}>{STATUS_META[a.status]?.label || a.status}</span>
                      </button>
                      <div className="row" style={{ gap: 4 }}>
                        {a.status === 'ready' && !a.equipped && (
                          <button className="link-btn" onClick={() => equip(a.id)}>Equip</button>
                        )}
                        {a.status === 'ready' && <Link className="link-btn" to={'/u/' + user.username}>Profile</Link>}
                        {['unsupported', 'failed'].includes(a.status) && (
                          <button className="link-btn" onClick={() => retry(a.id)}>Retry</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section className="card">
            <div className="section-title"><h2>Appearance</h2><button className="btn btn-primary btn-sm" onClick={saveLook}>Save look</button></div>
            {SLOTS.map(slot => (
              <div className="look-row" key={slot.key}>
                <label className="label" htmlFor={'look-' + slot.key}>{slot.label}</label>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    id={'look-' + slot.key}
                    type="color"
                    className="color-input"
                    value={look[slot.key]}
                    onChange={e => setLook(l => ({ ...l, [slot.key]: e.target.value }))}
                  />
                  <div className="swatches">
                    {slot.presets.map(c => (
                      <button
                        key={c}
                        className={'swatch ' + (look[slot.key] === c ? 'on' : '')}
                        style={{ background: c }}
                        onClick={() => setLook(l => ({ ...l, [slot.key]: c }))}
                        aria-label={`${slot.label} ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <p className="hint">
              Colours tint materials whose names identify hair, skin, top, bottom or eyes. Textured models that
              do not name their materials keep their original look.
            </p>
          </section>

          <section className="card">
            <div className="section-title"><h2>Outfits</h2><span className="badge">{data.outfits.length}/20</span></div>
            <div className="row">
              <input
                className="input" placeholder="Outfit name" value={outfitName} maxLength={40}
                onChange={e => setOutfitName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveOutfit()}
              />
              <button className="btn btn-primary btn-sm" onClick={saveOutfit}>Save outfit</button>
            </div>
            {data.outfits.length === 0
              ? <p className="hint">Save your current colours as an outfit to switch back to it later.</p>
              : (
                <div className="stack-list" style={{ marginTop: 10 }}>
                  {data.outfits.map(o => (
                    <div key={o.id} className="row-between outfit-row">
                      <div className="row" style={{ gap: 6 }}>
                        {SLOTS.map(s => <i key={s.key} className="swatch tiny-swatch" style={{ background: o.look[s.key] || '#333' }} />)}
                        <span className="truncate" style={{ fontWeight: 600 }}>{o.name}</span>
                      </div>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="link-btn" onClick={() => applyOutfit(o.id)}>Apply</button>
                        <button className="link-btn danger" onClick={() => deleteOutfit(o.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section className="card">
            <div className="section-title"><h2>Accessories</h2><span className="badge">{accessories.length} attached</span></div>
            {data.ownedAccessories.length === 0
              ? <Empty emoji="🕶️" title="No cosmetic items yet" hint="Buy an accessory in the Marketplace." />
              : (
                <>
                  <label className="field">
                    <span className="label">Attachment point</span>
                    <select className="select" value={bone} onChange={e => setBone(e.target.value)}>
                      {['head', 'handRight', 'handLeft', 'chest', 'hips', 'back'].map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </label>
                  <div className="stack-list" style={{ marginTop: 10 }}>
                    {data.ownedAccessories.filter(item => item.category !== 'avatars').map(item => {
                      const attached = accessories.find(a => a.itemId === item.id)
                      return (
                        <div key={item.id} className="row-between outfit-row">
                          <div className="row" style={{ gap: 8, minWidth: 0 }}>
                            {item.thumbnail && <img className="mini-thumb" src={item.thumbnail} alt="" />}
                            <div style={{ minWidth: 0 }}>
                              <div className="truncate" style={{ fontWeight: 600 }}>{item.name}</div>
                              <div className="hint">{item.modelUrl ? (attached ? 'attached to ' + attached.bone : 'ready to attach') : 'no 3D model uploaded yet'}</div>
                            </div>
                          </div>
                          {item.modelUrl && (attached
                            ? <button className="link-btn danger" onClick={() => detach(item.id)}>Detach</button>
                            : <button className="link-btn" onClick={() => attach(item.id)}>Attach</button>)}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
          </section>
        </div>
      </div>
    </div>
  )
}
