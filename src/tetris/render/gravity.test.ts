import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gravityContactTime, gravityOffset } from './gravity';

test('uniform natural fall covers equal distances in equal time through logical rows', () => {
  const first = { intervalMs: 94, elapsedMs: 0, advancedRows: 0, sampledAt: 0, rows: 4 };
  assert.equal(gravityOffset(first, 47), 0.5);
  assert.equal(gravityOffset(first, 141), 1.5);
  assert.equal(gravityOffset(first, 235), 2.5);
  assert.equal(gravityOffset(first, 470), 4);

  const next = { ...first, elapsedMs: 141, advancedRows: 1, sampledAt: 141, rows: 3 };
  assert.equal(1 + gravityOffset(next, 235), gravityOffset(first, 235));
  assert.equal(gravityContactTime(next), 376);
});

test('natural fall accelerates across successive rows and stays continuous across a late tick', () => {
  const first = { acceleration: 0.0000125, elapsedMs: 0, advancedRows: 0, sampledAt: 0, rows: 4 };
  assert.equal(gravityOffset(first, 200), 0.25);
  assert.equal(gravityOffset(first, 400), 1);
  assert.equal(gravityOffset(first, 600), 2.25);

  const next = { ...first, elapsedMs: 600, advancedRows: 2, sampledAt: 600, rows: 2 };
  assert.equal(2 + gravityOffset(next, 600), gravityOffset(first, 600));
  assert.equal(2 + gravityOffset(next, 700), gravityOffset(first, 700));
  assert.equal(gravityOffset(next, 850), 2);
  assert.equal(gravityContactTime(next), 800);
});

test('a paused sample holds its fractional progress until it is resumed', () => {
  const paused = { acceleration: 0.0000125, elapsedMs: 600, advancedRows: 2, sampledAt: null, rows: 5 };
  assert.equal(gravityOffset(paused, 50_000), 0.25);
  assert.equal(gravityContactTime(paused), null);
  assert.equal(gravityOffset({ ...paused, sampledAt: 50_000 }, 50_200), 2);
  assert.equal(gravityOffset(undefined, 50_000), 0);
});
