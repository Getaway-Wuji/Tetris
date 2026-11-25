import { expect, test, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../src/tetris/engine/storage';

test.use({ reducedMotion: 'no-preference' });

async function measureCushion(page: Page, from = 0, color: 'warm' | 'blue' = 'warm', column?: number) {
  return page.locator('.playfield canvas').evaluate((canvas: HTMLCanvasElement, { firstRow, color, column }) => {
    const sample = document.createElement('canvas');
    sample.width = 200;
    sample.height = 400;
    const painter = sample.getContext('2d')!;
    painter.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = painter.getImageData(0, 0, sample.width, sample.height).data;
    let top = sample.height;
    let bottom = -1;
    let left = sample.width;
    let right = -1;
    let center = 0;
    for (let y = firstRow; y < sample.height; y++) {
      for (let x = column ?? 75; x < (column === undefined ? 125 : column + 1); x++) {
        const index = (y * sample.width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        const matches = color === 'warm' ? red > 140 && green > 105 && green - blue > 22
          : blue > 125 && blue - red > 25;
        if (alpha <= 170 || !matches) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
        if (x === 99) center++;
      }
    }
    return { top, bottom, height: bottom - top + 1, width: right - left + 1, center };
  }, { firstRow: from, color, column });
}

async function openFallSettings(page: Page) {
  await page.getByRole('button', { name: '游戏设置' }).click();
  const dialog = page.getByRole('dialog', { name: '游戏设置' });
  return {
    accelerated: dialog.getByRole('switch', { name: '重力加速下落' }),
    close: dialog.getByRole('button', { name: '关闭弹窗' }),
  };
}

async function loadFallingCushion(page: Page, row: number, accelerated = false, stack = false) {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, canvas, args) {
        return String(args[0]).includes('webgl')
          ? Reflect.apply(target, canvas, [args[0], { ...args[1], preserveDrawingBuffer: true }])
          : Reflect.apply(target, canvas, args);
      },
    });
  });
  const initialTime = Date.now();
  await page.clock.install({ time: initialTime });
  await page.goto('/');
  const start = page.getByRole('button', { name: '开始游戏', exact: true });
  await expect(start).toBeVisible();
  await expect(page.locator('.playfield canvas')).toHaveCount(1);
  await page.clock.pauseAt(Date.now() + 1500);
  if (accelerated) {
    const settings = await openFallSettings(page);
    await settings.accelerated.click();
    await expect(settings.accelerated).toBeChecked();
    await settings.close.click();
  }
  await start.click();
  await page.keyboard.press('p');
  await page.evaluate(({ key, row, stack }) => {
    const save = JSON.parse(localStorage.getItem(key)!);
    const state = JSON.parse(save.payload);
    state.active = { kind: 2, rotation: 0, x: 3, y: row };
    state.gravityElapsedMs = 0;
    state.gravityRows = 0;
    if (stack) {
      for (let y = 20; y <= 23; y++) {
        state.board[y][4] = 1;
        state.groups[y][4] = 1;
      }
      state.nextGroup = 2;
    }
    save.payload = JSON.stringify(state);
    localStorage.setItem(key, JSON.stringify(save));
  }, { key: STORAGE_KEYS.active, row, stack });

  await page.reload();
  const resume = page.locator('.board-prompt').getByRole('button', { name: '继续游戏', exact: true });
  await expect(resume).toBeVisible();
  // Let WebGL paint the restored, paused board before the physics clock starts.
  await expect.poll(async () => {
    await page.clock.runFor(32);
    return Math.abs((await measureCushion(page)).top - (row - 4) * 20);
  }).toBeLessThan(5);
  await resume.click();
}

test('ArrowDown locks immediately while the cushion falls, compresses and springs back near the floor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('THREE.WebGLProgram')) errors.push(message.text());
  });
  await loadFallingCushion(page, 12);
  await page.clock.runFor(50);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('tetris-score')).toHaveText('20');

  const fall: number[] = [];
  for (let frame = 0; frame < 3; frame++) {
    await page.clock.runFor(64);
    fall.push((await measureCushion(page, 160)).top);
  }
  expect(fall[1] - fall[0]).toBeGreaterThan(15);
  expect(fall[2] - fall[1]).toBeGreaterThan(fall[1] - fall[0] + 6);

  await page.clock.runFor(68);
  const squeezed = await measureCushion(page, 325);
  await page.clock.runFor(162);
  const bounce = await measureCushion(page, 325);
  await page.clock.runFor(360);
  const settled = await measureCushion(page, 325);

  expect(settled.height).toBeGreaterThan(35);
  expect(settled.center / settled.height).toBeGreaterThan(.9);
  expect(squeezed.height).toBeLessThan(settled.height - 2);
  expect(squeezed.width).toBeGreaterThan(settled.width + 1);
  expect(bounce.top).toBeLessThan(squeezed.top - 3);
  expect(Math.abs(bounce.bottom - settled.bottom)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('an existing cushion yields when the falling piece actually touches it', async ({ page }) => {
  await loadFallingCushion(page, 12, false, true);
  const resting = await measureCushion(page, 310, 'blue');
  const struckBefore = await measureCushion(page, 310, 'blue', 89);
  expect(resting.height).toBeGreaterThan(65);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('tetris-score')).toHaveText('12');

  await page.clock.runFor(100);
  expect(await measureCushion(page, 310, 'blue')).toEqual(resting);
  await page.clock.runFor(130);
  const pressed = await measureCushion(page, 310, 'blue');
  expect(Math.abs(pressed.bottom - resting.bottom)).toBeLessThan(3);
  const struckEdge = await measureCushion(page, 310, 'blue', 89);
  const landingEdge = await measureCushion(page, 250, 'warm', 89);
  expect(struckEdge.top).toBeGreaterThan(struckBefore.top + 1);
  expect(Math.abs(struckEdge.top - landingEdge.bottom)).toBeLessThan(4);
  await page.clock.runFor(450);
  const settled = await measureCushion(page, 310, 'blue');
  // The piece resting on top partly covers the support's outer nap.
  expect(Math.abs(settled.top - resting.top)).toBeLessThanOrEqual(2);
  expect(settled.bottom).toBe(resting.bottom);
});

