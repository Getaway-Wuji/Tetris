import {
  AmbientLight, BufferGeometry, CanvasTexture, Color, DirectionalLight, DynamicDrawUsage, Group,
  HemisphereLight, InstancedBufferAttribute, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, MeshBasicMaterial,
  MeshPhysicalMaterial, Object3D, RepeatWrapping, SRGBColorSpace,
} from 'three'
import { KINDS, PALETTE, type PieceKind } from './frame'
import { applyCrownProfile, pillowBody, pillowPile, pillowShadow, sequence, type LocalShape } from './pillowGeometry'

export type { LocalShape } from './pillowGeometry'

const SINGLE: LocalShape = [[0, 0]]
const COLOR = Object.fromEntries(KINDS.map(kind => [
  kind, new Color(PALETTE[kind]).offsetHSL(0, 0.14, -0.052),
]))

export const DETAIL = {
  low: { resolution: 256, pileLayers: 2, bevelSegments: 3, dpr: 1.5, particles: 0, shadow: false },
  medium: { resolution: 512, pileLayers: 3, bevelSegments: 5, dpr: 1.75, particles: 1, shadow: true },
  high: { resolution: 768, pileLayers: 4, bevelSegments: 7, dpr: 2, particles: 2, shadow: true },
} as const

export type DetailLevel = keyof typeof DETAIL

function noiseField(columns: number, rows: number, random: () => number) {
  const values = Array.from({ length: columns * rows }, () => random() * 2 - 1)
  const value = (x: number, y: number) => values[((y + rows) % rows) * columns + (x + columns) % columns]
  return (u: number, v: number) => {
    const x = (u - Math.floor(u)) * columns
    const y = (v - Math.floor(v)) * rows
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const dx = x - ix
    const dy = y - iy
    const sx = dx * dx * (3 - 2 * dx)
    const sy = dy * dy * (3 - 2 * dy)
    const up = value(ix, iy) * (1 - sx) + value(ix + 1, iy) * sx
    const down = value(ix, iy + 1) * (1 - sx) + value(ix + 1, iy + 1) * sx
    return up * (1 - sy) + down * sy
  }
}

function textureCanvas(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  return canvas.getContext('2d')!
}

function plushTextures(size: number) {
  const color = textureCanvas(size)
  const surface = textureCanvas(size)
  const random = sequence(824)
  const nap = color.createImageData(size, size)
  const relief = surface.createImageData(size, size)
  const lay = noiseField(7, 7, random)
  const sweep = noiseField(13, 11, random)
  const bundles = noiseField(31, 9, random)
  const strands = noiseField(98, 19, random)
  const fine = noiseField(172, 47, random)

  // The dye stays even. The finer pattern lives mainly in the height of the nap
  // so that the folds change the light without printing dark marks on the cloth.
  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const patch = lay(u, v)
      const follow = u + patch * 0.033 + sweep(u, v) * 0.010 + Math.sin((u * 4 + v * 5) * Math.PI * 2) * 0.008
      const depth = v + patch * 0.020
      const clump = bundles(follow, depth)
      const ridge = strands(follow, depth)
      const filament = fine(follow, depth)
      const tip = Math.max(0, 0.72 * ridge + 0.28 * filament)
      const value = Math.max(225, 239 + patch * 5 + clump * 6 + ridge * 7 + 13 * tip ** 2)
      const height = 128 + clump * 24 + ridge * 38 + filament * 9
      const index = (y * size + x) * 4
      nap.data[index] = value
      nap.data[index + 1] = value
      nap.data[index + 2] = value
      nap.data[index + 3] = 216 + patch * 5 + clump * 16 + ridge * 35 + filament * 8
      relief.data[index] = height
      relief.data[index + 1] = height
      relief.data[index + 2] = height
      relief.data[index + 3] = 255
    }
  }
  color.putImageData(nap, 0, 0)
  surface.putImageData(relief, 0, 0)
  return { dye: color.canvas, relief: surface.canvas }
}

type PillowLayer = {
  group: Group
  place: (index: number, kind: PieceKind, x: number, y: number, scaleX?: number, scaleY?: number, z?: number,
    shape?: LocalShape, rock?: number, deformation?: PillowDeformation) => void
  finalize: (count: number) => void
  dispose: () => void
}

export type PillowDeformation = {
  squeeze: number
  bend: number
  anchor: number
  anchorY?: number
  crown?: number
  bulge?: number
}

type Pose = PillowDeformation & { kind: PieceKind; x: number; y: number; z: number; width: number; height: number; rock: number }

