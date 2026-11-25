import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { OrthographicCamera } from 'three'
import { BOARD_COLUMNS, BOARD_ROWS, IDLE_FRAME, PALETTE, collectPieces, rowBeforeClear,
  type BoardFeedback, type Cell, type LockFeedback, type PlushPiece, type Quality, type RenderFrame } from './frame'
import { createPillowResources, DETAIL, pillowLights, type DetailLevel, type PillowDeformation } from './pillow'
import { CLEAR_CONTACT_MS, LANDING_SETTLE_MS, STACK_PRESS_MS, SUPPORT_SETTLE_MS, dropImpact, fallingLift, flightDuration, landingImpact, landingPose,
  supportMotion, type LandingImpact, type LandingPose } from './landing'
import { gravityContactSpeed, gravityContactTime, gravityOffset, type GravitySample } from './gravity'
import { resolveImpact, type ImpactContact, type SupportReaction } from './impact'
import { spriteStyle, tryPieceSprite } from './PiecePreview'
import './render.css'

const CAPACITY = BOARD_COLUMNS * BOARD_ROWS + 4
const CLEAR_MS = 218
const SLIDE_MS = 68
const SOFT_DROP_MS = 40
const SUPPORT_COMPRESSION = 0.022
const SUPPORT_INDENT = 0.096
const SUPPORT_BULGE = 0.095

function worldX(x: number) { return x + 0.5 - BOARD_COLUMNS / 2 }
function worldY(y: number) { return BOARD_ROWS / 2 - y - 0.5 }
function cellKey(cell: Cell) { return `${cell.x}:${cell.y}` }

type Animation = {
  gameId: string | null
  active: PlushPiece | undefined
  rotation: number | undefined
  gravity?: GravitySample
  holdId?: RenderFrame['holdId']
  locked: PlushPiece[]
  lockedCells: readonly Cell[]
  landings: Map<number, Landing>
  reactions: Map<number, Reaction[]>
  clear: Clear | null
  slide: Slide | null
  groundContact: Landing | null
}

type Landing = { rows: number; start: number; contact: ImpactContact | null; impact: LandingImpact }
type Reaction = SupportReaction & { start: number }
type Slide = { dx: number; dy: number; angle: number; start: number; duration: number }
type Clear = { before: PlushPiece[]; removed: PlushPiece[]; cells: readonly Cell[]; rows: readonly number[]; start: number }

function clearEffect(frame: RenderFrame, event: Extract<BoardFeedback, { type: 'clear' }>, start: number): Clear {
  const before = frame.locked.map(cell => ({ ...cell, y: rowBeforeClear(cell.y, event.rows) }))
  return {
    before: collectPieces([...before, ...event.cells]), removed: collectPieces(event.cells), cells: event.cells,
    rows: event.rows, start,
  }
}

function centerX(piece: PlushPiece) { return piece.x + (piece.width - 1) / 2 }
function centerY(piece: PlushPiece) { return piece.y + (piece.height - 1) / 2 }
function pieceBase(piece: PlushPiece) { return piece.y + piece.height - 0.5 }

function coversContact(piece: PlushPiece, contact: SupportReaction) {
  return Math.abs(contact.x - centerX(piece)) <= piece.width / 2 && Math.abs(contact.y - centerY(piece)) <= piece.height / 2
}

function slideRest(slide: Slide | null, now: number) {
  if (!slide) return 0
  const rest = Math.max(0, 1 - (now - slide.start) / slide.duration)
  return slide.duration === SOFT_DROP_MS ? rest : rest * rest
}

