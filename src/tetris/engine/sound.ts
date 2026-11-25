export type SoundCue = 'rotate' | 'land' | 'clear' | 'hold' | 'level' | 'over';

const PHRASES: Record<SoundCue, number[]> = {
  rotate: [415.3],
  land: [174.6, 261.6],
  clear: [466.2, 587.3, 698.5],
  hold: [329.6, 523.3],
  level: [523.3, 659.3, 784, 1046.5],
  over: [392, 329.6, 261.6],
};

export class GameSound {
  private context: AudioContext | undefined;

  unlock(): void {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      // Audio is optional on devices that restrict Web Audio.
    }
  }

  play(cue: SoundCue, volume: number): void {
    const context = this.context;
    if (!context || context.state !== 'running' || !volume) return;
    try {
      PHRASES[cue].forEach((note, index) => {
        const start = context.currentTime + index * 0.05;
        const length = cue === 'rotate' ? 0.065 : 0.16;
        const oscillator = context.createOscillator();
        oscillator.type = cue === 'land' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(note, start);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume * (cue === 'rotate' ? 0.025 : 0.09), start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + length);
        oscillator.connect(gain).connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + length);
      });
    } catch {
      // An interrupted audio context does not affect gameplay.
    }
  }

  dispose(): void {
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
  }
}
