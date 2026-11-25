import { GAME_ACTIONS } from './types';
import type { Action, Bindings, Settings, SettingsPatch } from './types';

const ACTIONS: readonly Action[] = [...GAME_ACTIONS, 'pause'];
export const BINDINGS_VERSION = 2;

const NAMED_CODES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Escape', 'Space', 'ShiftLeft', 'ShiftRight']);

export function defaultBindings(): Bindings {
  return {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    softDrop: ['KeyS'],
    clockwise: ['ArrowUp', 'KeyX'],
    counterClockwise: ['KeyZ'],
    hardDrop: ['ArrowDown', 'Space'],
    hold: ['KeyC', 'ShiftLeft', 'ShiftRight'],
    pause: ['KeyP', 'Escape'],
  };
}

function readBindings(value: unknown): Bindings | null {
  if (!value || typeof value !== 'object') return null;
  const codes = new Set<string>();
  const result = defaultBindings();
  const candidate = value as Record<Action, unknown>;
  for (const action of ACTIONS) {
    const keys = candidate[action];
    if (!Array.isArray(keys) || !keys.length || keys.length > (action === 'hardDrop' ? 4 : 3)) return null;
    for (const code of keys) {
      if (typeof code !== 'string' || codes.has(code) ||
          (!NAMED_CODES.has(code) && !/^(Key[A-Z]|Digit[0-9])$/.test(code))) {
        return null;
      }
      codes.add(code);
    }
    result[action] = [...keys];
  }
  return result;
}

export function changeBinding(bindings: Bindings, action: Action, keys: string[]) {
  return readBindings({ ...bindings, [action]: keys });
}

function migrateDownBinding(bindings: Bindings): Bindings {
  if (!bindings.softDrop.includes('ArrowDown')) return bindings;
  const softDrop = bindings.softDrop.filter(key => key !== 'ArrowDown');
  if (!softDrop.length) {
    const used = new Set(Object.values(bindings).flat());
    const candidates = ['KeyS', ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', letter => `Key${letter}`)];
    const available = candidates.find(key => !used.has(key));
    if (available) softDrop.push(available);
  }
  return { ...bindings, softDrop, hardDrop: ['ArrowDown', ...bindings.hardDrop].slice(0, 4) };
}

export function readSettings(value: unknown, reduce: boolean, migrateLegacy = true): Settings {
  const settings: Partial<Settings> & { bindingsVersion?: number } = value && typeof value === 'object' ? value : {};
  const bindings = readBindings(settings.bindings) ?? defaultBindings();
  return {
    acceleratedFall: settings.acceleratedFall === true,
    difficulty: settings.difficulty === 'casual' || settings.difficulty === 'challenge'
      ? settings.difficulty
      : 'standard',
    sound: typeof settings.sound === 'boolean' ? settings.sound : true,
    volume: typeof settings.volume === 'number' && Number.isFinite(settings.volume)
      ? Math.min(1, Math.max(0, settings.volume))
      : 0.5,
    quality: settings.quality === 'high' || settings.quality === 'medium' || settings.quality === 'low'
      ? settings.quality
      : 'auto',
    reducedMotion: typeof settings.reducedMotion === 'boolean' ? settings.reducedMotion : reduce,
    ghost: typeof settings.ghost === 'boolean' ? settings.ghost : true,
    bindings: migrateLegacy && settings.bindingsVersion !== BINDINGS_VERSION ? migrateDownBinding(bindings) : bindings,
  };
}

export function applySettings(settings: Settings, patch: SettingsPatch) {
  return readSettings({ ...settings, ...patch }, settings.reducedMotion, false);
}
