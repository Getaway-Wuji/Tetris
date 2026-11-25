import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../src/tetris/engine/storage';

interface EngineSave {
  difficulty?: 'casual' | 'standard' | 'challenge';
  acceleratedFall: boolean;
  gravityElapsedMs: number;
  gravityRows: number;
  active: { kind: number; rotation: number; x: number; y: number } | null;
  board: number[][];
  groups?: number[][];
  nextGroup?: number;
  hold: number;
  canHold: boolean;
  next: number[];
  score: number;
  lines: number;
  elapsedMs: number;
}

function phase(page: Page) {
  return page.locator('.plush-app');
}

function score(page: Page) {
  return page.getByTestId('tetris-score');
}

function settings(page: Page) {
  return page.getByRole('dialog', { name: '游戏设置' });
}

function pause(page: Page) {
  return page.keyboard.press('p');
}

async function resume(page: Page) {
  await page.getByRole('region', { name: '已暂停' }).getByRole('button', { name: '继续游戏' }).click();
  await expect(phase(page)).toHaveAttribute('data-phase', 'running');
}

async function start(page: Page) {
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(phase(page)).toHaveAttribute('data-phase', 'running');
}

function readSave(page: Page) {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Expected the current game to be saved');
    const saved: { id: string; payload: string } = JSON.parse(raw);
    return { id: saved.id, state: JSON.parse(saved.payload) as EngineSave };
  }, STORAGE_KEYS.active);
}

function editSave(page: Page, fixture: Partial<EngineSave>) {
  return page.evaluate(({ key, fixture }) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('Start and pause a real game before restoring a fixture');
    const saved: { id: string; payload: string } = JSON.parse(raw);
    const state: EngineSave = { ...JSON.parse(saved.payload), ...fixture };
    if (fixture.board) {
      delete state.groups;
      delete state.nextGroup;
    }
    saved.payload = JSON.stringify(state);
    const encoded = JSON.stringify(saved);
    localStorage.setItem(key, encoded);
    return encoded;
  }, { key: STORAGE_KEYS.active, fixture });
}

function setVisibility(page: Page, state: 'visible' | 'hidden') {
  return page.evaluate(visibility => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: visibility });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  const time = Date.now();
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 1000);
  // Use the simplified renderer for deterministic rule and persistence checks.
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        return String(args[0]).includes('webgl') ? null : Reflect.apply(target, canvas, args);
      },
    });
  });
  const wasm = page.waitForResponse(response => /\/tetris_core(?:-[\w-]+)?\.wasm$/.test(new URL(response.url()).pathname));
  await page.goto('/');
  expect((await wasm).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '毛绒俄罗斯方块', exact: true })).toBeVisible();
});

test('plays with keyboard, keeps settings and restores the exact active round', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('s');
  await expect(score(page)).toHaveText('1');
  await pause(page);
  const moved = await readSave(page);
  expect(moved.state.active).toMatchObject({ x: 2, y: 4, rotation: 1 });

  await resume(page);
  await page.keyboard.press('z');
  await pause(page);
  expect((await readSave(page)).state.active?.rotation).toBe(0);
  await resume(page);
  await page.keyboard.press('c');
  await expect(page.getByText('暂存不可用')).toBeVisible();
  await page.keyboard.press('c');
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowDown');
  // Keep the next piece airborne while checking the restored movement binding.
  await page.clock.runFor(1100);
  await page.keyboard.up('ArrowDown');
  await pause(page);
  const saved = await readSave(page);
  expect(saved.id).toBe(moved.id);
  expect(saved.state.hold).toBe(moved.state.active?.kind);
  expect(saved.state.canHold).toBe(true);
  expect(saved.state.board.flat().filter(Boolean)).toHaveLength(4);
  const lockedGroups = saved.state.groups?.flat().filter(Boolean);
  expect(lockedGroups).toHaveLength(4);
  expect(new Set(lockedGroups).size).toBe(1);
  expect(saved.state.score).toBeGreaterThan(1);
  await expect(page.getByTestId('tetris-time')).toHaveText('00:01');

  await page.getByRole('button', { name: '游戏设置' }).click();
  const dialog = settings(page);
  await dialog.getByRole('combobox', { name: '画质' }).selectOption('low');
  const ghost = dialog.getByRole('switch', { name: '显示落点预览' });
  await ghost.click();
  await expect(ghost).not.toBeChecked();
  const sound = dialog.getByRole('switch', { name: '游戏音效' });
  await sound.click();
  await expect(sound).not.toBeChecked();
  const leftBinding = dialog.getByRole('button', { name: '更改左移按键' });
  await leftBinding.click();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('status')).toContainText('已被占用');
  await leftBinding.click();
  await page.keyboard.press('a');
  await expect(dialog.getByRole('status')).toContainText('左移已设为 A');
  await page.clock.runFor(4500);
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  expect(await readSave(page)).toEqual(saved);

  await page.reload();
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  await expect(score(page)).toHaveText(String(saved.state.score));
  await expect(page.getByTestId('tetris-time')).toHaveText('00:01');
  await page.getByRole('button', { name: '游戏设置' }).click();
  await expect(dialog.getByRole('combobox', { name: '画质' })).toHaveValue('low');
  await expect(ghost).not.toBeChecked();
  await expect(sound).not.toBeChecked();
  await expect(leftBinding).toHaveText('A');
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await resume(page);
  await page.keyboard.press('a');
  await pause(page);
  expect((await readSave(page)).state.active?.x).toBe(saved.state.active!.x - 1);
  expect(errors).toEqual([]);
});

