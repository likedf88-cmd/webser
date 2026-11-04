/**
 * Avatar model inspection + skeleton compatibility.
 *
 * This module deliberately does NOT invent skeletons or animations. It reads a
 * real glTF/GLB file, reports what is actually inside it, and maps an existing
 * humanoid skeleton onto the platform's canonical bone names by renaming the
 * joints inside a *copy* of the GLB (the original upload is never modified).
 *
 * Models without a skeleton are reported as `unsupported`. Autorigging needs an
 * external provider (Meshy rigging, Mixamo, ...); nothing here fakes one.
 */
import path from 'node:path'

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/** Canonical humanoid skeleton — Mixamo / Unity / VRM compatible names. */
export const CORE_BONES = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'rightUpperArm',
  'leftUpperLeg', 'rightUpperLeg'
]

export const FULL_BONES = [
  ...CORE_BONES,
  'neck', 'chest',
  'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'
]

/** Extra bones we map when present, but never require. */
export const OPTIONAL_BONES = ['leftShoulder', 'rightShoulder', 'leftToes', 'rightToes']

const SIDED_WORDS = [
  'upperarm', 'lowerarm', 'forearm', 'arm', 'hand', 'wrist', 'shoulder', 'clavicle', 'collarbone',
  'upleg', 'upperleg', 'thigh', 'leg', 'calf', 'shin', 'foot', 'ankle', 'toe', 'toebase', 'toes',
  'finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'little'
]

export class AvatarError extends Error {
  constructor(message, code = 'invalid-model') {
    super(message)
    this.code = code
  }
}

/** Compact a bone name for matching: strips namespace prefixes and separators. */
export function compactBoneName(name) {
  const raw = String(name || '')
  const tail = raw.includes('|') ? raw.split('|').pop() : raw
  const noNs = tail.includes(':') ? tail.split(':').pop() : tail
  return noNs.toLowerCase().replace(/mixamorig/g, '').replace(/[^a-z0-9]/g, '')
}

/** Map a source bone name to a canonical humanoid bone, or null. */
export function canonicalBone(name) {
  let c = compactBoneName(name)
  if (!c) return null
  let side = null
  if (c.startsWith('left')) { side = 'left'; c = c.slice(4) }
  else if (c.startsWith('right')) { side = 'right'; c = c.slice(5) }
  else if (c.endsWith('left')) { side = 'left'; c = c.slice(0, -4) }
  else if (c.endsWith('right')) { side = 'right'; c = c.slice(0, -5) }
  else if (/^[a-z]+l$/.test(c) && SIDED_WORDS.some(w => c.startsWith(w))) { side = 'left'; c = c.slice(0, -1) }
  else if (/^[a-z]+r$/.test(c) && SIDED_WORDS.some(w => c.startsWith(w))) { side = 'right'; c = c.slice(0, -1) }
  if (!c) return null

  const cap = side === 'left' ? 'left' : side === 'right' ? 'right' : null
  const sided = (suffix) => (cap ? cap + suffix : null)

  if (/^(hips|hip|pelvis|root|bip01pelvis|bip01)$/.test(c)) return 'hips'
  if (/^(spine|spine0*1|spine0*0|lower$|lowerbody|abdomen|torso)$/.test(c)) return 'spine'
  if (/^(spine0*2|spine0*3|chest|upperchest|ribcage|stomach)$/.test(c)) return 'chest'
  if (/^(neck|neck0*1)$/.test(c)) return 'neck'
  if (/^(head|skull)$/.test(c)) return 'head'
  if (/^(headtop|headend|headtopend|end|endsite|lastbone)$/.test(c)) return null

  if (/^(shoulder|clavicle|collarbone)$/.test(c)) return sided('Shoulder')
  if (/^(upperarm|armupper|arm)$/.test(c)) return sided('UpperArm')
  if (/^(lowerarm|forearm|elbow|armlower)$/.test(c)) return sided('LowerArm')
  if (/^(hand|wrist|hand0*1)$/.test(c)) return sided('Hand')
  if (/^(upleg|upperleg|thigh|legupper)$/.test(c)) return sided('UpperLeg')
  if (/^(lowerleg|leg|leglower|calf|shin|knee)$/.test(c)) return sided('LowerLeg')
  if (/^(foot|ankle|foot0*1)$/.test(c)) return sided('Foot')
  if (/^(toebase|toe|toes|ball|foottoe)$/.test(c)) return sided('Toes')
  // Fingers and helper bones are recognised but not part of the humanoid map.
  return null
}

