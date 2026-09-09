export class SimulationClock {
  time = 0;
  speed = 1;
  paused = false;
  suspended = false;
  private previous: number | null = null;

  tick(now: number): number {
    const dt = this.previous === null ? 0 : Math.min(Math.max((now - this.previous) / 1000, 0), 0.05);
    this.previous = now;
    if (this.suspended) return 0;
    if (!this.paused) this.time += dt * this.speed;
    return dt;
  }

  setTime(time: number) {
    if (!Number.isFinite(time) || time < 0 || time > 1e12) throw new RangeError('Time must be between 0 and 1e12.');
    this.time = time;
  }

  setSuspended(suspended: boolean) {
    this.suspended = suspended;
    this.previous = null;
  }

  resetDelta() { this.previous = null; }
}
