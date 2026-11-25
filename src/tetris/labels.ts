import type { Action, Difficulty } from './engine';

export const difficulties = {
  casual: '休闲',
  standard: '标准',
  challenge: '挑战',
} satisfies Record<Difficulty, string>;

export const actions = [
  ['left', '左移'], ['right', '右移'], ['softDrop', '软降'],
  ['clockwise', '顺时针旋转'], ['counterClockwise', '逆时针旋转'],
  ['hardDrop', '落到底'], ['hold', '暂存'], ['pause', '暂停／继续'],
] as const satisfies ReadonlyArray<readonly [Action, string]>;

export const displayKeys: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowDown: '↓', ArrowUp: '↑',
  Space: 'Space', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Minus: '−', Equal: '=',
};

export function keyLabel(code: string) {
  return displayKeys[code] ?? code.replace(/^(Key|Digit)/, '');
}

export function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export const numberLabel = new Intl.NumberFormat('zh-CN');
export const dateLabel = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
