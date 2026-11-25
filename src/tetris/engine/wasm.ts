import wasmUrl from '../../generated/tetris/tetris_core.wasm?url';
import { GAME_ACTIONS } from './types';
import type { Difficulty, Snapshot, TetrisCore } from './types';

const DIFFICULTY_CODES: Record<Difficulty, number> = { casual: 0, standard: 1, challenge: 2 };

interface CoreExports {
  memory: WebAssembly.Memory;
  tetris_new_with_difficulty(seed: number, difficulty: number): void;
  tetris_set_accelerated_fall(enabled: number): void;
  tetris_command(command: number): void;
  tetris_advance(milliseconds: number): void;
  tetris_save(): void;
  tetris_restore(length: number): number;
  tetris_input_ptr(length: number): number;
  tetris_output_ptr(): number;
  tetris_output_len(): number;
}

export async function loadTetrisCore(): Promise<TetrisCore> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`WASM HTTP ${response.status}`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  const wasm = instance.exports as unknown as CoreExports;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const read = () => decoder.decode(new Uint8Array(
    wasm.memory.buffer, wasm.tetris_output_ptr(), wasm.tetris_output_len(),
  ));
  const snapshot = (): Snapshot => JSON.parse(read());

  return {
    start(seed, difficulty, acceleratedFall) {
      wasm.tetris_new_with_difficulty(seed, DIFFICULTY_CODES[difficulty]);
      if (acceleratedFall) wasm.tetris_set_accelerated_fall(1);
      return snapshot();
    },
    setAcceleratedFall(enabled) {
      wasm.tetris_set_accelerated_fall(enabled ? 1 : 0);
      return snapshot();
    },
    execute(action) {
      wasm.tetris_command(GAME_ACTIONS.indexOf(action));
      return snapshot();
    },
    advance(milliseconds) {
      wasm.tetris_advance(milliseconds);
      return snapshot();
    },
    save() {
      wasm.tetris_save();
      return read();
    },
    restore(payload) {
      const bytes = encoder.encode(payload);
      const pointer = wasm.tetris_input_ptr(bytes.byteLength);
      if (!pointer) return null;
      new Uint8Array(wasm.memory.buffer, pointer, bytes.byteLength).set(bytes);
      return wasm.tetris_restore(bytes.byteLength) === 1 ? snapshot() : null;
    },
  };
}
