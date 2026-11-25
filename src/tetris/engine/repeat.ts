import type { GameAction } from './types';

type RepeatAction = 'left' | 'right' | 'softDrop';

const FIRST_DELAY: Record<RepeatAction, number> = { left: 150, right: 150, softDrop: 40 };
const INTERVAL: Record<RepeatAction, number> = { left: 50, right: 50, softDrop: 40 };

interface Held {
  action: GameAction;
  nextAt: number;
}

function canRepeat(action: GameAction): action is RepeatAction {
  return action === 'left' || action === 'right' || action === 'softDrop';
}

export class HeldInput {
  private held = new Map<string, Held>();

  private latest(horizontal: boolean): Held | undefined {
    let latest: Held | undefined;
    for (const entry of this.held.values()) {
      if (canRepeat(entry.action) && (entry.action !== 'softDrop') === horizontal) latest = entry;
    }
    return latest;
  }

  press(source: string, action: GameAction, now: number) {
    if (this.held.has(source)) return false;
    this.held.set(source, { action, nextAt: canRepeat(action) ? now + FIRST_DELAY[action] : Infinity });
    return true;
  }

  release(source: string, now: number) {
    const removed = this.held.get(source);
    if (!removed) return;
    const horizontal = removed.action !== 'softDrop';
    const wasRepeating = this.latest(horizontal) === removed;
    this.held.delete(source);
    if (!wasRepeating) return;
    const replacement = this.latest(horizontal);
    if (replacement && canRepeat(replacement.action)) {
      replacement.nextAt = now + FIRST_DELAY[replacement.action];
    }
  }

  takeDue(now: number) {
    const horizontal = this.latest(true);
    const vertical = this.latest(false);
    // A stalled tab drops stale repeats rather than replaying a stream of old input.
    if (horizontal && horizontal.nextAt < now - 250) horizontal.nextAt = now;
    if (vertical && vertical.nextAt < now - 250) vertical.nextAt = now;
    const entry = horizontal && (!vertical || horizontal.nextAt <= vertical.nextAt) ? horizontal : vertical;
    if (!entry || entry.nextAt > now || !canRepeat(entry.action)) return null;
    const at = entry.nextAt;
    entry.nextAt = at + INTERVAL[entry.action];
    return { action: entry.action, at };
  }

  clear() {
    this.held.clear();
  }
}
