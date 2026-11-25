import { HeldInput } from './repeat';
import { applySettings, BINDINGS_VERSION, changeBinding, defaultBindings, readSettings } from './settings';
import { GameStorage, readArchive, readSavedGame, STORAGE_KEYS } from './storage';
import type { SavedGame } from './storage';
import type { SoundCue } from './sound';
import type {
  Action, GameAction, GameEvent, GameRecord, Overlay, SessionView, Settings, SettingsPatch, Snapshot, TetrisCore,
} from './types';

const SAVE_INTERVAL = 1000;

interface SessionOptions {
  now: () => number;
  completedAt: () => string;
  newId: () => string;
  seed: () => number;
  loadCore: () => Promise<TetrisCore>;
  storage: () => Storage;
  reduceMotion: () => boolean;
  unlockSound: () => void;
  playSound: (cue: SoundCue, volume: number) => void;
}

function activeChanged(previous: Snapshot | null, next: Snapshot) {
  const before = previous?.active;
  const after = next.active;
  return before?.kind !== after?.kind || before?.rotation !== after?.rotation
    || before?.x !== after?.x || before?.y !== after?.y;
}

function eventCue(events: GameEvent[]): SoundCue | undefined {
  if (events.some(event => event.type === 'level')) return 'level';
  if (events.some(event => event.type === 'clear')) return 'clear';
  if (events.some(event => event.type === 'lock')) return 'land';
  if (events.some(event => event.type === 'hold')) return 'hold';
}

export class TetrisSession {
  private listeners = new Set<() => void>();
  private store: GameStorage;
  private core: TetrisCore | null = null;
  private current: Snapshot | null = null;
  private held = new HeldInput();
  private time = 0;
  private lastSave = 0;
  private loadAttempt = 0;
  private resumeAfterOverlay = false;
  private view: SessionView = {
    phase: 'loading',
    overlay: null,
    board: null,
    fallClock: null,
    gameId: null,
    events: [],
    eventId: 0,
    settings: readSettings(null, false),
    records: [],
    bestScore: 0,
    storageAvailable: true,
    error: null,
  };

  constructor(private options: SessionOptions) {
    this.store = new GameStorage(options.storage, () => {
      if (this.view.storageAvailable) this.set({ storageAvailable: false });
    });
  }

  getSnapshot = () => this.view;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<SessionView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  load = async () => {
    const attempt = ++this.loadAttempt;
    const settings = readSettings(this.store.read(STORAGE_KEYS.settings), this.options.reduceMotion());
    const archive = readArchive(this.store.read(STORAGE_KEYS.history));
    this.set({ phase: 'loading', fallClock: null, error: null, settings, ...archive });
    try {
      const core = await this.options.loadCore();
      if (attempt !== this.loadAttempt) return;
      this.core = core;
      const saved = readSavedGame(this.store.read(STORAGE_KEYS.active));
      const restored = saved && !archive.records.some(record => record.id === saved.id)
        ? core.restore(saved.payload)
        : null;
      const enabled = this.view.settings.acceleratedFall;
      const retime = restored && !restored.gameOver && restored.acceleratedFall !== enabled;
      const snapshot = retime ? core.setAcceleratedFall(enabled) : restored;
      this.current = snapshot;
      this.set({
        phase: snapshot ? 'paused' : 'ready',
        gameId: snapshot ? saved!.id : null,
        board: snapshot,
        events: [],
        eventId: this.view.eventId + 1,
      });
      if (snapshot?.gameOver && saved) this.finish(snapshot, saved.completedAt);
      if (retime) this.save(this.options.now());
      if (!snapshot) this.store.remove(STORAGE_KEYS.active);
    } catch {
      if (attempt === this.loadAttempt) this.fail();
    }
  };

  disconnect = () => {
    ++this.loadAttempt;
    this.suspend();
  };

  start = (seed?: number) => {
    if (!this.core || this.view.phase === 'loading') return;
    try {
      const snapshot = this.core.start(
        (typeof seed === 'number' ? seed : this.options.seed()) >>> 0,
        this.view.settings.difficulty,
        this.view.settings.acceleratedFall,
      );
      this.held.clear();
      this.resumeAfterOverlay = false;
      this.time = this.options.now();
      this.current = snapshot;
      if (this.view.settings.sound) this.options.unlockSound();
      this.set({
        phase: 'running',
        overlay: null,
        board: snapshot,
        fallClock: this.time,
        gameId: this.options.newId(),
        events: [],
        eventId: this.view.eventId + 1,
      });
      this.save(this.time);
    } catch {
      this.fail();
    }
  };