function slideFrom(current: Animation, active: PlushPiece | undefined, frame: RenderFrame, now: number): Slide | null {
  const from = current.active
  if (!from || !active || from.kind !== active.kind) return null
  const columnChange = centerX(from) - centerX(active)
  const rowChange = centerY(active) - centerY(from)
  const turn = ((frame.rotation ?? 0) - (current.rotation ?? 0) + 4) % 4
  if (Math.abs(columnChange) > 2 || Math.abs(rowChange) > 2 || turn === 2) return null
  if (turn === 0 && columnChange === 0 && rowChange === 0) return current.slide

  const rest = slideRest(current.slide, now)
  const dx = columnChange + (current.slide?.dx ?? 0) * rest
  const dy = rowChange + gravityOffset(frame.gravity, now) - gravityOffset(current.gravity, now) + (current.slide?.dy ?? 0) * rest
  const angle = (turn === 0 ? 0 : turn === 1 ? Math.PI / 2 : -Math.PI / 2) + (current.slide?.angle ?? 0) * rest
  // Gravity already carried the cushion to the row boundary. Discrete input may
  // still need a transition, starting from wherever the player last saw it.
  if (dx === 0 && angle === 0 && Math.abs(dy) < 0.12) return null
  const duration = columnChange === 0 && turn === 0 && rowChange > 0 ? SOFT_DROP_MS : SLIDE_MS
  return { dx, dy, angle, start: now, duration }
}

function displayedDrop(lock: LockFeedback, current: Animation, now: number) {
  if (!current.active || lock.cells[0]?.kind !== current.active.kind) return lock.drop
  const rows = lock.cells.map(cell => cell.y)
  const landingCenter = (Math.min(...rows) + Math.max(...rows)) / 2
  const slide = (current.slide?.dy ?? 0) * slideRest(current.slide, now)
  const activeCenter = centerY(current.active) + gravityOffset(current.gravity, now) - slide
  const distance = landingCenter - activeCenter
  return Math.abs(distance - lock.drop) <= 2 ? Math.max(0, distance) : lock.drop
}

function makeLanding(cells: readonly Cell[], locked: readonly Cell[], rows: number, start: number, speed?: number): Landing {
  const contact = resolveImpact(cells, locked)
  const onStack = Boolean(contact && !contact.floor)
  const impact = speed === undefined ? dropImpact(rows, onStack, contact?.offset) : landingImpact(speed, onStack, contact?.offset)
  return { rows, start, contact, impact }
}

function spreadImpact(reactions: Map<number, Reaction[]>, landing: Landing) {
  for (const support of landing.contact?.supports ?? []) {
    const reaction = {
      ...support, strength: support.strength * landing.impact.strength,
      start: landing.start + flightDuration(landing.rows) + support.delayMs,
    }
    const existing = reactions.get(reaction.group)
    if (existing) existing.push(reaction)
    else reactions.set(reaction.group, [reaction])
  }
}

function waitForSupports(landing: Landing, pending: ReadonlyMap<number, Landing>) {
  const duration = flightDuration(landing.rows)
  for (const support of landing.contact?.supports ?? []) {
    const base = pending.get(support.group)
    if (support.delayMs === 0 && base) {
      const baseTouch = base.start + flightDuration(base.rows)
      landing.start = Math.max(landing.start, baseTouch + STACK_PRESS_MS - duration)
    }
  }
}

function supportDeflection(landing: Landing, pieces: readonly PlushPiece[], now: number) {
  if (!landing.impact.onStack) return 0
  const age = now - landing.start - flightDuration(landing.rows)
  if (age <= 0 || age >= SUPPORT_SETTLE_MS) return 0
  let deflection = 0
  for (const contact of landing.contact?.supports ?? []) {
    if (contact.delayMs !== 0) continue
    const support = pieces.find(piece => piece.group === contact.group && coversContact(piece, contact))
    if (!support) continue
    const press = supportMotion(age, contact.strength * landing.impact.strength)
    const scaleY = 1 - SUPPORT_COMPRESSION * press
    const compression = (1 - scaleY) * (pieceBase(support) - contact.y) + SUPPORT_INDENT * press * scaleY
    deflection += compression * contact.strength
  }
  return deflection
}

type PieceLayer = ReturnType<ReturnType<typeof createPillowResources>['createLayer']>
type Pivot = { x: number; y: number }

