import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three'

export type LocalShape = readonly (readonly [x: number, y: number])[]

const key = ([x, y]: readonly [number, number]) => `${x},${y}`
const PITCH_X = 0.24
const PITCH_Y = 0.30
const shear = (x: number, y: number, z: number) => [x - z * PITCH_X, y - z * PITCH_Y, z]

type Edge = { from: [number, number]; to: [number, number] }

function contours(shape: LocalShape) {
  const boundary = new Map<string, Edge>()
  for (const [x, row] of shape) {
    const y = -row
    const corner: [number, number][] = [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]]
    for (let i = 0; i < 4; i += 1) {
      const from = corner[i]
      const to = corner[(i + 1) % 4]
      if (!boundary.delete(`${key(to)}:${key(from)}`)) boundary.set(`${key(from)}:${key(to)}`, { from, to })
    }
  }

  const paths: Vector2[][] = []
  for (const [initialId, initial] of boundary) {
    const loop: Vector2[] = []
    const start = key(initial.from)
    let id = initialId
    let edge: Edge | undefined = initial
    while (edge) {
      boundary.delete(id)
      loop.push(new Vector2(...edge.from))
      const endpoint = key(edge.to)
      if (endpoint === start) break
      const next = [...boundary].find(([, candidate]) => key(candidate.from) === endpoint)
      edge = next?.[1]
      if (next) id = next[0]
    }
    if (loop.length > 2) paths.push(loop)
  }
  return paths
}

function roundedPath(loop: Vector2[], steps: number) {
  const round: Vector2[] = []
  for (let i = 0; i < loop.length; i += 1) {
    const corner = loop[i]
    const before = loop[(i + loop.length - 1) % loop.length].clone().sub(corner).normalize()
    const after = loop[(i + 1) % loop.length].clone().sub(corner).normalize()
    const turn = before.cross(after)
    if (Math.abs(turn) < 0.1) continue

    const radius = turn < 0 ? 0.247 : 0.115
    const center = corner.clone().addScaledVector(before, radius).addScaledVector(after, radius)
    const direction = before.clone().negate()
    for (let step = 0; step <= steps; step += 1) {
      const angle = step / steps * Math.PI / 2
      const point = center.clone().addScaledVector(direction, Math.sin(angle) * radius)
        .addScaledVector(after, -Math.cos(angle) * radius)
      round.push(point)
    }
  }
  return round
}

function innerNormals(path: Vector2[]) {
  return path.map((point, i) => {
    const before = point.clone().sub(path[(i + path.length - 1) % path.length]).normalize()
    const after = path[(i + 1) % path.length].clone().sub(point).normalize()
    const tangent = before.add(after).normalize()
    return new Vector2(-tangent.y, tangent.x)
  })
}

function spaceBorder(border: Vector2[]) {
  return border.flatMap((point, i) => {
    const next = border[(i + 1) % border.length]
    const steps = Math.ceil(point.distanceTo(next) / 0.27)
    return Array.from({ length: steps }, (_, step) => point.clone().lerp(next, step / steps))
  })
}

function distanceToBorder(x: number, y: number, ring: Vector2[]) {
  let nearest = Infinity
  let inside = false
  for (let i = 0; i < ring.length; i += 1) {
    const from = ring[i]
    const to = ring[(i + 1) % ring.length]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const span = dx * dx + dy * dy
    if (!span) continue
    const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / span))
    const offsetX = x - (from.x + t * dx)
    const offsetY = y - (from.y + t * dy)
    nearest = Math.min(nearest, offsetX * offsetX + offsetY * offsetY)
    if ((from.y > y) !== (to.y > y) && x < from.x + (y - from.y) * dx / dy) inside = !inside
  }
  return Math.sqrt(nearest) * (inside ? 1 : -1)
}

