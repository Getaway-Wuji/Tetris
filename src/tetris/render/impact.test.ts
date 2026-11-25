import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cell } from './frame';
import { resolveImpact } from './impact';

function cells(group: number, coords: [number, number][]): Cell[] {
  return coords.map(([x, y]) => ({ x, y, group, kind: 2 }));
}

test('centers an even floor impact with no stack response', () => {
  const piece = cells(3, [[3, 18], [4, 18], [3, 19], [4, 19]]);
  assert.deepEqual(resolveImpact(piece, []), { x: 3.5, y: 19.5, floor: true, offset: 0, supports: [] });
});

test('finds an off-center bottom contact precisely and damps motion through a second support', () => {
  const piece = cells(4, [[3, 10], [4, 10], [5, 10], [6, 10]]);
  const stack = [
    ...piece,
    ...cells(3, [[3, 11], [3, 12], [3, 13], [4, 13]]),
    ...cells(2, [[4, 14]]),
    ...cells(1, [[4, 15]]),
  ];
  const { supports, ...contact } = resolveImpact(piece, stack)!;
  assert.deepEqual(contact, { x: 3, y: 10.5, floor: false, offset: 1.5 });
  assert.equal(supports.length, 2);
  assert.deepEqual(supports[0], { group: 3, x: 3, y: 10.5, strength: 1, delayMs: 0 });
  assert.equal(supports[1].group, 2);
  assert.equal(supports[1].strength, 0.36);
  assert.equal(supports[1].delayMs, 23);
  assert.ok(Math.abs(supports[1].x - 4) < 1e-9 && Math.abs(supports[1].y - 13.5) < 1e-9);
});

test('weights both same-color support groups and includes staggered bottom faces', () => {
  const piece = cells(4, [[2, 10], [3, 10], [4, 10], [2, 11]]);
  const stack = [...cells(3, [[2, 12]]), ...cells(2, [[3, 11], [4, 11]])];
  const result = resolveImpact(piece, stack)!;
  assert.equal(result.x, 3);
  assert.equal(result.y, (11.5 + 10.5 + 10.5) / 3);
  assert.equal(result.offset, -0.25);
  assert.equal(result.supports.length, 2);
  const first = result.supports.find(support => support.group === 3);
  const second = result.supports.find(support => support.group === 2)!;
  assert.deepEqual(first, { group: 3, x: 2, y: 11.5, strength: 1 / 3, delayMs: 0 });
  assert.equal(second.delayMs, 0);
  assert.equal(second.strength, 2 / 3);
  assert.ok(Math.abs(second.x - 3.5) < 1e-9 && Math.abs(second.y - 10.5) < 1e-9);
});

test('an ungrouped support locates the pivot without deforming unrelated cells', () => {
  const piece = cells(3, [[2, 7], [3, 7]]);
  assert.deepEqual(resolveImpact(piece, cells(0, [[3, 8]])), {
    x: 3, y: 7.5, floor: false, offset: -0.5, supports: [],
  });
});

test('ignores side neighbors and returns no contact for an airborne piece', () => {
  const piece = cells(2, [[4, 7], [4, 8]]);
  assert.equal(resolveImpact(piece, cells(1, [[3, 8], [5, 8], [4, 10]])), null);
  assert.equal(resolveImpact([], []), null);
});