function drawPiece(layer: PieceLayer, index: number, piece: PlushPiece, x: number, y: number,
  width: number, height: number, z: number, rock: number, pivot?: Pivot, deformation?: PillowDeformation) {
  const px = pivot ? pivot.x - piece.x : (piece.width - 1) / 2
  const py = pivot ? pivot.y - piece.y : (piece.height - 1) / 2
  const sin = Math.sin(rock)
  const cos = Math.cos(rock)
  const dx = px - px * width * cos - py * height * sin
  const dy = -py - px * width * sin + py * height * cos
  layer.place(index, piece.kind, worldX(piece.x) + x + dx, worldY(piece.y) + y + dy, width, height, z, piece.shape, rock, deformation)
}

function drawLanding(layer: PieceLayer, index: number, piece: PlushPiece, landing: Landing, pose: LandingPose,
  x = 0, y = 0, angle = 0, z = 0.05) {
  const pivot = landing.contact ?? { x: centerX(piece), y: pieceBase(piece) }
  // Cancel the local underside warp at the bearing point. The rest of the shape is free to flex.
  const pinned = landing.impact.onStack ? pose.scaleY * pose.squeeze : 0
  drawPiece(layer, index, piece, x, y + pose.lift - pinned, pose.scaleX, pose.scaleY, z, angle + pose.rock, pivot, {
    squeeze: pose.squeeze, bulge: pose.bulge, crown: pose.crown, bend: pose.bend,
    anchor: pivot.x - piece.x, anchorY: pivot.y - piece.y,
  })
}

function drawSupport(layer: PieceLayer, index: number, piece: PlushPiece, reactions: readonly Reaction[], now: number) {
  let press = 0
  let contact: Reaction | undefined
  for (const reaction of reactions) {
    if (!coversContact(piece, reaction)) continue
    const force = supportMotion(now - reaction.start, reaction.strength)
    if (Math.abs(force) <= Math.abs(press)) continue
    press = force
    contact = reaction
  }
  if (!contact) return false
  const rock = -0.032 * press * (contact.x - centerX(piece)) / piece.width
  const base = { x: centerX(piece), y: pieceBase(piece) }
  drawPiece(layer, index, piece, 0, 0, 1 + 0.018 * press, 1 - SUPPORT_COMPRESSION * press, 0, rock, base, {
    anchor: contact.x - piece.x, anchorY: contact.y - piece.y,
    squeeze: -SUPPORT_INDENT * press, bulge: SUPPORT_BULGE * press, bend: 0,
  })
  return true
}

type SceneProps = { frame: RenderFrame; gameId: string | null; level: DetailLevel; reducedMotion: boolean; onContextLost: () => void }