test('selects a starting difficulty and applies changes only to the next round', async ({ page }) => {
  const preset = page.getByRole('combobox', { name: '难度' });
  await expect(preset).toHaveValue('standard');
  await expect(preset.locator('option')).toHaveText(['休闲', '标准', '挑战']);
  await preset.selectOption('casual');
  await start(page);
  const first = await readSave(page);
  expect(first.state.difficulty).toBe('casual');
  await page.clock.runFor(650);
  await pause(page);
  const slow = await readSave(page);
  expect(slow.state.active!.y - first.state.active!.y).toBe(3);

  await page.getByRole('button', { name: '游戏设置' }).click();
  await settings(page).getByRole('combobox', { name: '下局难度' }).selectOption('challenge');
  await settings(page).getByRole('button', { name: '关闭弹窗' }).click();
  await page.reload();
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  await expect(page.locator('.cabinet-heading')).toContainText('休闲');
  expect(await readSave(page)).toEqual(slow);

  await page.getByRole('region', { name: '已暂停' }).getByRole('button', { name: '开始新局' }).click();
  const second = await readSave(page);
  expect(second.id).not.toBe(first.id);
  expect(second.state.difficulty).toBe('challenge');
  await page.clock.runFor(650);
  await pause(page);
  const fast = await readSave(page);
  expect(fast.state.active!.y - second.state.active!.y).toBe(15);
  await expect(page.locator('.cabinet-heading')).toContainText('挑战');
});

