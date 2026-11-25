import type { GameRecord } from './types';

export const STORAGE_KEYS = {
  settings: 'plush-tetris.settings.v1',
  active: 'plush-tetris.active.v1',
  history: 'plush-tetris.history.v1',
} as const;

export interface SavedGame {
  id: string;
  payload: string;
  completedAt?: string;
}

export interface Archive {
  records: GameRecord[];
  bestScore: number;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is GameRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GameRecord>;
  return typeof record.id === 'string' && record.id.length > 0 && isDate(record.completedAt)
    && isCount(record.score) && isCount(record.lines) && isCount(record.level) && record.level > 0
    && typeof record.elapsedMs === 'number' && Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0;
}

export function readArchive(value: unknown): Archive {
  const raw: Partial<Archive> = value && typeof value === 'object' ? value : {};
  const candidates = Array.isArray(raw.records) ? raw.records.filter(isRecord) : [];
  candidates.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const distinct = new Map<string, GameRecord>();
  let bestScore = isCount(raw.bestScore) ? raw.bestScore : 0;
  for (const record of candidates) {
    if (distinct.has(record.id)) continue;
    distinct.set(record.id, record);
    bestScore = Math.max(bestScore, record.score);
  }
  return { records: Array.from(distinct.values()).slice(0, 100), bestScore };
}

export function readSavedGame(value: unknown): SavedGame | null {
  if (!value || typeof value !== 'object') return null;
  const game = value as Partial<SavedGame>;
  if (typeof game.id !== 'string' || !game.id.length || game.id.length > 128 ||
      typeof game.payload !== 'string' || !game.payload.length || game.payload.length > 32_768) {
    return null;
  }
  return { id: game.id, payload: game.payload, completedAt: isDate(game.completedAt) ? game.completedAt : undefined };
}

export class GameStorage {
  constructor(private getStorage: () => Storage, private reportFailure: () => void) {}

  read(key: string): unknown {
    let saved: string | null;
    try {
      saved = this.getStorage().getItem(key);
    } catch {
      this.reportFailure();
      return null;
    }
    if (saved === null) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }

  write(key: string, value: unknown) {
    try {
      this.getStorage().setItem(key, JSON.stringify(value));
      return true;
    } catch {
      this.reportFailure();
      return false;
    }
  }

  remove(key: string) {
    try {
      this.getStorage().removeItem(key);
    } catch {
      this.reportFailure();
    }
  }
}
