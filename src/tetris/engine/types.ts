export type Point = [number, number];

export type Difficulty = 'casual' | 'standard' | 'challenge';

export type GameEvent =
  | { type: 'lock'; cells: Point[]; kind: number; group: number; drop: number }
  | { type: 'clear'; rows: number[]; cells: [number, number, number][]; groups?: number[] }
  | { type: 'hold' }
  | { type: 'level'; level: number };

export interface Snapshot {
  board: number[][];
  groups?: number[][];
  active: { kind: number; rotation: number; x: number; y: number; cells: Point[] } | null;
  ghost: Point[];
  hold: number;
  canHold: boolean;
  next: number[];
  difficulty: Difficulty;
  score: number;
  level: number;
  lines: number;
  elapsedMs: number;
  acceleratedFall: boolean;
  gravityAcceleration: number;
  gravityElapsedMs: number;
  gravityIntervalMs: number;
  gravityRows: number;
  gameOver: boolean;
  events: GameEvent[];
}

export interface TetrisCore {
  start(seed: number, difficulty: Difficulty, acceleratedFall: boolean): Snapshot;
  setAcceleratedFall(enabled: boolean): Snapshot;
  execute(action: GameAction): Snapshot;
  advance(milliseconds: number): Snapshot;
  save(): string;
  restore(payload: string): Snapshot | null;
}

export const GAME_ACTIONS = [
  'left', 'right', 'softDrop', 'clockwise', 'counterClockwise', 'hardDrop', 'hold',
] as const;

export type GameAction = typeof GAME_ACTIONS[number];
export type Action = GameAction | 'pause';
export type Bindings = Record<Action, string[]>;
export type Quality = 'auto' | 'high' | 'medium' | 'low';

export interface Settings {
  acceleratedFall: boolean;
  difficulty: Difficulty;
  sound: boolean;
  volume: number;
  quality: Quality;
  reducedMotion: boolean;
  ghost: boolean;
  bindings: Bindings;
}

export type SettingsPatch = Partial<Omit<Settings, 'bindings'>>;
export type Overlay = 'settings' | 'help' | 'history';
export type Phase = 'loading' | 'ready' | 'running' | 'paused' | 'over' | 'error';

export interface GameRecord {
  id: string;
  completedAt: string;
  score: number;
  lines: number;
  level: number;
  elapsedMs: number;
}

export interface SessionView {
  phase: Phase;
  overlay: Overlay | null;
  board: Snapshot | null;
  /** Monotonic wall-clock time matching the published board's gravity timers while running. */
  fallClock: number | null;
  gameId: string | null;
  events: GameEvent[];
  eventId: number;
  settings: Settings;
  records: GameRecord[];
  bestScore: number;
  storageAvailable: boolean;
  error: string | null;
}