test('toggles accelerated fall in the current round and remembers it after reload', async ({ page }) => {
  await start(page);
  await page.clock.runFor(145);
  await pause(page);
  const before = await readSave(page);
  expect(before.state.acceleratedFall).toBe(false);

  await page.getByRole('button', { name: '游戏设置' }).click();
  const toggle = settings(page).getByRole('switch', { name: '重力加速下落' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await settings(page).getByRole('button', { name: '关闭弹窗' }).click();
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  const after = await readSave(page);
  expect(after.id).toBe(before.id);
  expect(after.state).toMatchObject({ acceleratedFall: true, active: before.state.active,
    board: before.state.board, elapsedMs: before.state.elapsedMs, gravityRows: before.state.gravityRows });
  expect(after.state.gravityElapsedMs * after.state.gravityElapsedMs * 20 / (1880 * 1880))
    .toBeCloseTo(before.state.gravityElapsedMs / 94, 6);

  await page.reload();
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  await page.getByRole('button', { name: '游戏设置' }).click();
  await expect(toggle).toBeChecked();
  expect(await readSave(page)).toEqual(after);
});

test('blocks manual inputs on a stack and locks at the original spot', async ({ page }) => {
  await start(page);
  await pause(page);
  const board = Array.from({ length: 24 }, () => Array<number>(10).fill(0));
  board[22][4] = 3;
  const piece = { kind: 2, rotation: 0, x: 3, y: 20 };
  await editSave(page, { board, active: piece });
  await page.reload();
  await expect(page.getByText('暂存不可用')).toBeVisible();
  for (const key of ['ArrowLeft', 'ArrowRight', 'x', 'z', 's', 'ArrowDown', 'c']) {
    await resume(page);
    await page.keyboard.press(key);
    await pause(page);
    expect((await readSave(page)).state, key).toMatchObject({ active: piece, board, hold: 0, score: 0 });
  }
  await resume(page);
  await page.keyboard.down('ArrowRight');
  await page.clock.runFor(480);
  await pause(page);
  expect((await readSave(page)).state.active).toEqual(piece);
  await page.keyboard.up('ArrowRight');
  await resume(page);
  await page.clock.runFor(40);
  await pause(page);
  const settled = await readSave(page);
  expect(settled.state.board[20].slice(4, 6)).toEqual([2, 2]);
  expect(settled.state.board[21].slice(4, 6)).toEqual([2, 2]);
  expect(settled.state.board.flat().filter(Boolean)).toHaveLength(5);
});

test('side contact blocks manual inputs while gravity still moves the piece down', async ({ page }) => {
  await start(page);
  await pause(page);
  const board = Array.from({ length: 24 }, () => Array<number>(10).fill(0));
  board[18][3] = 3;
  const piece = { kind: 2, rotation: 0, x: 3, y: 16 };
  await editSave(page, { board, active: piece });
  await page.reload();
  await resume(page);
  await expect(page.getByText('可以暂存')).toBeVisible();
  await page.clock.runFor(104);
  await expect(page.getByText('暂存不可用')).toBeVisible();
  for (const key of ['ArrowRight', 'x', 'z', 's', 'Space', 'c']) {
    await page.keyboard.press(key);
    await pause(page);
    expect((await readSave(page)).state, key).toMatchObject({ active: { ...piece, y: 17 }, board, hold: 0, score: 0 });
    await resume(page);
  }
  await page.clock.runFor(100);
  await pause(page);
  expect((await readSave(page)).state).toMatchObject({ active: { ...piece, y: 18 }, board, score: 0 });
});

test('stops time and held input in the background and resumes after confirmation', async ({ page }) => {
  await start(page);
  await page.keyboard.down('ArrowLeft');
  await page.clock.runFor(100);
  await setVisibility(page, 'hidden');
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  const suspended = await readSave(page);
  expect(suspended.state.active?.x).toBe(2);

  await page.clock.runFor(5500);
  await setVisibility(page, 'visible');
  await expect(phase(page)).toHaveAttribute('data-phase', 'paused');
  expect(await readSave(page)).toEqual(suspended);
  await resume(page);
  await page.clock.runFor(240);
  await pause(page);
  await page.keyboard.up('ArrowLeft');
  const resumed = await readSave(page);
  expect(resumed.state.active).toEqual({ ...suspended.state.active, y: suspended.state.active!.y + 2 });
  expect(resumed.state.elapsedMs - suspended.state.elapsedMs).toBeCloseTo(240);

  await resume(page);
  await page.keyboard.press('ArrowRight');
  await pause(page);
  expect((await readSave(page)).state.active?.x).toBe(3);
});

test('hard drops into a nearly full board and clears four rows before leveling up', async ({ page }) => {
  await start(page);
  await pause(page);
  const board = Array.from({ length: 24 }, (_, y) => Array.from({ length: 10 }, (_, x) =>
    y < 4 || x === 4 ? 0 : (x + y) % 7 + 1));
  await editSave(page, { board, active: { kind: 1, rotation: 1, x: 2, y: 0 }, lines: 9 });
  await page.reload();
  await expect(page.getByTestId('tetris-lines')).toHaveText('09');
  await resume(page);
  await page.keyboard.press('Space');
  await expect(score(page)).toHaveText('840');
  await expect(page.getByTestId('tetris-lines')).toHaveText('13');
  await expect(page.getByTestId('tetris-level')).toHaveText('02');
  await pause(page);
  expect((await readSave(page)).state.board.flat().filter(Boolean)).toHaveLength(144);
});

test('freezes top-out statistics and records a completed round once across refreshes', async ({ page }) => {
  await start(page);
  await pause(page);
  const board = Array.from({ length: 24 }, () => Array<number>(10).fill(0));
  board[4][4] = 5;
  const staleSave = await editSave(page, {
    board, active: { kind: 2, rotation: 0, x: 3, y: 22 }, score: 432, elapsedMs: 2030,
  });
  await page.reload();
  await resume(page);
  await page.keyboard.press('Space');
  const result = page.getByRole('region', { name: '本局结束' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('432');
  await expect(result).toContainText('00:02');
  await expect(result.getByRole('link', { name: '返回游戏大厅' })).toHaveAttribute('href', '/');
  await page.clock.runFor(8000);
  await expect(page.getByTestId('tetris-time')).toHaveText('00:02');
  await result.getByRole('button', { name: '查看记录' }).click();
  const history = page.getByRole('dialog', { name: '对局记录' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history.getByRole('listitem')).toContainText('432');

  await page.evaluate(({ key, staleSave }) => localStorage.setItem(key, staleSave),
    { key: STORAGE_KEYS.active, staleSave });
  await page.reload();
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history.getByRole('listitem')).toContainText('432');
});

test('recovers from an unavailable WASM file and discards an invalid save', async ({ page }) => {
  await start(page);
  await pause(page);
  await editSave(page, { board: [] });
  await page.route(/\/tetris_core(?:-[\w-]+)?\.wasm$/, route => route.abort(), { times: 1 });
  await page.reload();
  await expect(phase(page)).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: '重试加载' }).click();
  await expect(phase(page)).toHaveAttribute('data-phase', 'ready');
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEYS.active)).toBeNull();
  await start(page);
  await page.keyboard.press('s');
  await expect(score(page)).toHaveText('1');
});
