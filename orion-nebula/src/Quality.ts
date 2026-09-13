export const QUALITY_LEVELS = ['minimal', 'smooth', 'low', 'high'] as const;
export type ManualQuality = typeof QUALITY_LEVELS[number];
export type Quality = 'auto' | ManualQuality;
export const QUALITY_PRESETS = {
  high: { label: '精细', pixels: 1250000, ratio: 1.10, volumeSteps: 176, starSteps: 48, noiseLayers: 3, backgroundStars: 8000, selfShadow: true },
  low: { label: '节能', pixels: 480000, ratio: .85, volumeSteps: 96, starSteps: 48, noiseLayers: 3, backgroundStars: 8000, selfShadow: true },
  smooth: { label: '流畅', pixels: 240000, ratio: .65, volumeSteps: 48, starSteps: 16, noiseLayers: 2, backgroundStars: 3000, selfShadow: true },
  minimal: { label: '极简', pixels: 100000, ratio: .50, volumeSteps: 24, starSteps: 8, noiseLayers: 1, backgroundStars: 1000, selfShadow: false },
} as const;
export function isQuality(value: unknown): value is Quality {
  return value === 'auto' || QUALITY_LEVELS.includes(value as ManualQuality);
}

/** Aggregate complete one-second windows; no decisions from one isolated frame.
 * GPU work is represented by RAF elapsed time. Initialization, resizes and
 * lifecycle gaps must call exclude() so they never count as device performance.
 */
export class AutoQuality {
  mode: Quality = 'auto';
  current: ManualQuality = 'low';
  fps = 0;
  windows = 0;
  changes = 0;
  private elapsed = 0;
  private frames = 0;
  private slowSeconds = 0;
  private fastSeconds = 0;
  private excludedUntil = 0;
  private upgradeAfter = 0;
  private trial: { previous: ManualQuality; seconds: number } | null = null;

  setMode(mode: Quality, now: number) {
    this.mode = mode;
    this.current = mode === 'auto' ? 'low' : mode;
    this.trial = null;
    this.upgradeAfter = 0;
    this.fps = 0;
    this.exclude(now);
  }
  exclude(now: number, duration = 1200) {
    this.excludedUntil = now + duration;
    this.elapsed = this.frames = this.slowSeconds = this.fastSeconds = 0;
    if (this.trial) this.trial.seconds = 0;
  }
  private change(current: ManualQuality, now: number) {
    this.current = current;
    this.changes++;
    this.exclude(now);
    return current;
  }
  sample(ms: number, now: number): ManualQuality | null {
    if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(now) || now - ms + 1e-6 < this.excludedUntil) return null;
    this.elapsed += ms;
    this.frames++;
    if (this.elapsed < 1000 - 1e-6) return null;
    const seconds = this.elapsed / 1000;
    this.fps = this.frames / seconds;
    this.windows++;
    this.elapsed = this.frames = 0;
    if (this.mode !== 'auto') return null;
    if (this.trial) {
      if (this.fps < 55) {
        const previous = this.trial.previous;
        this.trial = null;
        this.upgradeAfter = now + 60000;
        return this.change(previous, now);
      }
      this.trial.seconds += seconds;
      if (this.trial.seconds >= 3 - 1e-6) this.trial = null;
      return null;
    }
    const level = QUALITY_LEVELS.indexOf(this.current);
    this.slowSeconds = this.fps < 50 ? this.slowSeconds + seconds : 0;
    this.fastSeconds = this.fps >= 58 ? this.fastSeconds + seconds : 0;
    if (level > 0 && (this.fps < 25 || this.slowSeconds >= 2 - 1e-6)) {
      return this.change(QUALITY_LEVELS[level - 1], now);
    }
    if (level < QUALITY_LEVELS.length - 1 && this.fastSeconds >= 20 - 1e-6 && now >= this.upgradeAfter) {
      this.trial = { previous: this.current, seconds: 0 };
      return this.change(QUALITY_LEVELS[level + 1], now);
    }
    return null;
  }
}
