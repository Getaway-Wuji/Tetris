import type { GravitySample } from './gravity'

export type PieceKind = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type Quality = 'auto' | 'high' | 'medium' | 'low'
export type Cell = { x: number; y: number; kind: PieceKind; group?: number }
export type PieceShape = readonly (readonly [number, number])[]
export type PlushPiece = { x: number; y: number; kind: PieceKind; group?: number; width: number; height: number; shape: PieceShape }

export type LockFeedback = { cells: readonly Cell[]; group?: number; drop: number }
export type BoardFeedback =
  | ({ id: string | number; type: 'lock' } & LockFeedback)
  | { id: string | number; type: 'clear'; cells: readonly Cell[]; rows: readonly number[]; lock?: LockFeedback }

export type RenderFrame = {
  locked: readonly Cell[]
  active: readonly Cell[]
  rotation?: number
  gravity?: GravitySample
  holdId?: string | number
  ghost: readonly Cell[]
  event?: BoardFeedback
}

type GridPoint = readonly [number, number]
type Snapshot = {
  board: readonly (readonly number[])[]
  groups?: readonly (readonly number[])[]
  active: { kind: number; rotation?: number; cells: readonly GridPoint[] } | null
  ghost: readonly GridPoint[]
  acceleratedFall?: boolean
  gravityAcceleration?: number
  gravityIntervalMs?: number
  gravityElapsedMs?: number
  gravityRows?: number
  events?: readonly RenderEvent[]
}

type RenderEvent =
  | { type: 'lock'; cells: readonly GridPoint[]; kind: number; group?: number; drop: number }
  | { type: 'clear'; rows: readonly number[]; cells: readonly (readonly [number, number, number])[]; groups?: readonly number[] }
  | { type: 'hold' | 'level' }

export const BOARD_COLUMNS = 10
export const BOARD_ROWS = 20
const HIDDEN_ROWS = 4

export const PALETTE: Record<PieceKind, string> = {
  1: '#a9dcef', 2: '#f8e3a0', 3: '#c8b6e8', 4: '#bde4cb',
  5: '#f2b6c5', 6: '#aebfe8', 7: '#f5c7a9',
}

export const KINDS = [1, 2, 3, 4, 5, 6, 7] as const

export function isPieceKind(kind: unknown): kind is PieceKind {
  return typeof kind === 'number' && Number.isInteger(kind) && kind >= 1 && kind <= 7
}

function cellAt([x, row]: GridPoint, kind: number, group?: number, includeHidden = false): Cell[] {
  const y = row - HIDDEN_ROWS
  return isPieceKind(kind) && (includeHidden || y >= 0) && y < BOARD_ROWS ? [{ x, y, kind, group }] : []
}

export function frameFromSnapshot(
  snapshot: Snapshot | null | undefined,
  eventId: string | number = 0,
  events = snapshot?.events ?? [],
  sampledAt: number | null = null,
): RenderFrame | null {
  if (!snapshot) return null
  const clear = events.find(event => event.type === 'clear')
  const lock = events.find(event => event.type === 'lock')
  const activeKind = snapshot.active?.kind ?? 0
  const activeRow = snapshot.active?.cells[0]?.[1]
  const landingRow = snapshot.ghost[0]?.[1]
  const canFall = activeRow !== undefined && landingRow !== undefined && activeRow < landingRow
  const curve = snapshot.acceleratedFall
    ? snapshot.gravityAcceleration && { acceleration: snapshot.gravityAcceleration }
    : snapshot.gravityIntervalMs && { intervalMs: snapshot.gravityIntervalMs }
  const gravity = canFall && curve && snapshot.gravityElapsedMs !== undefined && snapshot.gravityRows !== undefined
    ? { ...curve, elapsedMs: snapshot.gravityElapsedMs, advancedRows: snapshot.gravityRows,
      sampledAt, rows: landingRow - activeRow }
    : undefined
  const landing = lock && { group: lock.group, drop: lock.drop, cells: lock.cells.flatMap(point => cellAt(point, lock.kind, lock.group, true)) }

  return {
    locked: snapshot.board.flatMap((row, y) => row.flatMap((kind, x) => cellAt([x, y], kind, snapshot.groups?.[y]?.[x]))),
    active: snapshot.active?.cells.flatMap(point => cellAt(point, activeKind, undefined, true)) ?? [],
    rotation: snapshot.active?.rotation,
    gravity,
    holdId: events.some(event => event.type === 'hold') ? eventId : undefined,
    ghost: snapshot.ghost.flatMap(point => cellAt(point, activeKind)),
    event: clear
      ? { id: eventId, type: 'clear', rows: clear.rows.map(row => row - HIDDEN_ROWS),
        cells: clear.cells.flatMap(([x, y, kind], index) => cellAt([x, y], kind, clear.groups?.[index])), lock: landing }
      : landing && { id: eventId, type: 'lock', ...landing },
  }
}