/** Read chunk structure of a binary glTF container. */
export function readGlbChunks(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer)
  if (buffer.length < 20) throw new AvatarError('File is too small to be a GLB model', 'invalid-glb')
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new AvatarError('Not a binary glTF file (bad magic bytes)', 'invalid-glb')
  if (buffer.readUInt32LE(4) !== 2) throw new AvatarError('Only glTF 2.0 models are supported', 'invalid-glb')
  if (buffer.readUInt32LE(8) !== buffer.length) throw new AvatarError('GLB header length does not match the file size', 'invalid-glb')

  const chunks = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + len > buffer.length) throw new AvatarError('Corrupt GLB chunk length', 'invalid-glb')
    chunks.push({ type, data: buffer.subarray(start, start + len) })
    offset = start + len
  }
  const jsonChunk = chunks.find(c => c.type === CHUNK_JSON)
  if (!jsonChunk) throw new AvatarError('GLB has no JSON chunk', 'invalid-glb')
  let json
  try {
    json = JSON.parse(jsonChunk.data.toString('utf8').replace(/\u0000+$/g, '').trim())
  } catch {
    throw new AvatarError('GLB JSON chunk is not valid JSON', 'invalid-glb')
  }
  return { json, chunks, hasBin: chunks.some(c => c.type === CHUNK_BIN) }
}

function parseModel(buffer, filename) {
  const ext = path.extname(String(filename || '')).toLowerCase()
  if (ext === '.glb') {
    const parsed = readGlbChunks(buffer)
    return { format: 'glb', ...parsed }
  }
  if (ext === '.gltf') {
    let json
    try { json = JSON.parse(buffer.toString('utf8')) } catch {
      throw new AvatarError('glTF file is not valid JSON', 'invalid-gltf')
    }
    return { format: 'gltf', json, chunks: [], hasBin: false }
  }
  throw new AvatarError('Avatar models must be .glb or .gltf', 'unsupported-format')
}

function assertAsset(json) {
  const version = String(json?.asset?.version || '')
  if (!version.startsWith('2.')) throw new AvatarError('Only glTF 2.0 models are supported', 'invalid-gltf')
  if (!Array.isArray(json.meshes) || json.meshes.length === 0) {
    throw new AvatarError('This model contains no meshes', 'invalid-gltf')
  }
  if ((json.nodes || []).length > 20000) throw new AvatarError('Model has too many nodes (limit 20,000)', 'invalid-gltf')
}

function externalRefs(json) {
  const refs = []
  for (const b of json.buffers || []) if (b.uri && !String(b.uri).startsWith('data:')) refs.push(String(b.uri))
  for (const im of json.images || []) if (im.uri && !String(im.uri).startsWith('data:')) refs.push(String(im.uri))
  return refs
}

function statsOf(json) {
  const accCount = (i) => Number(json.accessors?.[i]?.count) || 0
  let triangles = 0
  let primitives = 0
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      primitives++
      if ((prim.mode ?? 4) !== 4) continue
      if (prim.indices !== undefined) triangles += Math.floor(accCount(prim.indices) / 3)
      else if (prim.attributes?.POSITION !== undefined) triangles += Math.floor(accCount(prim.attributes.POSITION) / 3)
    }
  }
  const animations = (json.animations || []).map((a, i) => {
    let duration = 0
    for (const s of a.samplers || []) {
      const max = json.accessors?.[s.input]?.max?.[0]
      if (Number(max) > duration) duration = Number(max)
    }
    return { name: a.name || `Clip ${i + 1}`, duration: Number(duration.toFixed(2)) }
  })
  return {
    meshes: (json.meshes || []).length,
    primitives,
    triangles,
    materials: (json.materials || []).length,
    textures: (json.textures || []).length,
    images: (json.images || []).length,
    nodes: (json.nodes || []).length,
    skins: (json.skins || []).length,
    animations,
    extensions: json.extensionsUsed || []
  }
}

