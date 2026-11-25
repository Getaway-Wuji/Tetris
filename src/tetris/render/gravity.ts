export type GravitySample = ({ acceleration: number } | { intervalMs: number }) & {
  elapsedMs: number;
  advancedRows: number;
  sampledAt: number | null;
  rows: number;
};

export function gravityOffset(sample: GravitySample | undefined, now: number) {
  if (!sample) return 0;
  const age = sample.elapsedMs + (sample.sampledAt === null ? 0 : Math.max(0, now - sample.sampledAt));
  // A delayed game tick can cross a row boundary between frames. The last
  // confirmed landing is the upper limit on how far the cushion may be drawn.
  const distance = 'acceleration' in sample ? 0.5 * sample.acceleration * age * age : age / sample.intervalMs;
  const offset = distance - sample.advancedRows;
  return Math.min(sample.rows, Math.max(0, offset));
}

export function gravityContactTime(sample: GravitySample) {
  if (sample.sampledAt === null) return null;
  const distance = sample.advancedRows + sample.rows;
  const ageAtContact = 'acceleration' in sample ? Math.sqrt(2 * distance / sample.acceleration) : distance * sample.intervalMs;
  return sample.sampledAt + Math.max(0, ageAtContact - sample.elapsedMs);
}

export function gravityContactSpeed(sample: GravitySample) {
  return 'acceleration' in sample
    ? Math.sqrt(2 * sample.acceleration * (sample.advancedRows + sample.rows))
    : 1 / sample.intervalMs;
}
