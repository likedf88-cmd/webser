import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export const DEFAULT_LOOK = { skin: '#f1c7a8', hair: '#3b2a4a', shirt: '#8b5cf6', pants: '#1f2937', eyes: '#111827' }

/** Which appearance slot a mesh appears to belong to, from its name. */
function slotFor(object, material) {
  const hint = [object?.name, material?.name, object?.parent?.name].filter(Boolean).join(' ').toLowerCase()
  if (!hint) return null
  if (/hair|fringe|ponytail|braid|beard/.test(hint)) return 'hair'
  if (/eye|iris|pupil/.test(hint)) return 'eyes'
  if (/shirt|jacket|hoodie|top|torso|chest|cloth/.test(hint)) return 'shirt'
  if (/pant|trouser|jean|short|skirt|leg|boot|shoe/.test(hint)) return 'pants'
  if (/skin|body|face|head|arm|hand|neck|ear/.test(hint)) return 'skin'
  return null
}

function applyLook(root, look) {
  if (!root) return 0
  let tinted = 0
  root.traverse(obj => {
    if (!obj.isMesh) return
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of materials) {
      if (!mat || !mat.color) continue
      const slot = slotFor(obj, mat)
      if (slot && look?.[slot]) {
        mat.color.set(look[slot])
        mat.needsUpdate = true
        tinted++
      }
    }
  })
  return tinted
}

/** Low-poly platform avatar used when a user has not uploaded a GLB yet. */
function buildMannequin(look) {
  const group = new THREE.Group()
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 })
  const add = (geo, material, x, y, z, rz = 0, slot = null) => {
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(x, y, z)
    mesh.rotation.z = rz
    if (slot) mesh.userData.slot = slot
    group.add(mesh)
    return mesh
  }
  const skin = mat(look?.skin || DEFAULT_LOOK.skin)
  const shirt = mat(look?.shirt || DEFAULT_LOOK.shirt)
  const pants = mat(look?.pants || DEFAULT_LOOK.pants)
  const hair = mat(look?.hair || DEFAULT_LOOK.hair)
  const eyes = mat(look?.eyes || DEFAULT_LOOK.eyes)

  add(new THREE.CapsuleGeometry(0.26, 0.44, 6, 16), shirt, 0, 1.18, 0, 0, 'shirt')
  add(new THREE.SphereGeometry(0.19, 24, 18), skin, 0, 1.68, 0, 0, 'skin')
  const cap = add(new THREE.SphereGeometry(0.2, 24, 18), hair, 0, 1.71, 0, 0, 'hair')
  cap.scale.set(1.02, 0.72, 1.02)
  add(new THREE.SphereGeometry(0.028, 10, 10), eyes, -0.07, 1.7, 0.17, 0, 'eyes')
  add(new THREE.SphereGeometry(0.028, 10, 10), eyes, 0.07, 1.7, 0.17, 0, 'eyes')
  add(new THREE.CapsuleGeometry(0.075, 0.34, 4, 12), shirt, -0.3, 1.2, 0, 0.12, 'shirt')
  add(new THREE.CapsuleGeometry(0.075, 0.34, 4, 12), shirt, 0.3, 1.2, 0, -0.12, 'shirt')
  add(new THREE.SphereGeometry(0.07, 12, 12), skin, -0.34, 0.94, 0, 0, 'skin')
  add(new THREE.SphereGeometry(0.07, 12, 12), skin, 0.34, 0.94, 0, 0, 'skin')
  add(new THREE.CapsuleGeometry(0.1, 0.5, 4, 12), pants, -0.12, 0.55, 0, 0, 'pants')
  add(new THREE.CapsuleGeometry(0.1, 0.5, 4, 12), pants, 0.12, 0.55, 0, 0, 'pants')
  add(new THREE.BoxGeometry(0.18, 0.1, 0.3), pants, -0.12, 0.18, 0.04, 0, 'pants')
  add(new THREE.BoxGeometry(0.18, 0.1, 0.3), pants, 0.12, 0.18, 0.04, 0, 'pants')
  group.name = 'asc-default-avatar'
  return group
}