  pause = () => {
    if (this.view.phase !== 'running') return;
    this.held.clear();
    this.tick();
    if (this.view.phase !== 'running') return;
    this.set({ phase: 'paused', board: this.current, fallClock: null });
    this.save(this.options.now());
  };

  resume = () => {
    if (this.view.phase !== 'paused' || this.view.overlay) return;
    this.held.clear();
    this.time = this.options.now();
    if (this.view.settings.sound) this.options.unlockSound();
    this.set({ phase: 'running', fallClock: this.time });
  };

  togglePause = () => {
    if (this.view.overlay) return;
    if (this.view.phase === 'running') this.pause();
    else this.resume();
  };

  suspend = () => {
    this.resumeAfterOverlay = false;
    this.held.clear();
    this.pause();
  };

  openOverlay = (overlay: Overlay) => {
    if (!this.view.overlay) this.resumeAfterOverlay = this.view.phase === 'running';
    this.pause();
    this.held.clear();
    this.set({ overlay });
  };

  closeOverlay = () => {
    if (!this.view.overlay) return;
    const shouldResume = this.resumeAfterOverlay;
    this.resumeAfterOverlay = false;
    this.set({ overlay: null });
    if (shouldResume) this.resume();
  };

  private updateSettings(settings: Settings) {
    this.set({ settings });
    this.store.write(STORAGE_KEYS.settings, { ...settings, bindingsVersion: BINDINGS_VERSION });
  }

  patchSettings = (patch: SettingsPatch) => {
    const previous = this.view.settings;
    const settings = applySettings(previous, patch);
    if (settings.sound && !previous.sound) this.options.unlockSound();
    this.updateSettings(settings);
    if (settings.acceleratedFall === previous.acceleratedFall) return;

    const now = this.options.now();
    this.tick(now);
    if (!this.core || (this.view.phase !== 'running' && this.view.phase !== 'paused')) return;
    try {
      this.refresh(this.core.setAcceleratedFall(settings.acceleratedFall));
      this.save(now);
    } catch {
      this.fail();
    }
  };

  rebind = (action: Action, keys: string[]) => {
    const bindings = changeBinding(this.view.settings.bindings, action, keys);
    if (!bindings) return false;
    this.held.clear();
    this.updateSettings({ ...this.view.settings, bindings });
    return true;
  };

  resetBindings = () => {
    this.held.clear();
    this.updateSettings({ ...this.view.settings, bindings: defaultBindings() });
  };

  keyDown = (code: string, repeated: boolean) => {
    if (this.view.overlay) return false;
    const action = (Object.keys(this.view.settings.bindings) as Action[])
      .find(candidate => this.view.settings.bindings[candidate].includes(code));
    if (!action) return false;
    if (action === 'pause') {
      if (this.view.phase !== 'paused' && this.view.phase !== 'running') return false;
      if (!repeated) this.togglePause();
      return true;
    }
    if (this.view.phase !== 'running') return false;
    if (!repeated) this.press(action, `key:${code}`);
    return true;
  };

  keyUp = (code: string) => this.release(`key:${code}`);

  press = (action: Action, source: string) => {
    if (this.view.overlay) return;
    if (action === 'pause') {
      this.togglePause();
      return;
    }
    if (this.view.phase !== 'running') return;
    const now = this.options.now();
    this.tick(now);
    if (this.view.phase === 'running' && this.held.press(source, action, now)) this.command(action);
  };

  tap = (action: Action) => {
    this.press(action, 'tap');
    this.release('tap');
  };

  release = (source: string) => {
    this.held.release(source, this.options.now());
  };

  clearInputs = () => {
    this.held.clear();
  };

