import type { CSSProperties } from 'react'
import { isPieceKind, type PieceKind } from './frame'
import type { LocalShape } from './pillowGeometry'
import cubeAtlas from './plush-cubes.webp'
import pieceAtlas from './plush-pieces.webp'

export const PIECE_LABELS: Record<PieceKind, string> = { 1: 'I', 2: 'O', 3: 'T', 4: 'S', 5: 'Z', 6: 'J', 7: 'L' }

const SPRITE_SHAPES: Record<PieceKind, LocalShape> = {
  1: [[0, 0], [1, 0], [2, 0], [3, 0]],
  2: [[0, 0], [1, 0], [0, 1], [1, 1]],
  3: [[1, 0], [0, 1], [1, 1], [2, 1]],
  4: [[1, 0], [2, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [1, 1], [2, 1]],
  6: [[0, 0], [0, 1], [1, 1], [2, 1]],
  7: [[2, 0], [0, 1], [1, 1], [2, 1]],
}

const framePosition = (kind: PieceKind) => `${(kind - 1) * (100 / 6)}% center`
const pieceSpriteStyle = (kind: PieceKind): CSSProperties => ({ backgroundImage: `url(${pieceAtlas})`, backgroundPosition: framePosition(kind) })

function shapeSignature(shape: LocalShape) {
  const left = Math.min(...shape.map(([x]) => x))
  const top = Math.min(...shape.map(([, y]) => y))
  return shape.map(([x, y]) => `${x - left}:${y - top}`).sort().join(';')
}

export function tryPieceSprite(kind: PieceKind, shape: LocalShape) {
  if (shape.length !== 4) return null
  const target = shapeSignature(shape)
  let sprite = SPRITE_SHAPES[kind]
  for (const angle of [0, 90, 180, 270]) {
    if (shapeSignature(sprite) === target) return { style: pieceSpriteStyle(kind), angle }
    sprite = sprite.map(([x, y]) => [-y, x] as const)
  }
  return null
}

export function spriteStyle(kind: PieceKind): CSSProperties {
  return { backgroundImage: `url(${cubeAtlas})`, backgroundPosition: framePosition(kind) }
}

type PreviewProps = { kind?: number | null; className?: string }

export function PiecePreview({ kind, className }: PreviewProps) {
  const name = `plush-preview${className ? ` ${className}` : ''}`
  if (!isPieceKind(kind)) return <span className={name} aria-hidden="true" />

  return (
    <span className={name} role="img" aria-label={`${PIECE_LABELS[kind]} 形方块`}>
      <span className="plush-preview__shape" style={pieceSpriteStyle(kind)} aria-hidden="true" />
    </span>
  )
}