function PillowScene({ frame, gameId, level, reducedMotion, onContextLost }: SceneProps) {
  const { gl, invalidate, camera, size } = useThree()
  const assets = useMemo(() => {
    const resources = createPillowResources(level)
    return {
      main: resources.createLayer(CAPACITY),
      clearing: resources.createLayer(40, false),
      dust: resources.createLayer(80, false, false),
      resources,
    }
  }, [level])
  const lights = useMemo(pillowLights, [])
  const animation = useRef<Animation>({ gameId, active: undefined, rotation: undefined, locked: [],
    lockedCells: [], landings: new Map(), reactions: new Map(), clear: null, slide: null, groundContact: null })
  const seenEvent = useRef<BoardFeedback['id']>(undefined)

  useEffect(() => () => {
    assets.main.dispose()
    assets.clearing.dispose()
    assets.dust.dispose()
    assets.resources.dispose()
  }, [assets])

  useEffect(() => {
    const canvas = gl.domElement
    canvas.addEventListener('webglcontextlost', onContextLost)
    return () => canvas.removeEventListener('webglcontextlost', onContextLost)
  }, [gl, onContextLost])

  useLayoutEffect(() => {
    if (camera instanceof OrthographicCamera) {
      camera.zoom = size.width / BOARD_COLUMNS
      camera.updateProjectionMatrix()
    }
    invalidate()
  }, [camera, size.width, size.height, invalidate])

  useLayoutEffect(() => {
    const current = animation.current
    const now = performance.now()
    const event = frame.event?.id !== seenEvent.current ? frame.event : undefined
    const newGame = gameId !== current.gameId
    const swapped = frame.holdId !== undefined && frame.holdId !== current.holdId
    const active = collectPieces(frame.active, true)[0]
    if (event) seenEvent.current = event.id
    if (newGame || reducedMotion || frame === IDLE_FRAME) {
      current.landings.clear()
      current.reactions.clear()
      current.clear = null
      current.slide = null
      current.groundContact = null
    } else if (event) {
      const lock = event.type === 'lock' ? event : event.lock
      const alreadyGrounded = lock?.drop === 0 ? current.groundContact : null
      const landing = lock && (alreadyGrounded ?? makeLanding(lock.cells, current.lockedCells, displayedDrop(lock, current, now), now))
      if (landing && lock?.group && !landingPose(now - landing.start, landing.rows, landing.impact).done) {
        if (landing.rows > 0) waitForSupports(landing, current.landings)
        current.landings.set(lock.group, landing)
        if (!alreadyGrounded) spreadImpact(current.reactions, landing)
      }
      const contactAt = landing ? landing.start + flightDuration(landing.rows) : now
      current.clear = event.type === 'clear' ? clearEffect(frame, event, Math.max(now, contactAt + CLEAR_CONTACT_MS)) : null
      current.slide = null
      current.groundContact = null
    } else if (swapped || frame.gravity?.sampledAt === null) {
      current.slide = null
      current.groundContact = null
    } else {
      current.slide = slideFrom(current, active, frame, now)
      if (frame.gravity || active?.x !== current.active?.x || frame.rotation !== current.rotation) current.groundContact = null
      else if (current.gravity && active && current.active && active.kind === current.active.kind &&
          active.x === current.active.x && active.y > current.active.y && frame.rotation === current.rotation) {
        const predicted = gravityContactTime(current.gravity)
        const natural = predicted !== null && predicted <= now
        const start = natural ? predicted : now + SOFT_DROP_MS
        const speed = natural ? gravityContactSpeed(current.gravity) : 1 / SOFT_DROP_MS
        current.groundContact = makeLanding(frame.active, current.lockedCells, 0, start, speed)
        spreadImpact(current.reactions, current.groundContact)
      }
    }
    current.gameId = gameId
    current.active = active
    current.rotation = frame.rotation
    current.gravity = frame.gravity
    current.holdId = frame.holdId
    current.lockedCells = frame.locked
    current.locked = collectPieces(frame.locked)
    invalidate()
  }, [frame, gameId, invalidate, reducedMotion])

  useFrame(() => {
    const state = animation.current
    const { active, locked, clear, gravity, groundContact, landings, reactions, slide } = state
    const now = performance.now()
    const clearAge = clear ? now - clear.start : CLEAR_MS
    const rest = slideRest(slide, now)
    const clearTime = Math.min(1, Math.max(0, clearAge / CLEAR_MS))
    let mainCount = 0
    let clearCount = 0
    let dustCount = 0

    for (const [group, landing] of landings) {
      if (now - landing.start >= flightDuration(landing.rows) + LANDING_SETTLE_MS) landings.delete(group)
    }
    for (const [group, pending] of reactions) {
      const live = pending.filter(reaction => now - reaction.start < SUPPORT_SETTLE_MS)
      if (live.length === 0) reactions.delete(group)
      else if (live.length < pending.length) reactions.set(group, live)
    }
    const stack = clear && clearAge < 0 ? clear.before : locked
    for (const piece of stack) {
      const landing = piece.group ? landings.get(piece.group) : undefined
      const settling = clear && clearAge >= 0 && clearTime < 1
      const descent = settling ? fallingLift(piece.y - rowBeforeClear(piece.y, clear.rows), clearAge) : 0
      const support = piece.group ? reactions.get(piece.group) : undefined
      const inFlight = landing && now < landing.start + flightDuration(landing.rows)
      if (support && !settling && !inFlight && drawSupport(assets.main, mainCount, piece, support, now)) {
        mainCount += 1
      } else if (landing && !settling) {
        const pose = landingPose(now - landing.start, landing.rows, landing.impact)
        drawLanding(assets.main, mainCount++, piece, landing, pose, 0, -supportDeflection(landing, stack, now))
      } else {
        drawPiece(assets.main, mainCount++, piece, 0, descent, 1, 1, 0, 0)
      }
    }
    const activeFall = gravityOffset(gravity, now)
    const contact = groundContact && landingPose(now - groundContact.start, 0, groundContact.impact)
    if (active) {
      const dx = (slide?.dx ?? 0) * rest
      const dy = (slide?.dy ?? 0) * rest - activeFall
      const angle = (slide?.angle ?? 0) * rest
      if (groundContact && contact && !contact.done) {
        drawLanding(assets.main, mainCount++, active, groundContact, contact, dx, dy - supportDeflection(groundContact, stack, now), angle, 0.12)
      } else {
        drawPiece(assets.main, mainCount++, active, dx, dy, 1, 1, 0.12, angle)
      }
    }

    if (clear && clearAge >= 0 && clearAge < CLEAR_MS) {
      const time = clearTime
      for (const piece of clear.removed) {
        drawPiece(assets.clearing, clearCount++, piece, 0, 0.21 * time, (1 - time) ** 1.4, (1 - time) ** 2.2, 0.5, 0)
      }
      const particles = DETAIL[level].particles
      for (const [index, cell] of clear.cells.entries()) {
        const x = worldX(cell.x)
        const y = worldY(cell.y)
        for (let particle = 0; particle < particles; particle += 1) {
          const direction = (index + particle) % 2 ? 1 : -1
          const drift = 0.21 + (index % 5) * 0.093
          const lift = 0.31 + (index % 4) * 0.145
          const scale = (0.047 + (index % 3) * 0.013) * (1 - time)
          assets.dust.place(dustCount, cell.kind, x + direction * (0.19 + drift * time), y + lift * time, scale, scale, 0.67)
          dustCount += 1
        }
      }
    }

    assets.main.finalize(mainCount)
    assets.clearing.finalize(clearCount)
    assets.dust.finalize(dustCount)
    if (clearAge >= CLEAR_MS) state.clear = null
    if (rest === 0) state.slide = null
    const falling = gravity && gravity.sampledAt !== null && activeFall < gravity.rows
    if (falling || (contact && !contact.done) || rest > 0 || landings.size > 0 || reactions.size > 0 || clearAge < CLEAR_MS) invalidate()
  })

  return <>
    <primitive object={lights} />
    <primitive object={assets.main.group} />
    <primitive object={assets.clearing.group} />
    <primitive object={assets.dust.group} />
  </>
}

class CanvasBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

type SpritePieceProps = {
  piece: PlushPiece
  lock?: Extract<BoardFeedback, { type: 'lock' }>
  gravity?: GravitySample
}

function SpritePiece({ piece, lock, gravity }: SpritePieceProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const sprite = tryPieceSprite(piece.kind, piece.shape)
  const eventId = lock?.id
  const drop = lock?.drop ?? 0
  const { width, height } = piece

  useLayoutEffect(() => {
    const sprite = ref.current
    if (!sprite || !gravity) {
      if (sprite) sprite.style.translate = ''
      return
    }
    let raf = 0
    const step = (now: number) => {
      const offset = gravityOffset(gravity, now)
      sprite.style.translate = `0 ${offset * 100 / height}%`
      if (gravity.sampledAt !== null && offset < gravity.rows) raf = requestAnimationFrame(step)
    }
    step(performance.now())
    return () => cancelAnimationFrame(raf)
  }, [gravity, height])

  useLayoutEffect(() => {
    if (eventId === undefined || drop <= 0 || !ref.current?.animate) return
    const duration = flightDuration(drop) + LANDING_SETTLE_MS
    const keyframes = Array.from({ length: 40 }, (_, frame) => {
      const pose = landingPose(duration * frame / 39, drop)
      return { transform: `translateY(${-pose.lift * 100 / height}%) scale(${pose.scaleX}, ${pose.scaleY})` }
    })
    const animation = ref.current.animate(keyframes, duration)
    return () => animation.cancel()
  }, [eventId, drop, height])

  return <span ref={ref} className="plush-sprite-piece" style={{ left: `${piece.x * 10}%`, top: `${piece.y * 5}%`, width: `${width * 10}%`, height: `${height * 5}%` }}>
    {sprite ? <span className="plush-cube-sprite" style={{ ...sprite.style,
      left: '50%', top: '50%', width: `${400 / width}%`, height: `${200 / height}%`,
      transform: `translate(-50%, -50%) rotate(${sprite.angle}deg)`,
    }} /> : piece.shape.map(([x, y]) => <span key={`${x}:${y}`} className="plush-cube-sprite" style={{ ...spriteStyle(piece.kind),
      left: `${x * 100 / width}%`, top: `${y * 100 / height}%`, width: `${100 / width}%`, height: `${100 / height}%`,
    }} />)}
  </span>
}

