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
  }
  tick(now, active = true) {
    const elapsed = this.previous === null ? 0 : Math.max(0, now - this.previous);
    this.previous = active ? now : null;
    if (active && this.playing && elapsed > 0 && elapsed <= 1000) {
      this.time += simulationElapsed(elapsed, this.rate);
      this.onTimeChange?.(this.time);
    }
    return this.time;
  }
  setRate(rate) {
    if (!simulationRates.includes(rate))
      throw new RangeError('Unsupported surface rate');
    this.rate = rate;
  }
  reset() { this.time = this.epoch; this.previous = null; this.onTimeChange?.(this.time); }
  suspend() { this.previous = null; }
}