const WARP_GLSL = /* glsl */ `
  attribute vec4 pillowImpact;
  attribute vec2 pillowShape;
  attribute float pillowCrownDepth;

  float crownCurve(vec3 p) {
    float dx = p.x - pillowImpact.z;
    return pillowShape.x * exp(-.85 * dx * dx - 6.5 * pillowCrownDepth * pillowCrownDepth);
  }

  vec3 stuffingSpread(vec3 p, vec2 offset) {
    float crossSection = offset.y * offset.y;
    float spread = (1. - exp(-3.4 * crossSection)) * exp(-.37 * crossSection);
    float width = offset.x * inversesqrt(1. + offset.x * offset.x);
    float fold = offset.x * offset.x / (.75 + offset.x * offset.x);
    return pillowShape.y * spread * vec3(.82 * width, -.33 * fold * sign(offset.y), .52 * clamp(p.z * 2.7, -1., 1.));
  }

  vec3 compressPillow(vec3 p) {
    if (pillowImpact.x == 0. && pillowImpact.y == 0. && all(equal(pillowShape, vec2(0.)))) return p;
    vec2 offset = p.xy - pillowImpact.zw;
    float pocket = exp(-dot(offset * offset, vec2(3.8, 3.1)));
    float lean = 1. - exp2(-1.7 * abs(offset.y));
    float press = pillowImpact.x * pocket;
    float curve = crownCurve(p);
    return p + vec3(pillowImpact.y * lean, press + curve, (press * .35 + curve * .18) * clamp(p.z * 3., -1., 1.))
      + stuffingSpread(p, offset);
  }

  vec3 compressPillowNormal(vec3 p, vec3 n) {
    if (pillowImpact.x == 0. && pillowImpact.y == 0. && all(equal(pillowShape, vec2(0.)))) return n;
    vec2 offset = p.xy - pillowImpact.zw;
    float press = pillowImpact.x * exp(-dot(offset * offset, vec2(3.8, 3.1)));
    vec2 slope = -2. * offset * vec2(3.8, 3.1) * press;
    float leanSlope = 1.18 * pillowImpact.y * exp2(-1.7 * abs(offset.y)) * sign(offset.y);
    float indentation = n.y + n.z * .35 * clamp(p.z * 3., -1., 1.);
    vec2 crownSlope = crownCurve(p) * vec2(-1.7 * offset.x, 13. * pillowCrownDepth);
    vec3 adjustment = vec3(slope * indentation + crownSlope * n.y + vec2(0., n.x * leanSlope), 0.);
    if (pillowShape.y != 0.) {
      float dx = offset.x;
      float dy = offset.y;
      float attenuation = exp(-.37 * dy * dy);
      float pin = exp(-3.4 * dy * dy);
      float band = pillowShape.y * attenuation * (1. - pin);
      float bandSlope = pillowShape.y * dy * attenuation * (7.54 * pin - .74);
      float width = inversesqrt(1. + dx * dx);
      float fold = dx * dx / (.75 + dx * dx);
      float foldSlope = 1.5 * dx / pow(.75 + dx * dx, 2.);
      adjustment += vec3(
        band * (.82 * n.x * width * width * width - .33 * n.y * foldSlope * sign(dy)),
        bandSlope * dot(n, vec3(.82 * dx * width, -.33 * fold * sign(dy), .52 * clamp(p.z * 2.7, -1., 1.))),
        abs(p.z) < 1. / 2.7 ? band * 1.404 * n.z : 0.
      );
    }
    return normalize(n - adjustment);
  }
`

const PILE_GLSL = /* glsl */ `
  attribute float pileHeight;
  varying float vPileHeight;

  vec3 groomPile(vec3 root, vec3 n) {
    float direction = sin(5.9 * root.x + 3.2 * root.y + sin(5.3 * root.y));
    float loft = .040 + .006 * sin(10.1 * root.x - 5.8 * root.y) + .009 * direction;
    vec3 fall = vec3(.36 * direction, -1., .08);
    vec3 tangent = fall - dot(fall, n) * n;
    return root + n * loft * pileHeight + tangent * .045 * pileHeight * pileHeight;
  }
`