function describePiece(cells: Cell[]): PlushPiece {
  const x = Math.min(...cells.map(cell => cell.x))
  const y = Math.min(...cells.map(cell => cell.y))
  const shape = cells.map(cell => [cell.x - x, cell.y - y] as const)
    .sort(([ax, ay], [bx, by]) => ay - by || ax - bx)
  return {
    x, y, kind: cells[0].kind, group: cells[0].group, shape,
    width: Math.max(...shape.map(([dx]) => dx)) + 1, height: Math.max(...shape.map(([, dy]) => dy)) + 1,
  }
}

export function collectPieces(cells: readonly Cell[], connected = false): PlushPiece[] {
  if (connected) return cells.length ? [describePiece([...cells])] : []
  const groups = new Map<number, Cell[]>()
  const pieces: PlushPiece[] = []
  for (const cell of cells) {
    if (!cell.group) {
      pieces.push(describePiece([cell]))
      continue
    }
    const siblings = groups.get(cell.group)
    if (siblings) siblings.push(cell)
    else groups.set(cell.group, [cell])
  }
  for (const siblings of groups.values()) {
    // Removing a row can leave disconnected sections of one original piece.
    const remaining = new Set(siblings)
    while (remaining.size) {
      const first = remaining.values().next().value!
      const joined = [first]
      remaining.delete(first)
      for (const cell of joined) {
        for (const neighbor of remaining) {
          if (Math.abs(cell.x - neighbor.x) + Math.abs(cell.y - neighbor.y) !== 1) continue
          joined.push(neighbor)
          remaining.delete(neighbor)
        }
      }
      pieces.push(describePiece(joined))
    }
  }
  return pieces
}

export function rowBeforeClear(after: number, cleared: readonly number[]) {
  let row = after
  for (const deleted of [...cleared].sort((a, b) => b - a)) if (deleted >= row) row -= 1
  return row
}

// The start screen arranges full shapes to show their fabric and silhouettes.
const idlePieces: [PieceKind, PieceShape][] = [
  [1, [[0, 16], [0, 17], [0, 18], [0, 19]]],
  [7, [[1, 17], [1, 18], [1, 19], [2, 19]]],
  [4, [[4, 18], [5, 18], [3, 19], [4, 19]]],
  [6, [[7, 18], [5, 19], [6, 19], [7, 19]]],
  [2, [[8, 18], [9, 18], [8, 19], [9, 19]]],
  [5, [[3, 16], [4, 16], [4, 17], [5, 17]]],
]

export const IDLE_FRAME: RenderFrame = {
  locked: idlePieces.flatMap(([kind, cells], index) => cells.map(([x, y]) => ({ x, y, kind, group: index + 1 }))),
  active: [[4, 2], [3, 3], [4, 3], [5, 3]].map(([x, y]) => ({ x, y, kind: 3 })),
  ghost: [],
}