function capRelief(x: number, y: number, ring: Vector2[]) {
  const nearest = distanceToBorder(x, y, ring)
  const shoulder = Math.max(0, Math.min(1, nearest / 0.14))
  const blend = shoulder * shoulder * (3 - 2 * shoulder)
  const radius = 0.071
  const softened = (2 * nearest + distanceToBorder(x - radius, y, ring) + distanceToBorder(x + radius, y, ring) +
    distanceToBorder(x, y - radius, ring) + distanceToBorder(x, y + radius, ring)) / 6
  const crease = Math.sin(x * 4.7 + Math.cos(y * 3.5) * 0.72) * Math.cos(y * 3.9 - x * 1.4)
  const filling = 0.157 + 0.035 * crease * blend
  return (1 - Math.exp(-(nearest + blend * (softened - nearest)) * 2.9)) * filling
}

// Refine only the front cap so its stuffing can bulge between the cloth edges.
function puffedCap(ring: Vector2[]) {
  const points = [...ring]
  const midpoints = new Map<string, number>()
  let triangles = ShapeUtils.triangulateShape(ring, [])
  function edgePoint(a: number, b: number) {
    // Preserve shared cap/side edges under nonlinear impact warps.
    const gap = Math.abs(a - b)
    if (a < ring.length && b < ring.length && (gap === 1 || gap === ring.length - 1)) return []
    return [split(a, b)]
  }
  function split(a: number, b: number) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const existing = midpoints.get(key)
    if (existing !== undefined) return existing
    const index = points.length
    points.push(points[a].clone().lerp(points[b], 0.5))
    midpoints.set(key, index)
    return index
  }
  for (let depth = 0; depth < 2; depth += 1) {
    triangles = triangles.flatMap(([a, b, c]) => {
      const boundary = [a, ...edgePoint(a, b), b, ...edgePoint(b, c), c, ...edgePoint(c, a)]
      const center = points.length
      points.push(points[a].clone().add(points[b]).add(points[c]).multiplyScalar(1 / 3))
      return boundary.map((vertex, i) => [vertex, boundary[(i + 1) % boundary.length], center])
    })
  }
  return {
    triangles,
    interior: points.slice(ring.length).map(point => {
      const { x, y } = point
      const radius = 0.05
      const dx = (capRelief(x + radius, y, ring) - capRelief(x - radius, y, ring)) / (2 * radius)
      const dy = (capRelief(x, y + radius, ring) - capRelief(x, y - radius, ring)) / (2 * radius)
      const normal = new Vector3(-dx, -dy, 1 - PITCH_X * dx - PITCH_Y * dy).normalize()
      return { point, lift: capRelief(x, y, ring), normal }
    }),
  }
}

// The wide middle and rounded cap give the stuffed cloth its volume.
const LOFT = [
  [0.192, -0.356], [0.119, -0.327], [0.077, -0.263], [0.055, -0.168],
  [0.045, -0.034], [0.044, 0.092], [0.057, 0.206], [0.087, 0.292],
  [0.134, 0.357], [0.170, 0.392], [0.198, 0.402],
] as const

