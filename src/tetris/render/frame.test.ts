import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectPieces, frameFromSnapshot, rowBeforeClear, type Cell } from './frame';

test('keeps neighboring same-color pieces distinct and splits disconnected remnants', () => {
  const cells: Cell[] = [
    { x: 0, y: 4, kind: 2, group: 3 }, { x: 0, y: 5, kind: 2, group: 3 },
    { x: 1, y: 4, kind: 2, group: 4 }, { x: 1, y: 5, kind: 2, group: 4 },
    { x: 7, y: 4, kind: 2, group: 3 },
  ];
  const pieces = collectPieces(cells);
  assert.deepEqual(pieces.map(piece => [piece.group, piece.x, piece.shape]), [
    [3, 0, [[0, 0], [0, 1]]], [3, 7, [[0, 0]]], [4, 1, [[0, 0], [0, 1]]],
  ]);
});

test('preserves hidden active cells and enough clear feedback to reconstruct pre-clear rows', () => {
  const snapshot = {
    board: Array.from({ length: 24 }, () => Array<number>(10).fill(0)),
    active: { kind: 3, rotation: 0, cells: [[4, 3], [3, 4], [4, 4], [5, 4]] as const },
    ghost: [[4, 3], [3, 4], [4, 4], [5, 4]] as const,
    events: [
      { type: 'lock', kind: 2, group: 14, drop: 8, cells: [[4, 22], [5, 22], [4, 23], [5, 23]] },
      { type: 'clear', rows: [22, 23], cells: [[4, 22, 2], [4, 23, 2]], groups: [14, 14] },
    ] as const,
  };
  const frame = frameFromSnapshot(snapshot, 1)!;
  assert.equal(frame.active[0].y, -1);
  assert.equal(frame.ghost.length, 3);
  assert.equal(collectPieces(frame.active, true)[0].width, 3);
  assert.equal(frame.event?.type, 'clear');
  assert.equal(frame.event?.lock?.drop, 8);
  assert.deepEqual(frame.event?.rows, [18, 19]);
  assert.equal(collectPieces(frame.event!.cells)[0].group, 14);
  assert.deepEqual([18, 19].map(row => rowBeforeClear(row, [18, 19])), [16, 17]);
  assert.deepEqual([15, 16, 17, 18, 19].map(row => rowBeforeClear(row, [16, 18])), [13, 14, 15, 17, 19]);
});