function addImpactShader(material: MeshBasicMaterial | MeshPhysicalMaterial, pile = false) {
  material.onBeforeCompile = shader => {
    const position = pile
      ? 'vPileHeight = pileHeight;\ntransformed = groomPile(transformed, objectNormal);'
      : ''
    shader.vertexShader = WARP_GLSL + (pile ? PILE_GLSL : '') + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${position}\ntransformed = compressPillow(transformed);`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = compressPillowNormal(position, objectNormal);')
    if (material instanceof MeshPhysicalMaterial) {
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', /* glsl */ `
        #include <uv_vertex>
        #ifdef USE_INSTANCING_COLOR
          vec2 dyeOffset = vec2(instanceColor.r - instanceColor.b, instanceColor.g - instanceColor.r) * .36;
          vMapUv += dyeOffset;
          vBumpMapUv += dyeOffset;
        #endif
      `)
    }
    if (pile) {
      shader.fragmentShader = 'varying float vPileHeight;\n' + shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
        #include <map_fragment>
        float rootCoverage = texture2D(map, vMapUv).a;
        diffuseColor.a = clamp((rootCoverage - mix(.49, .84, vPileHeight)) * 6. + .42, 0., 1.);
        diffuseColor.rgb *= mix(.975, 1.02, vPileHeight);
      `)
    }
  }
  material.customProgramCacheKey = () => pile ? 'groomed-pile' : 'pillow-impact'
}

function supportHeight(shape: LocalShape, anchor: number) {
  let nearest = Infinity
  let lowest = 0
  for (const [x, y] of shape) {
    const distance = Math.abs(x - anchor)
    if (distance < nearest) {
      nearest = distance
      lowest = y
    } else if (distance === nearest) lowest = Math.max(lowest, y)
  }
  return -lowest - 0.48
}

function shapeKey(shape: LocalShape) {
  return shape.map(([x, y]) => `${x}:${y}`).sort().join(',')
}

