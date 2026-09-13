import { simulationElapsed, simulationRates, defaultSimulationRate } from '../simulation-time.js';

// The date and selected real-time rate carry over from the orbit view.
// Hidden tabs and long stalls do not catch up on resume.
export class SurfaceClock {
  constructor(epoch, rate = defaultSimulationRate, onTimeChange) {
    this.epoch = typeof epoch === 'number' ? epoch : Date.parse(epoch);
    if (!Number.isFinite(this.epoch)) throw new RangeError('Invalid surface epoch');
    this.time = this.epoch;
    this.onTimeChange = onTimeChange;
    this.setRate(rate);
    this.playing = true;
    this.previous = null;
    this.canAdvance = () => true;
  }
  tick(now, active = true) {
    const elapsed = this.previous === null ? 0 : Math.max(0, now - this.previous);
    this.previous = active ? now : null;
    if (active && this.playing && elapsed > 0 && elapsed <= 1000) {
      const candidate = this.time + simulationElapsed(elapsed, this.rate);
      if (this.canAdvance(candidate)) {
        this.time = candidate;
        this.onTimeChange?.(this.time);
      } else this.previous = null;
    }
    return this.time;
  }
  setRate(rate) {
    if (!simulationRates.includes(rate))
      throw new RangeError('Unsupported surface rate');
    this.rate = rate;
  }
  setTime(time) {
    if (!Number.isFinite(time)) throw new RangeError('Invalid surface date');
    if (!this.canAdvance(time)) return false;
    this.time = time; this.previous = null; this.onTimeChange?.(this.time); return true;
  }
  reset() { return this.setTime(this.epoch); }
  suspend() { this.previous = null; }
}
