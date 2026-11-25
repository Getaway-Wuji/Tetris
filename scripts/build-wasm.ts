import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import process from 'node:process';

const target = 'wasm32-unknown-unknown';
const build = spawnSync('cargo', [
  'build', '--locked', '--release',
  '--manifest-path', 'tetris-engine/Cargo.toml',
  '--target', target,
  '--target-dir', 'tetris-engine/target',
], { stdio: 'inherit' });

if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

mkdirSync('src/generated/tetris', { recursive: true });
copyFileSync(
  `tetris-engine/target/${target}/release/tetris_core.wasm`,
  'src/generated/tetris/tetris_core.wasm',
);
