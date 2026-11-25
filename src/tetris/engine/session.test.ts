import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HeldInput } from './repeat';
import { TetrisSession } from './session';
import { STORAGE_KEYS } from './storage';
import type { GameAction, Snapshot, TetrisCore } from './types';

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } satisfies Storage;
}

function fixtures(storage: Storage = fakeStorage(), coreReady: Promise<void> = Promise.resolve()) {
  let time = 0;
  let nextId = 1;
  const commands: GameAction[] = [];
  const durations: number[] = [];
  const state: Snapshot = {
    board: Array.from({ length: 24 }, () => Array<number>(10).fill(0)),
    groups: Array.from({ length: 24 }, () => Array<number>(10).fill(0)),
    active: { kind: 1, x: 3, y: 3, rotation: 0, cells: [[3, 4], [4, 4], [5, 4], [6, 4]] },
    ghost: [],
    next: [2, 3, 4, 5, 6],
    difficulty: 'standard',
    score: 0,
    lines: 0,
    level: 1,
    elapsedMs: 0,
    acceleratedFall: false,
    gravityElapsedMs: 0,
    gravityIntervalMs: 400,
    gravityRows: 0,
    gravityAcceleration: 0.0000125,
    hold: 0,
    canHold: true,
    gameOver: false,
    events: [],
  };
  let current = structuredClone(state);
  let finishNext = false;
  const core: TetrisCore = {
    start: (_seed, difficulty, acceleratedFall) => {
      current = structuredClone({ ...state, difficulty, acceleratedFall });
      return structuredClone(current);
    },
    setAcceleratedFall: enabled => {
      if (enabled !== current.acceleratedFall) {
        const travel = current.acceleratedFall
          ? 0.5 * current.gravityAcceleration * current.gravityElapsedMs ** 2
          : current.gravityElapsedMs / current.gravityIntervalMs;
        current.gravityElapsedMs = enabled
          ? Math.sqrt(2 * travel / current.gravityAcceleration)
          : travel * current.gravityIntervalMs;
        current.acceleratedFall = enabled;
        current.events = [];
      }
      return structuredClone(current);
    },
    execute: action => {
      commands.push(action);
      current.events = [];
      if (current.active && (action === 'left' || action === 'right')) {
        const dx = action === 'left' ? -1 : 1;
        current.active.x += dx;
        current.active.cells = current.active.cells.map(([x, y]) => [x + dx, y]);
      }
      if (action === 'hardDrop' && !finishNext && current.groups) {
        current.board[23][0] = 1;
        current.groups[23][0] = 123;
        current.events = [{ type: 'lock', cells: [[0, 23]], kind: 1, group: 123, drop: 19 }];
      }
      if (finishNext) {
        finishNext = false;
        current.gameOver = true;
        current.score = 432;
        current.lines = 12;
        current.level = 2;
      }
      return structuredClone(current);
    },
    advance: delta => {
      durations.push(delta);
      current.events = [];
      current.elapsedMs += delta;
      current.gravityElapsedMs += delta;
      const rows = Math.floor(current.acceleratedFall
        ? 0.5 * current.gravityAcceleration * current.gravityElapsedMs ** 2
        : current.gravityElapsedMs / current.gravityIntervalMs);
      const passed = rows - current.gravityRows;
      current.gravityRows = rows;
      if (current.active && passed) {
        current.active.y += passed;
        current.active.cells = current.active.cells.map(([x, y]) => [x, y + passed]);
      }
      return structuredClone(current);
    },
    save: () => JSON.stringify(current),
    restore: payload => {
      try {
        const raw = JSON.parse(payload);
        if (Array.isArray(raw.board)) {
          current = raw;
          return structuredClone(current);
        }
      } catch {
        return null;
      }
      return null;
    },
  };
  const session = new TetrisSession({
    now: () => time,
    completedAt: () => '2026-11-17T04:25:00.000Z',
    newId: () => `test-game-${nextId++}`,
    seed: () => 1234,
    loadCore: () => coreReady.then(() => core),
    storage: () => storage,
    reduceMotion: () => false,
    unlockSound: () => {},
    playSound: () => {},
  });
  return {
    session, storage, commands, durations,
    clock(milliseconds: number) { time += milliseconds; },
    finishOnNextInput() { finishNext = true; },
    elapsed() { return current.elapsedMs; },
  };
}