export function pillowBody(shape: LocalShape, steps: number) {
  const positions: number[] = []
  const texcoords: number[] = []
  const indices: number[] = []
  const vertexNormals: number[] = []
  function vertex(x: number, y: number, z: number, normal: Vector3) {
    const projected = shear(x, y, z)
    positions.push(...projected)
    // A continuous projection keeps the nap crossing every cap triangle at the same scale.
    texcoords.push(projected[0] * 0.36 + 0.23, projected[1] * 0.36 + 0.31)
    vertexNormals.push(normal.x, normal.y, normal.z)
  }

  for (const loop of contours(shape)) {
    const border = spaceBorder(roundedPath(loop, steps))
    const normals = innerNormals(border)
    const first = positions.length / 3
    const count = border.length
    for (const [depth, [inset, z]] of LOFT.entries()) {
      const ring = border.map((point, i) => {
        const { x, y } = point
        const ripple = Math.sin(x * 6.8 + y * 4.1) * 0.014 + Math.cos(y * 7.4 - x * 6.4) * 0.008
        return point.clone().addScaledVector(normals[i], inset + ripple * Math.cos(z * 3.0))
      })
      const [beforeInset, beforeZ] = LOFT[Math.max(0, depth - 1)]
      const [afterInset, afterZ] = LOFT[Math.min(LOFT.length - 1, depth + 1)]
      const span = afterZ - beforeZ
      const rise = afterInset - beforeInset
      const normal = new Vector3()
      for (const [i, { x, y }] of ring.entries()) {
        const inner = normals[i]
        if (depth === 0) {
          normal.set(0, 0, -1)
        } else if (depth === LOFT.length - 1) {
          const slope = 0.157 * 2.9
          normal.set(-inner.x * slope, -inner.y * slope, 1 - slope * (PITCH_X * inner.x + PITCH_Y * inner.y)).normalize()
        } else {
          normal.set(-inner.x * span, -inner.y * span, rise - span * (PITCH_X * inner.x + PITCH_Y * inner.y)).normalize()
        }
        vertex(x, y, z, normal)
      }
      const offset = first + depth * count
      if (depth === 0) {
        for (const [a, b, c] of ShapeUtils.triangulateShape(ring, [])) indices.push(offset + a, offset + c, offset + b)
      } else {
        for (let i = 0; i < count; i += 1) {
          const from = offset + i
          const to = offset + ((i + 1) % count)
          indices.push(from - count, to - count, from, to - count, to, from)
        }
      }
      if (depth === LOFT.length - 1) {
        const cap = puffedCap(ring)
        for (const { point, lift, normal } of cap.interior) vertex(point.x, point.y, z + lift, normal)
        for (const [a, b, c] of cap.triangles) indices.push(offset + a, offset + b, offset + c)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(texcoords, 2))
  // Surface-derived normals stay smooth across cap triangles with very different areas.
  geometry.setAttribute('normal', new Float32BufferAttribute(vertexNormals, 3))
  geometry.setIndex(indices)
  return geometry
}

export function pillowShadow(shape: LocalShape) {
  const points: number[] = []
  const indices: number[] = []
  for (const loop of contours(shape)) {
    const path = roundedPath(loop, 4)
    const offset = points.length / 3
    for (const { x, y } of path) points.push(x, y, 0)
    for (const [a, b, c] of ShapeUtils.triangulateShape(path, [])) indices.push(offset + a, offset + b, offset + c)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  geometry.setIndex(indices)
  return geometry
}

export function applyCrownProfile(geometry: BufferGeometry, shape: LocalShape) {
  const vertices = geometry.getAttribute('position')
  const depths = new Float32Array(vertices.count)
  for (let i = 0; i < vertices.count; i += 1) {
    const z = vertices.getZ(i)
    const x = vertices.getX(i) + z * PITCH_X
    const y = vertices.getY(i) + z * PITCH_Y
    let nearest = Infinity
    let top = 0
    for (const [column, row] of shape) {
      const distance = Math.abs(x - column)
      if (distance === nearest) top = Math.min(top, row)
      if (distance < nearest) {
        nearest = distance
        top = row
      }
    }
    depths[i] = Math.max(0, 0.48 - top - y)
  }
  geometry.setAttribute('pillowCrownDepth', new Float32BufferAttribute(depths, 1))
  return geometry
}

export function sequence(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

export function pillowPile(body: BufferGeometry, layers: number) {
  const geometry = new BufferGeometry()
  const vertices = body.getAttribute('position').count
  const heights = new Float32Array(vertices * layers)
  for (const [name, attribute] of Object.entries(body.attributes)) {
    const values = new Float32Array(attribute.array.length * layers)
    for (let layer = 0; layer < layers; layer += 1) values.set(attribute.array, layer * attribute.array.length)
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize))
  }

  const faces = body.index!
  const indices = []
  for (let layer = 0; layer < layers; layer += 1) {
    const first = layer * vertices
    heights.fill((layer + 1) / layers, first, first + vertices)
    for (let index = 0; index < faces.count; index += 1) indices.push(first + faces.getX(index))
  }
  geometry.setAttribute('pileHeight', new Float32BufferAttribute(heights, 1))
  geometry.setIndex(indices)
  return geometry
}