  tick = (now = this.options.now()) => {
    if (this.view.phase !== 'running' || !this.core) return;
    try {
      let repeat = this.held.takeDue(now);
      while (repeat && this.view.phase === 'running') {
        this.advance(repeat.at);
        if (this.view.phase === 'running') this.command(repeat.action);
        repeat = this.held.takeDue(now);
      }
      if (this.view.phase !== 'running') return;
      this.advance(now);
      if (this.view.phase === 'running' && now - this.lastSave >= SAVE_INTERVAL) this.save(now);
    } catch {
      this.fail();
    }
  };

  private advance(now: number) {
    if (!this.core || now <= this.time) return;
    const elapsed = now - this.time;
    this.time = now;
    this.refresh(this.core.advance(elapsed));
  }

  private command(action: GameAction) {
    if (!this.core) return;
    try {
      const previous = this.current;
      const snapshot = this.core.execute(action);
      this.refresh(snapshot);
      if ((action === 'clockwise' || action === 'counterClockwise') &&
          snapshot.active?.rotation !== previous?.active?.rotation) this.play('rotate');
    } catch {
      this.fail();
    }
  }

  private refresh(raw: Snapshot) {
    const previous = this.current;
    const moved = activeChanged(previous, raw);
    const locked = raw.events.some(event => event.type === 'lock');
    const snapshot = {
      ...raw,
      board: previous && !locked ? previous.board : raw.board,
      groups: previous && !locked ? previous.groups : raw.groups,
      active: previous && !moved ? previous.active : raw.active,
      ghost: previous && !moved && !locked ? previous.ghost : raw.ghost,
      next: previous && !raw.next.some((kind, index) => kind !== previous.next[index]) ? previous.next : raw.next,
    };
    this.current = snapshot;
    if (snapshot.gameOver) {
      this.finish(snapshot);
      return;
    }
    const cue = eventCue(snapshot.events);
    if (cue) this.play(cue);
    const fallClock = this.view.phase === 'running' ? this.time : null;
    if (snapshot.events.length) {
      this.set({ board: snapshot, fallClock, events: snapshot.events, eventId: this.view.eventId + 1 });
    } else if (moved || this.view.board?.score !== snapshot.score ||
        this.view.board.acceleratedFall !== snapshot.acceleratedFall ||
        this.view.board.gravityAcceleration !== snapshot.gravityAcceleration ||
        this.view.board.gravityIntervalMs !== snapshot.gravityIntervalMs ||
        Math.floor((this.view.board?.elapsedMs ?? 0) / 1000) !== Math.floor(snapshot.elapsedMs / 1000)) {
      this.set({ board: snapshot, fallClock });
    }
  }

  private save(now: number, completedAt?: string) {
    if (!this.core || !this.view.gameId) return;
    const active: SavedGame = { id: this.view.gameId, payload: this.core.save(), completedAt };
    this.store.write(STORAGE_KEYS.active, active);
    this.lastSave = now;
  }

  private finish(snapshot: Snapshot, completedAt = this.options.completedAt()) {
    if (!this.view.gameId) return;
    this.held.clear();
    const record: GameRecord = {
      id: this.view.gameId,
      completedAt,
      score: snapshot.score,
      lines: snapshot.lines,
      level: snapshot.level,
      elapsedMs: snapshot.elapsedMs,
    };
    // Persist the final snapshot first so a dropped history write can be retried on restore.
    this.save(this.options.now(), completedAt);
    const stored = readArchive(this.store.read(STORAGE_KEYS.history));
    const archive = readArchive({
      records: [...stored.records, ...this.view.records, record],
      bestScore: Math.max(stored.bestScore, this.view.bestScore),
    });
    if (this.store.write(STORAGE_KEYS.history, archive)) {
      const active = readSavedGame(this.store.read(STORAGE_KEYS.active));
      if (active?.id === record.id) this.store.remove(STORAGE_KEYS.active);
    }
    if (this.view.phase === 'running') this.play('over');
    this.set({
      phase: 'over',
      board: snapshot,
      fallClock: null,
      events: snapshot.events,
      eventId: this.view.eventId + 1,
      ...archive,
    });
  }

  private play(cue: SoundCue) {
    if (this.view.settings.sound) this.options.playSound(cue, this.view.settings.volume);
  }

  private fail() {
    this.held.clear();
    this.core = null;
    this.set({ phase: 'error', fallClock: null, error: '游戏加载失败，请重试。' });
  }
}