export default function Avatar3D({
  url = null,
  look = DEFAULT_LOOK,
  accessories = [],
  height = 360,
  interactive = true,
  autoRotate = true,
  clip = 0,
  onInfo,
  onError
}) {
  const host = useRef(null)
  const modelRef = useRef(null)
  const mixerRef = useRef(null)
  const actionsRef = useRef([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const accessoryKey = accessories.map(a => `${a.itemId}:${a.modelUrl}:${a.bone}`).join('|')

  /* scene lifecycle */
  useEffect(() => {
    const node = host.current
    if (!node) return
    let disposed = false
    let raf = 0
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100)
    camera.position.set(0, 1.35, 3.6)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(node.clientWidth || 320, node.clientHeight || height)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    node.appendChild(renderer.domElement)

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2f4a, 1.15)
    const key = new THREE.DirectionalLight(0xffffff, 1.9)
    key.position.set(2.6, 5.2, 3.4)
    const rim = new THREE.DirectionalLight(0xa78bfa, 1.5)
    rim.position.set(-3, 2.6, -3.2)
    const fill = new THREE.DirectionalLight(0x22d3ee, 0.6)
    fill.position.set(0, 1, -4)
    scene.add(hemi, key, rim, fill)

    const stage = new THREE.Group()
    scene.add(stage)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.35, 48),
      new THREE.MeshStandardMaterial({ color: 0x101426, roughness: 0.85, metalness: 0.15, transparent: true, opacity: 0.9 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.001
    scene.add(floor)
    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(1.33, 1.42, 64),
      new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    )
    glowRing.rotation.x = -Math.PI / 2
    glowRing.position.y = 0.002
    scene.add(glowRing)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.95, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 1.4
    controls.maxDistance = interactive ? 7 : 4.2
    controls.minPolarAngle = 0.35
    controls.maxPolarAngle = Math.PI / 2.02
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = 1.15
    controls.enabled = interactive
    controls.update()

    const clock = new THREE.Clock()
    const tick = () => {
      if (disposed) return
      raf = requestAnimationFrame(tick)
      const delta = Math.min(clock.getDelta(), 0.1)
      mixerRef.current?.update(delta)
      controls.update()
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    const resize = () => {
      const w = node.clientWidth || 320
      const h = node.clientHeight || height
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    resize()

    setStatus(url ? 'loading' : 'ready')
    setError(null)

    const loader = new GLTFLoader()
    const loadAccessory = (accessory, target) => new Promise(resolve => {
      loader.load(accessory.modelUrl, gltf => {
        if (disposed) return resolve()
        const prop = gltf.scene
        prop.name = 'accessory-' + accessory.itemId
        prop.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
        const bone = target?.getObjectByName(accessory.bone)
          || target?.getObjectByName(accessory.bone.charAt(0).toUpperCase() + accessory.bone.slice(1))
          || null
        if (bone) bone.add(prop)
        else { prop.position.set(0, 1.4, 0); target?.add(prop) }
        resolve()
      }, undefined, () => resolve())
    })

    const attachAccessories = async (target) => {
      for (const accessory of accessories) {
        if (!accessory?.modelUrl) continue
        await loadAccessory(accessory, target)
      }
    }

    if (!url) {
      const mannequin = buildMannequin(look)
      modelRef.current = mannequin
      stage.add(mannequin)
      onInfo?.({ clips: [], hasSkeleton: false, defaultAvatar: true })
    } else {
      loader.load(url, async gltf => {
        if (disposed) return
        const model = gltf.scene
        model.traverse(o => {
          if (o.isMesh) {
            o.frustumCulled = false
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            for (const m of mats) { if (m && 'metalness' in m) m.metalness = Math.min(m.metalness ?? 0, 0.4) }
          }
        })
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const targetHeight = 1.8
        if (size.y > 0.0001) {
          const scale = targetHeight / size.y
          model.scale.setScalar(scale)
        }
        const scaled = new THREE.Box3().setFromObject(model)
        model.position.y -= scaled.min.y
        model.position.x -= (scaled.min.x + scaled.max.x) / 2
        model.position.z -= (scaled.min.z + scaled.max.z) / 2
        stage.add(model)
        modelRef.current = model

        if (gltf.animations?.length) {
          const mixer = new THREE.AnimationMixer(model)
          mixerRef.current = mixer
          actionsRef.current = gltf.animations.map(c => mixer.clipAction(c))
          actionsRef.current[0]?.play()
        } else {
          mixerRef.current = null
          actionsRef.current = []
        }
        applyLook(model, look)
        await attachAccessories(model)
        if (disposed) return
        setStatus('ready')
        onInfo?.({
          clips: (gltf.animations || []).map(a => a.name),
          hasSkeleton: (gltf.animations || []).length > 0 || hasSkin(model)
        })
      }, undefined, err => {
        if (disposed) return
        const message = err?.message || 'Could not load this model'
        setError(message)
        setStatus('error')
        onError?.(message)
      })
    }

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      controls.dispose()
      scene.traverse(obj => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.()
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const m of mats) m?.dispose?.()
        }
      })
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      actionsRef.current = []
      modelRef.current = null
      renderer.dispose()
      if (renderer.domElement.parentNode === node) node.removeChild(renderer.domElement)
    }
  }, [url, accessoryKey, height, interactive, autoRotate])

  /* live appearance changes */
  useEffect(() => {
    const root = modelRef.current
    if (!root) return
    if (root.name === 'asc-default-avatar') {
      root.traverse(obj => {
        if (!obj.userData.slot) return
        obj.material?.color?.set(look?.[obj.userData.slot] || '#ffffff')
      })
    } else {
      applyLook(root, look)
    }
  }, [look.skin, look.hair, look.shirt, look.pants, look.eyes, url])

  /* clip switching */
  useEffect(() => {
    const actions = actionsRef.current
    if (!actions.length) return
    actions.forEach(a => a.fadeOut(0.2))
    const next = actions[Math.min(clip, actions.length - 1)]
    next.reset().fadeIn(0.2).play()
  }, [clip, status])

  return (
    <div className="avatar3d" style={{ height }} role="img" aria-label="3D avatar preview">
      <div ref={host} className="avatar3d-canvas" />
      {status === 'loading' && <div className="avatar3d-overlay"><div className="spinner" /><span>Loading avatar…</span></div>}
      {status === 'error' && (
        <div className="avatar3d-overlay avatar3d-error">
          <strong>3D preview unavailable</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function hasSkin(root) {
  let found = false
  root.traverse(o => { if (o.isSkinnedMesh) found = true })
  return found
}