test('default natural fall moves uniformly and can switch to acceleration without jumping', async ({ page }) => {
  await loadFallingCushion(page, 6);
  await page.clock.runFor(32);

  const uniform = [(await measureCushion(page)).top];
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(160);
    uniform.push((await measureCushion(page)).top);
  }
  const expectedTravel = 160 * 20 / 94;
  for (let i = 1; i < uniform.length; i++) {
    expect(Math.abs(uniform[i] - uniform[i - 1] - expectedTravel)).toBeLessThan(5);
  }

  const settings = await openFallSettings(page);
  await expect(settings.accelerated).not.toBeChecked();
  await page.clock.runFor(32);
  const paused = await measureCushion(page);
  expect(Math.abs(paused.top - uniform.at(-1)!)).toBeLessThan(6);
  await settings.accelerated.click();
  await expect(settings.accelerated).toBeChecked();
  await page.clock.runFor(32);
  expect(Math.abs((await measureCushion(page)).top - paused.top)).toBeLessThan(2);
  await settings.close.click();

  const accelerated = [paused.top];
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(160);
    accelerated.push((await measureCushion(page)).top);
  }
  expect(accelerated[1] - accelerated[0]).toBeGreaterThan(24);
  expect(accelerated[3] - accelerated[2]).toBeGreaterThan(accelerated[1] - accelerated[0] + 6);
  await expect(page.getByTestId('tetris-score')).toHaveText('0');
});

test('optional acceleration crosses multiple rows and retains momentum across a pause', async ({ page }) => {
  await loadFallingCushion(page, 6, true);
  await page.clock.runFor(32);

  const samples = [(await measureCushion(page)).top];
  for (let frame = 1; frame <= 28; frame++) {
    await page.clock.runFor(48);
    samples.push((await measureCushion(page)).top);
  }
  // Four equal windows span the first 11+ rule rows. Smaller samples catch pauses at row boundaries.
  const windows = [0, 7, 14, 21].map(start => samples[start + 7] - samples[start]);
  expect(windows[0], `Observed top edges: ${samples.join(', ')}`).toBeGreaterThan(8);
  for (let i = 1; i < windows.length; i++) expect(windows[i] - windows[i - 1]).toBeGreaterThan(20);
  const steps = samples.slice(4).map((top, i) => top - samples[i + 3]);
  expect(Math.min(...steps)).toBeGreaterThan(0);
  expect(Math.max(...steps)).toBeLessThan(25);
  await expect(page.getByTestId('tetris-score')).toHaveText('0');

  await page.keyboard.press('p');
  await page.clock.runFor(32);
  const paused = await measureCushion(page);
  expect(Math.abs(paused.top - samples.at(-1)!)).toBeLessThan(8);
  await page.clock.runFor(1500);
  expect(await measureCushion(page)).toEqual(paused);
  await page.locator('.board-prompt').getByRole('button', { name: '继续游戏', exact: true }).click();
  await page.clock.runFor(100);
  const resumedTravel = (await measureCushion(page)).top - paused.top;
  expect(resumedTravel).toBeGreaterThan(20);
  expect(resumedTravel).toBeLessThan(50);

  // The standard preset takes 1,880ms for 20 cells and about 1,682ms for 16.
  await page.clock.runFor(232);
  const squeezedHeights = [(await measureCushion(page)).height];
  for (let frame = 0; frame < 2; frame++) {
    await page.clock.runFor(16);
    squeezedHeights.push((await measureCushion(page)).height);
  }
  await page.clock.runFor(112);
  const rebound = [await measureCushion(page)];
  for (let frame = 0; frame < 2; frame++) {
    await page.clock.runFor(16);
    rebound.push(await measureCushion(page));
  }
  await page.keyboard.press('p');
  const saved = await page.evaluate(key => JSON.parse(JSON.parse(localStorage.getItem(key)!).payload), STORAGE_KEYS.active);
  expect(saved.active).toEqual({ kind: 2, rotation: 0, x: 3, y: 22 });
  expect(saved.board.flat().every((cell: number) => cell === 0)).toBe(true);
  await page.clock.runFor(450);
  const settled = await measureCushion(page);
  expect(Math.min(...squeezedHeights)).toBeLessThan(settled.height - 1);
  expect(Math.max(...rebound.map(sample => sample.height))).toBeGreaterThan(Math.min(...squeezedHeights) + 1);
  expect(rebound.every(sample => Math.abs(sample.bottom - settled.bottom) <= 1)).toBe(true);
});