/** Compare the model's skin joints with the canonical humanoid skeleton. */
export function analyzeRig(json) {
  const joints = [...new Set((json.skins || []).flatMap(s => s.joints || []))]
  const bones = joints.map(index => ({ index, name: json.nodes?.[index]?.name || '' }))
  const mapping = {}
  const duplicate = []
  const unmapped = []

  for (const bone of bones) {
    const canonical = canonicalBone(bone.name)
    if (!canonical) { unmapped.push(bone.name || `#${bone.index}`); continue }
    if (mapping[canonical] === undefined) mapping[canonical] = bone.index
    else duplicate.push(bone.name)
  }

  const mapped = Object.keys(mapping)
  const coreMissing = CORE_BONES.filter(b => mapping[b] === undefined)
  const fullMissing = FULL_BONES.filter(b => mapping[b] === undefined)
  const coverage = Number((mapped.length / FULL_BONES.length).toFixed(3))
  const warnings = []
  if (duplicate.length) warnings.push(`Ignored duplicate joints: ${duplicate.slice(0, 6).join(', ')}`)
  if (unmapped.length && bones.length) warnings.push(`${unmapped.length} joint(s) outside the humanoid map (fingers, helpers or extra bones)`)

  let status = 'ready'
  let rig = 'compatible'
  let detail = ''

  if (bones.length === 0) {
    status = 'unsupported'
    rig = 'none'
    detail = 'No skeleton found in this model, so it cannot be animated or carried into the world. Automatic rigging needs an external rigging provider that is not connected to this deployment — retry after it is configured, or upload a pre-rigged humanoid GLB.'
  } else if (coreMissing.length) {
    status = 'unsupported'
    rig = 'incompatible'
    detail = `Found ${bones.length} joint(s) but the required humanoid bones could not be matched: ${coreMissing.join(', ')}. Rename the joints to standard humanoid names (Mixamo or Unity style) and retry, or use a manual rigging workflow.`
  } else if (fullMissing.length) {
    rig = 'remapped'
    detail = `Skeleton matched and mapped to the platform humanoid rig. Optional bones missing: ${fullMissing.join(', ')}.`
  } else {
    detail = 'Skeleton fully matches the platform humanoid rig.'
  }

  return {
    status,
    rig,
    detail,
    mapping,
    mappedBones: mapped.sort(),
    mappingCoverage: coverage,
    coreMissing,
    fullMissing,
    unmapped,
    warnings,
    jointCount: bones.length,
    joints: bones.map(b => ({ index: b.index, name: b.name, canonical: canonicalBone(b.name) || null }))
  }
}

/**
 * Rewrite a copy of the GLB with canonical joint names.
 * Returns null when nothing needed renaming.
 */
export function canonicalizeGlb(buffer, mapping) {
  const { json, chunks } = readGlbChunks(buffer)
  let changed = 0
  for (const [canonical, index] of Object.entries(mapping || {})) {
    const node = json.nodes?.[index]
    if (!node) continue
    if (node.name !== canonical) { node.name = canonical; changed++ }
  }
  if (!changed) return null

  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const out = [{ type: CHUNK_JSON, data: Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]) }]
  for (const chunk of chunks) {
    if (chunk.type === CHUNK_JSON) continue
    const pad = (4 - (chunk.data.length % 4)) % 4
    out.push({ type: chunk.type, data: pad ? Buffer.concat([chunk.data, Buffer.alloc(pad)]) : chunk.data })
  }
  const total = 12 + out.reduce((sum, c) => sum + 8 + c.data.length, 0)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const parts = [header]
  for (const chunk of out) {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(chunk.data.length, 0)
    head.writeUInt32LE(chunk.type, 4)
    parts.push(head, chunk.data)
  }
  return Buffer.concat(parts)
}

/**
 * Full analysis of an uploaded avatar file.
 * Throws AvatarError for invalid input; returns inspection + rig report otherwise.
 */
export function analyzeModel(buffer, filename) {
  const parsed = parseModel(buffer, filename)
  const { json, format, hasBin } = parsed
  assertAsset(json)

  const external = externalRefs(json)
  if (external.length) {
    throw new AvatarError(
      `This model points at external files (${external.slice(0, 3).join(', ')}). Export a self-contained .glb so it can be stored and served securely.`,
      'external-assets'
    )
  }
  if (format === 'glb' && (json.buffers || []).some(b => !b.uri) && !hasBin) {
    throw new AvatarError('GLB declares a binary buffer but contains no BIN chunk', 'invalid-glb')
  }

  const stats = statsOf(json)
  const rig = analyzeRig(json)
  const normalized = rig.status === 'ready' && format === 'glb'
    ? canonicalizeGlb(buffer, rig.mapping)
    : null

  return {
    format,
    bytes: buffer.length,
    stats,
    rig: {
      status: rig.status,
      kind: rig.rig,
      detail: rig.detail,
      mappingCoverage: rig.mappingCoverage,
      mappedBones: rig.mappedBones,
      coreMissing: rig.coreMissing,
      fullMissing: rig.fullMissing,
      jointCount: rig.jointCount,
      warnings: rig.warnings,
      joints: rig.joints,
      renamedJoints: normalized ? Object.keys(rig.mapping).length : 0
    },
    normalized
  }
}