export function createPillowResources(level: DetailLevel) {
  const detail = DETAIL[level]
  const texture = plushTextures(detail.resolution)
  const map = new CanvasTexture(texture.dye)
  map.colorSpace = SRGBColorSpace
  map.minFilter = LinearMipmapLinearFilter
  map.magFilter = LinearFilter
  map.anisotropy = 5
  map.wrapS = map.wrapT = RepeatWrapping
  const bump = new CanvasTexture(texture.relief)
  bump.wrapS = bump.wrapT = RepeatWrapping
  const bodyMaterial = new MeshPhysicalMaterial({
    map, bumpMap: bump, bumpScale: 0.0034, roughness: 0.83, specularIntensity: 0.31,
    anisotropy: 0.53, anisotropyRotation: Math.PI / 2,
    sheen: 0.85, sheenRoughness: 0.58, sheenColor: new Color('#f1e6ee'),
  })
  const pileMaterial = bodyMaterial.clone()
  pileMaterial.alphaTest = 0.42
  pileMaterial.bumpScale = 0.003
  const shadowMaterial = new MeshBasicMaterial({
    color: '#25263b', transparent: true, opacity: .29, depthWrite: false,
  })
  addImpactShader(bodyMaterial)
  addImpactShader(pileMaterial, true)
  addImpactShader(shadowMaterial)
  const geometries = new Map<string, ReturnType<typeof geometryFor>>()
  const shapeKeys = new WeakMap<LocalShape, string>()

  function geometryFor(shape: LocalShape) {
    const body = applyCrownProfile(pillowBody(shape, detail.bevelSegments), shape)
    return { body, shadow: applyCrownProfile(pillowShadow(shape), shape), pile: null as BufferGeometry | null }
  }

  function createLayer(capacity: number, withShadow = detail.shadow, withPile = true): PillowLayer {
    const group = new Group()
    const transform = new Object3D()
    const shadowTransform = new Object3D()
    const buckets = new Map<string, ReturnType<typeof createBucket>>()

    function meshOf(source: BufferGeometry, material: MeshBasicMaterial | MeshPhysicalMaterial) {
      // Share the shape buffers, with one independent deformation buffer per batch.
      const geometry = new BufferGeometry()
      for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute)
      geometry.setIndex(source.index)
      geometry.setAttribute('pillowImpact', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage))
      geometry.setAttribute('pillowShape', new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage))
      const mesh = new InstancedMesh(geometry, material, capacity)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      group.add(mesh)
      return mesh
    }

    function createBucket(key: string, shape: LocalShape) {
      const geometry = geometries.get(key) ?? geometryFor(shape)
      geometries.set(key, geometry)
      const body = meshOf(geometry.body, bodyMaterial)
      if (withPile && !geometry.pile) geometry.pile = pillowPile(geometry.body, detail.pileLayers)
      const pile = withPile && geometry.pile ? meshOf(geometry.pile, pileMaterial) : null
      const shadow = withShadow ? meshOf(geometry.shadow, shadowMaterial) : null
      const meshes = pile ? [body, pile] : [body]
      return { meshes, shadow, all: shadow ? [...meshes, shadow] : meshes, poses: [] as Pose[], count: 0 }
    }

    return {
      group,
      place(_index, kind, x, y, scaleX = 1, scaleY = scaleX, z = 0, shape = SINGLE, rock = 0, deformation) {
        if (!shape.length) return
        let key = shapeKeys.get(shape)
        if (key === undefined) {
          key = shapeKey(shape)
          shapeKeys.set(shape, key)
        }
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = createBucket(key, shape)
          buckets.set(key, bucket)
        }

        const slot = bucket.count++
        const last = bucket.poses[slot]
        const recolored = last?.kind !== kind
        const moved = !last || last.x !== x || last.y !== y || last.z !== z || last.width !== scaleX ||
          last.height !== scaleY || last.rock !== rock
        const squeeze = deformation?.squeeze ?? 0
        const bend = deformation?.bend ?? 0
        const crown = deformation?.crown ?? 0
        const bulge = deformation?.bulge ?? 0
        const anchor = squeeze || bend || crown || bulge ? (deformation?.anchor ?? 0) : 0
        const anchorY = squeeze || bend || bulge ? deformation?.anchorY : undefined
        const warped = (last?.squeeze ?? 0) !== squeeze || (last?.bend ?? 0) !== bend ||
          (last?.anchor ?? 0) !== anchor || last?.anchorY !== anchorY
        if (warped) {
          const ground = anchorY === undefined ? supportHeight(shape, anchor) : -anchorY
          for (const mesh of bucket.all) {
            const impact = mesh.geometry.getAttribute('pillowImpact') as InstancedBufferAttribute
            impact.setXYZW(slot, squeeze, bend, anchor, ground)
            impact.addUpdateRange(slot * 4, 4)
            impact.needsUpdate = true
          }
        }
        const reshaped = (last?.crown ?? 0) !== crown || (last?.bulge ?? 0) !== bulge
        if (reshaped) {
          for (const mesh of bucket.all) {
            const curve = mesh.geometry.getAttribute('pillowShape') as InstancedBufferAttribute
            curve.setXY(slot, crown, bulge)
            curve.addUpdateRange(slot * 2, 2)
            curve.needsUpdate = true
          }
        }
        if (recolored) {
          for (const mesh of bucket.meshes) {
            const firstColor = mesh.instanceColor === null
            mesh.setColorAt(slot, COLOR[kind])
            const color = mesh.instanceColor!
            if (firstColor) color.setUsage(DynamicDrawUsage)
            color.addUpdateRange(slot * 3, 3)
            color.needsUpdate = true
          }
        }
        if (moved) {
          transform.position.set(x, y, z)
          transform.rotation.z = rock
          transform.scale.set(scaleX, scaleY, (scaleX + scaleY) / 2)
          transform.updateMatrix()
          if (bucket.shadow) {
            shadowTransform.position.set(x + 0.025, y - 0.037, -0.545 + z)
            shadowTransform.rotation.z = rock
            shadowTransform.scale.set(scaleX, scaleY, 1)
            shadowTransform.updateMatrix()
          }
          for (const mesh of bucket.all) {
            mesh.setMatrixAt(slot, mesh === bucket.shadow ? shadowTransform.matrix : transform.matrix)
            mesh.instanceMatrix.addUpdateRange(slot * 16, 16)
            mesh.instanceMatrix.needsUpdate = true
          }
        }
        if (moved || recolored || warped || reshaped) bucket.poses[slot] = { kind, x, y, z, width: scaleX, height: scaleY, rock, squeeze, bend, anchor, anchorY, crown, bulge }
      },
      finalize() {
        for (const bucket of buckets.values()) {
          for (const mesh of bucket.all) mesh.count = bucket.count
          bucket.count = 0
        }
      },
      dispose() {
        for (const bucket of buckets.values()) {
          for (const mesh of bucket.all) {
            mesh.dispose()
            mesh.geometry.dispose()
          }
        }
        group.clear()
        buckets.clear()
      },
    }
  }

  return {
    createLayer,
    dispose() {
      for (const resource of [map, bump, bodyMaterial, pileMaterial, shadowMaterial]) resource.dispose()
      for (const { body, pile, shadow } of geometries.values()) {
        body.dispose()
        pile?.dispose()
        shadow.dispose()
      }
      geometries.clear()
    },
  }
}

export function pillowLights() {
  const group = new Group()
  const ambient = new AmbientLight('#fff7f9', 0.53)
  const surroundings = new HemisphereLight('#fff7ee', '#c7bad5', 0.94)
  const key = new DirectionalLight('#fff3e8', 2.69)
  const fill = new DirectionalLight('#e6eeff', 0.83)
  const edge = new DirectionalLight('#ffeaf7', 0.81)
  key.position.set(5.2, 7.1, 4.5)
  fill.position.set(-4, -2.4, 3.8)
  edge.position.set(-5, 5.7, -1.0)
  group.add(ambient, surroundings, key, fill, edge)
  return group
}