describe('held input', () => {
  test('repeats horizontal motion after 150 ms, then every 50 ms, and soft drop every 40 ms', () => {
    const held = new HeldInput();
    assert.equal(held.press('left', 'left', 0), true);
    assert.equal(held.press('soft', 'softDrop', 0), true);
    assert.equal(held.takeDue(39), null);
    for (const at of [40, 80, 120]) assert.deepEqual(held.takeDue(at), { action: 'softDrop', at });
    assert.equal(held.takeDue(149), null);
    assert.deepEqual(held.takeDue(150), { action: 'left', at: 150 });
    held.release('soft', 150);
    assert.equal(held.takeDue(199), null);
    assert.deepEqual(held.takeDue(200), { action: 'left', at: 200 });
  });

  test('prefers the latest held direction and stops one-shot keys from repeating', () => {
    const held = new HeldInput();
    held.press('left', 'left', 0);
    held.press('right', 'right', 100);
    assert.equal(held.takeDue(150), null);
    assert.deepEqual(held.takeDue(250), { action: 'right', at: 250 });
    held.release('right', 251);
    assert.equal(held.takeDue(400), null);
    assert.deepEqual(held.takeDue(401), { action: 'left', at: 401 });
    held.clear();
    assert.equal(held.press('space', 'hardDrop', 500), true);
    assert.equal(held.press('space', 'hardDrop', 700), false);
    assert.equal(held.takeDue(1000), null);
  });
});

