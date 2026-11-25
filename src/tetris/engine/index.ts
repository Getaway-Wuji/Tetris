import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DOMAttributes } from 'react';
import { TetrisSession } from './session';
import { GameSound } from './sound';
import type { Action } from './types';
import { loadTetrisCore } from './wasm';

export type {
  Action, Bindings, Difficulty, GameAction, GameEvent, GameRecord, Overlay, Phase, Point, Quality, Settings, Snapshot,
} from './types';

const INTERACTIVE = [
  'button', 'input', 'select', 'textarea', 'a[href]', 'summary',
  '[contenteditable]:not([contenteditable="false"])', '[role="button"]', '[role="dialog"]', 'dialog[open]',
].join(',');

function isInteractive(target: EventTarget | null) {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, '0')).join('');
}

function createSession() {
  const sound = new GameSound();
  const session = new TetrisSession({
    now: () => performance.now(),
    completedAt: () => new Date().toISOString(),
    newId,
    seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
    loadCore: loadTetrisCore,
    storage: () => window.localStorage,
    reduceMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    unlockSound: () => sound.unlock(),
    playSound: (cue, volume) => sound.play(cue, volume),
  });
  return { session, sound };
}

export function useTetris() {
  const [{ session, sound }] = useState(createSession);
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => {
    void session.load();
    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
          isInteractive(event.target)) return;
      if (session.keyDown(event.code, event.repeat)) event.preventDefault();
    }
    function keyUp(event: KeyboardEvent) {
      session.keyUp(event.code);
    }
    function visibility() {
      if (document.visibilityState === 'hidden') session.suspend();
    }
    function focus(event: FocusEvent) {
      if (isInteractive(event.target)) session.clearInputs();
    }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', session.suspend);
    window.addEventListener('pagehide', session.suspend);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', session.suspend);
      window.removeEventListener('pagehide', session.suspend);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focus);
      session.disconnect();
      sound.dispose();
    };
  }, [session, sound]);

  useEffect(() => {
    if (view.phase !== 'running') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') session.suspend();
      else session.tick();
    }, 25);
    return () => window.clearInterval(timer);
  }, [session, view.phase]);

  function touchHandlers(action: Action): DOMAttributes<HTMLButtonElement> {
    return {
      onPointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        session.press(action, `pointer:${event.pointerId}`);
      },
      onPointerUp(event) {
        session.release(`pointer:${event.pointerId}`);
      },
      onLostPointerCapture(event) {
        session.release(`pointer:${event.pointerId}`);
      },
      onPointerCancel: session.clearInputs,
      onContextMenu(event) {
        event.preventDefault();
      },
      onClick(event) {
        // Keyboard and assistive-technology clicks have no preceding pointer event.
        if (event.detail === 0) session.tap(action);
      },
    };
  }

  return {
    ...view,
    start: session.start,
    pause: session.pause,
    resume: session.resume,
    togglePause: session.togglePause,
    openOverlay: session.openOverlay,
    closeOverlay: session.closeOverlay,
    retry: session.load,
    patchSettings: session.patchSettings,
    rebind: session.rebind,
    resetBindings: session.resetBindings,
    touchHandlers,
  };
}
