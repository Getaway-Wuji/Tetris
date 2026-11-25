import { devices, expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '../src/tetris/engine/storage';

interface SavedState {
  active: { x: number; y: number; rotation: number };
  board: number[][];
  hold: number;
  canHold: boolean;
  score: number;
  elapsedMs: number;
}

async function savedState(page: Page): Promise<SavedState> {
  return page.evaluate(key => {
    const saved = localStorage.getItem(key);
    if (!saved) throw new Error('Expected a persisted game.');
    return JSON.parse(JSON.parse(saved).payload);
  }, STORAGE_KEYS.active);
}

async function center(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error('Expected a visible touch control.');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

test.describe('mobile touch', () => {
  const pixel = devices['Pixel 7'];
  test.use({
    viewport: pixel.viewport,
    deviceScaleFactor: pixel.deviceScaleFactor,
    hasTouch: pixel.hasTouch,
    isMobile: pixel.isMobile,
    userAgent: pixel.userAgent,
    reducedMotion: 'reduce',
  });

  test('plays with the touch pad, repeats held inputs and stops on pointer cancel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '游戏设置' }).tap();
    const settings = page.getByRole('dialog', { name: '游戏设置' });
    await settings.getByRole('combobox', { name: '画质' }).selectOption('low');
    await settings.getByRole('button', { name: '关闭弹窗' }).tap();
    await page.getByRole('button', { name: '开始游戏' }).tap();

    const game = page.locator('.plush-app');
    const pad = page.getByRole('region', { name: '触摸操作' });
    const button = (name: string) => pad.getByRole('button', { name, exact: true });
    const pause = button('暂停／继续');
    const score = page.getByTestId('tetris-score');
    const readScore = async () => Number((await score.textContent())?.replace(/[^0-9]/g, ''));
    const start = await savedState(page);
    await expect(game).toHaveAttribute('data-phase', 'running');
    expect((await pause.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await pad.evaluate(node => node.getBoundingClientRect().bottom + window.scrollY)).toBeLessThanOrEqual(devices['Pixel 7'].viewport.height);

    await button('右移').tap();
    await button('顺时针旋转').tap();
    await pause.tap();
    await expect(game).toHaveAttribute('data-phase', 'paused');
    const clock = await savedState(page);
    expect(clock.active.x).toBe(start.active.x + 1);
    expect(clock.active.rotation).toBe(1);
    await pause.tap();
    await button('逆时针旋转').tap();

    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center(button('左移'))] });
      await page.waitForTimeout(330);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await pause.tap();
      const shifted = await savedState(page);
      expect(shifted.active.x).toBeLessThan(clock.active.x - 1);
      expect(shifted.active.rotation).toBe(0);
      await pause.tap();

      await button('暂存').tap();
      await expect(button('暂存')).toBeDisabled();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center(button('软降'))] });
      await expect.poll(readScore).toBeGreaterThanOrEqual(3);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      const canceled = await readScore();
      await page.waitForTimeout(220);
      expect(await readScore()).toBe(canceled);
    } finally {
      await cdp.detach();
    }

    const beforeLanding = await readScore();
    await button('落到底').tap();
    await expect.poll(readScore).toBeGreaterThan(beforeLanding);
    await expect(button('暂存')).toBeEnabled();
    await pause.tap();
    await expect(game).toHaveAttribute('data-phase', 'paused');
    const landed = await savedState(page);
    expect(landed.board.flat().filter(Boolean)).toHaveLength(4);
    expect(landed.hold).toBeGreaterThan(0);
    expect(landed.canHold).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(devices['Pixel 7'].viewport.width);
  });
});

test('keyboard input respects focused controls and clears held input across visibility changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始游戏' }).click();
  const game = page.locator('.plush-app');
  const playfield = page.locator('#playfield');
  const settingsButton = page.getByRole('button', { name: '游戏设置' });
  const score = page.getByTestId('tetris-score');
  await expect(playfield).toBeFocused();

  await settingsButton.focus();
  await page.keyboard.press('Space');
  const dialog = page.getByRole('dialog', { name: '游戏设置' });
  await expect(dialog).toBeVisible();
  await expect(score).toHaveText('0');
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(game).toHaveAttribute('data-phase', 'running');
  await expect(playfield).toBeFocused();

  await page.keyboard.down('ArrowRight');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(game).toHaveAttribute('data-phase', 'paused');
  const before = await savedState(page);
  await page.waitForTimeout(1400);
  expect(await savedState(page)).toEqual(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(game).toHaveAttribute('data-phase', 'paused');
  await page.getByRole('region', { name: '已暂停' }).getByRole('button', { name: '继续游戏' }).click();
  await expect(game).toHaveAttribute('data-phase', 'running');
  await page.waitForTimeout(250);
  await page.keyboard.press('p');
  await expect(game).toHaveAttribute('data-phase', 'paused');
  const after = await savedState(page);
  expect(after.active.x).toBe(before.active.x);
  expect(after.elapsedMs - before.elapsedMs).toBeLessThan(1250);
  await page.keyboard.up('ArrowRight');
});