describe('tetris session', () => {
  test('freezes overlay time and preserves the manual pause state across settings', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    session.start(0);
    game.clock(480);
    session.openOverlay('settings');
    assert.equal(session.getSnapshot().phase, 'paused');
    assert.equal(session.getSnapshot().board?.elapsedMs, 480);
    game.clock(10_000);
    session.tick();
    session.patchSettings({ ghost: false, quality: 'low' });
    session.closeOverlay();
    assert.equal(session.getSnapshot().phase, 'running');
    game.clock(70);
    session.pause();
    assert.equal(session.getSnapshot().board?.elapsedMs, 550);
    session.openOverlay('help');
    game.clock(9000);
    session.closeOverlay();
    assert.equal(session.getSnapshot().phase, 'paused');
    assert.deepEqual(game.durations, [480, 70]);
  });

  test('a running gravity sample is stable between row crossings and stays synchronized through inputs', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    assert.equal(session.getSnapshot().fallClock, null);
    game.clock(250);
    session.start();
    const started = session.getSnapshot();
    assert.equal(started.fallClock, 250);
    assert.equal(started.board?.gravityElapsedMs, 0);
    assert.equal(started.board?.gravityAcceleration, 0.0000125);
    game.clock(339);
    session.tick();
    assert.equal(session.getSnapshot(), started);
    session.tap('right');
    const moved = session.getSnapshot();
    assert.equal(moved.fallClock, 589);
    assert.equal(moved.board?.gravityElapsedMs, 339);
    assert.equal(moved.board?.active?.x, 4);
    game.clock(94);
    session.tick();
    const dropped = session.getSnapshot();
    assert.equal(dropped.fallClock, 683);
    assert.equal(dropped.board?.gravityElapsedMs, 433);
    assert.equal(dropped.board?.gravityRows, 1);
    assert.equal(dropped.board?.active?.y, 4);
  });

  test('freezes the exact flight age and rebases it after returning from the background', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    session.start();
    game.clock(390);
    session.suspend();
    const paused = session.getSnapshot();
    assert.equal(paused.fallClock, null);
    assert.equal(paused.board?.gravityElapsedMs, 390);
    game.clock(9000);
    session.tick();
    assert.equal(session.getSnapshot(), paused);
    session.resume();
    const resumed = session.getSnapshot();
    assert.equal(resumed.fallClock, 9390);
    assert.equal(resumed.board, paused.board);
    game.clock(9);
    session.tick();
    assert.equal(session.getSnapshot(), resumed);
    game.clock(1);
    session.tick();
    const dropped = session.getSnapshot();
    assert.equal(dropped.fallClock, 9400);
    assert.equal(dropped.board?.elapsedMs, 400);
    assert.equal(dropped.board?.gravityElapsedMs, 400);
    assert.equal(dropped.board?.gravityRows, 1);
    assert.equal(dropped.board?.active?.y, 4);
  });

  test('a difficulty change applies to the next game and preserves the saved round difficulty', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    assert.equal(session.getSnapshot().settings.difficulty, 'standard');
    session.patchSettings({ difficulty: 'casual' });
    session.start();
    assert.equal(session.getSnapshot().board?.difficulty, 'casual');
    session.patchSettings({ difficulty: 'challenge' });
    assert.equal(session.getSnapshot().board?.difficulty, 'casual');
    assert.equal(session.getSnapshot().settings.difficulty, 'challenge');
    session.pause();

    const restored = fixtures(game.storage);
    await restored.session.load();
    assert.equal(restored.session.getSnapshot().phase, 'paused');
    assert.equal(restored.session.getSnapshot().board?.difficulty, 'casual');
    assert.equal(restored.session.getSnapshot().settings.difficulty, 'challenge');
    restored.session.resume();
    assert.equal(restored.session.getSnapshot().board?.difficulty, 'casual');
    restored.session.start();
    assert.equal(restored.session.getSnapshot().board?.difficulty, 'challenge');
  });

  test('defaults to uniform fall and retimes the live and paused round without changing occupancy', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    assert.equal(session.getSnapshot().settings.acceleratedFall, false);
    session.start();
    assert.equal(session.getSnapshot().board?.acceleratedFall, false);
    game.clock(200);
    session.patchSettings({ acceleratedFall: true });
    const accelerated = session.getSnapshot();
    assert.equal(accelerated.phase, 'running');
    assert.equal(accelerated.fallClock, 200);
    assert.equal(accelerated.board?.acceleratedFall, true);
    assert.equal(accelerated.board?.active?.y, 3);
    assert.equal(accelerated.board?.elapsedMs, 200);
    assert.ok(Math.abs((accelerated.board?.gravityElapsedMs ?? 0) - Math.sqrt(80_000)) < 0.001);
    session.pause();
    game.clock(5_000);
    session.patchSettings({ acceleratedFall: false });
    const uniform = session.getSnapshot();
    assert.equal(uniform.phase, 'paused');
    assert.equal(uniform.fallClock, null);
    assert.equal(uniform.board?.acceleratedFall, false);
    assert.equal(uniform.board?.elapsedMs, 200);
    assert.deepEqual(uniform.board?.active, accelerated.board?.active);
    assert.ok(Math.abs((uniform.board?.gravityElapsedMs ?? 0) - 200) < 0.001);
    session.patchSettings({ acceleratedFall: true });

    const restored = fixtures(game.storage);
    await restored.session.load();
    assert.equal(restored.session.getSnapshot().phase, 'paused');
    assert.equal(restored.session.getSnapshot().board?.acceleratedFall, true);
    assert.equal(restored.session.getSnapshot().settings.acceleratedFall, true);
    assert.deepEqual(restored.session.getSnapshot().board?.active, accelerated.board?.active);
    restored.session.start();
    assert.equal(restored.session.getSnapshot().board?.acceleratedFall, true);
  });

  test('applies a preference changed while WASM is loading to the restored round', async () => {
    const game = fixtures();
    await game.session.load();
    game.session.start();
    game.clock(200);
    game.session.pause();

    let finishLoading = () => {};
    const coreReady = new Promise<void>(resolve => { finishLoading = resolve; });
    const restored = fixtures(game.storage, coreReady);
    const loading = restored.session.load();
    restored.session.patchSettings({ acceleratedFall: true });
    finishLoading();
    await loading;

    const view = restored.session.getSnapshot();
    assert.equal(view.phase, 'paused');
    assert.equal(view.fallClock, null);
    assert.equal(view.settings.acceleratedFall, true);
    assert.equal(view.board?.acceleratedFall, true);
    assert.equal(view.board?.elapsedMs, 200);
    const stored = JSON.parse(game.storage.getItem(STORAGE_KEYS.active)!);
    assert.equal(JSON.parse(stored.payload).acceleratedFall, true);
  });

  test('suspends on loss of focus, restores full saved state, and releases sticky inputs', async () => {
    const game = fixtures();
    await game.session.load();
    game.session.start();
    game.session.keyDown('ArrowLeft', false);
    game.clock(95);
    game.session.suspend();
    game.clock(47_000);
    game.session.tick();
    assert.equal(game.session.getSnapshot().phase, 'paused');
    game.session.resume();
    game.clock(300);
    game.session.tick();
    assert.deepEqual(game.commands, ['left']);
    assert.equal(game.elapsed(), 395);
    game.session.openOverlay('settings');
    game.session.suspend();
    game.session.closeOverlay();
    assert.equal(game.session.getSnapshot().phase, 'paused');
    const restored = fixtures(game.storage);
    await restored.session.load();
    assert.equal(restored.session.getSnapshot().phase, 'paused');
    assert.equal(restored.session.getSnapshot().gameId, game.session.getSnapshot().gameId);
    assert.deepEqual(restored.session.getSnapshot().board, game.session.getSnapshot().board);
  });

  test('uses one-shot keyboard events and clears pointer repeats and old input when restarting', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    session.start();
    session.keyDown('ArrowDown', false);
    session.keyDown('ArrowDown', true);
    session.keyDown('ArrowDown', false);
    session.keyUp('ArrowDown');
    session.keyDown('Space', false);
    session.press('softDrop', 'pointer:1');
    session.clearInputs();
    game.clock(100);
    session.tick();
    session.press('right', 'pointer:2');
    session.start();
    game.clock(300);
    session.tick();
    assert.deepEqual(game.commands, ['hardDrop', 'hardDrop', 'softDrop', 'right']);
    assert.equal(game.elapsed(), 300);
    assert.equal(session.getSnapshot().gameId, 'test-game-2');
  });

  test('keeps the locked cushion identity and drop distance through subsequent clock ticks', async () => {
    const game = fixtures();
    const { session } = game;
    await session.load();
    session.start();
    session.tap('hardDrop');
    const landed = session.getSnapshot();
    assert.equal(landed.board?.groups?.[23][0], 123);
    assert.deepEqual(landed.events, [{ type: 'lock', cells: [[0, 23]], kind: 1, group: 123, drop: 19 }]);
    game.clock(1010);
    session.tick();
    const later = session.getSnapshot();
    assert.equal(later.board?.groups, landed.board?.groups);
    assert.equal(later.events, landed.events);
    assert.equal(later.eventId, landed.eventId);
  });

  test('records one completed run and freezes stats after game over, even with a stale save', async () => {
    const game = fixtures();
    await game.session.load();
    game.session.start();
    const staleSave = game.storage.getItem(STORAGE_KEYS.active)!;
    game.clock(625);
    game.finishOnNextInput();
    game.session.keyDown('Space', false);
    assert.equal(game.session.getSnapshot().phase, 'over');
    assert.deepEqual(game.session.getSnapshot().records, [{
      id: 'test-game-1', completedAt: '2026-11-17T04:25:00.000Z', score: 432, lines: 12, level: 2, elapsedMs: 625,
    }]);
    assert.equal(game.session.getSnapshot().bestScore, 432);
    assert.equal(game.storage.getItem(STORAGE_KEYS.active), null);
    game.clock(18_000);
    game.session.tick();
    game.session.resume();
    game.session.tap('left');
    assert.equal(game.elapsed(), 625);
    game.storage.setItem(STORAGE_KEYS.active, staleSave);
    const restored = fixtures(game.storage);
    await restored.session.load();
    assert.equal(restored.session.getSnapshot().phase, 'ready');
    assert.equal(restored.session.getSnapshot().records.length, 1);
  });

  test('sanitizes corrupted storage and rejects duplicate or browser navigation bindings', async () => {
    const game = fixtures();
    game.storage.setItem(STORAGE_KEYS.settings, '{"difficulty":"ultra","quality":"ultra","volume":90,"bindings":{"left":["unknown"]}}');
    game.storage.setItem(STORAGE_KEYS.active, '{"id":"invalid","payload":"corrupt"}');
    game.storage.setItem(STORAGE_KEYS.history, '{');
    await game.session.load();
    assert.equal(game.session.getSnapshot().phase, 'ready');
    assert.equal(game.session.getSnapshot().settings.volume, 1);
    assert.equal(game.session.getSnapshot().settings.quality, 'auto');
    assert.equal(game.session.getSnapshot().settings.difficulty, 'standard');
    assert.equal(game.session.rebind('left', ['Space']), false);
    assert.equal(game.session.rebind('left', ['Tab']), false);
    assert.equal(game.session.rebind('left', ['KeyA']), true);
    game.session.start();
    assert.equal(game.session.keyDown('ArrowLeft', false), false);
    assert.equal(game.session.keyDown('KeyA', false), true);
    assert.deepEqual(game.commands, ['left']);
  });
});
