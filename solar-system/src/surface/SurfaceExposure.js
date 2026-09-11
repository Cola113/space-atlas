// Accelerated eclipses can occupy just a few frames. Ease display brightness
// in real time without changing the ephemeris or the simulated eclipse.
export class SurfaceExposure {
  constructor() {
    this.value = null;
  }
  reset(target) {
    this.value = { brightness: target.brightness, stars: target.stars };
    return this.value;
  }
  update(target, elapsedSeconds) {
    if (!this.value) return this.reset(target);
    const blend = -Math.expm1(-Math.max(0, elapsedSeconds) / .4);
    for (const key of ['brightness', 'stars']) {
      this.value[key] += (target[key] - this.value[key]) * blend;
    }
    return this.value;
  }
}