function SpriteBoard({ frame, reducedMotion }: { frame: RenderFrame; reducedMotion: boolean }) {
  const locked = collectPieces(frame.locked)
  const active = collectPieces(frame.active, true)[0]
  const lock = !reducedMotion && frame.event?.type === 'lock' ? frame.event : undefined
  return <div className="plush-board__grid plush-board__sprites" data-renderer="sprites" aria-hidden="true">
    {locked.map(piece => <SpritePiece key={`${piece.group}:${piece.x}:${piece.y}`} piece={piece}
      lock={lock?.group === piece.group ? lock : undefined} />)}
    {active && <SpritePiece key="active" piece={active} gravity={frame.gravity} />}
  </div>
}

function automaticDetail(): DetailLevel {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (navigator.hardwareConcurrency <= 4 || (memory && memory <= 4)) return 'low'
  return window.matchMedia('(pointer: coarse)').matches ? 'low' : 'medium'
}

type BoardProps = {
  frame?: RenderFrame | null
  gameId?: string | null
  quality?: Quality
  reducedMotion?: boolean
  ghost?: boolean
  className?: string
}

export function PlushBoard({ frame, gameId = null, quality = 'auto', reducedMotion = false, ghost = true, className }: BoardProps) {
  const [lost, setLost] = useState(false)
  const [auto] = useState(automaticDetail)
  const onContextLost = useCallback(() => setLost(true), [])
  const current = frame ?? IDLE_FRAME
  const level = quality === 'auto' ? auto : quality
  const fallback = <SpriteBoard frame={current} reducedMotion={reducedMotion} />
  const active = ghost ? new Set(current.active.map(cellKey)) : null

  return <div className={`plush-board${className ? ` ${className}` : ''}`} data-quality={level} aria-hidden="true">
    {ghost && <div className="plush-board__grid plush-board__ghost">
      {current.ghost.filter(cell => !active?.has(cellKey(cell))).map(cell => <span key={cellKey(cell)} style={{
        '--ghost-color': PALETTE[cell.kind], gridColumn: cell.x + 1, gridRow: cell.y + 1,
      } as CSSProperties} />)}
    </div>}
    {lost ? fallback : <CanvasBoundary fallback={fallback}>
      <Canvas className="plush-board__canvas" data-renderer="webgl" fallback={fallback} orthographic flat frameloop="demand"
        camera={{ position: [0, 0, 30], near: 0.1, far: 60 }} dpr={[1, DETAIL[level].dpr]}
        gl={{ alpha: true, antialias: true, powerPreference: level === 'low' ? 'low-power' : 'high-performance' }}>
        <PillowScene frame={current} gameId={gameId} reducedMotion={reducedMotion} level={level} onContextLost={onContextLost} />
      </Canvas>
    </CanvasBoundary>}
  </div>
}
