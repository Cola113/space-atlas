const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const durations = { approach: 2100, settling: 1300, departing: 850, retreating: 1500 };

// The orbit and surface renderers share one transition state. The panorama is
// never translated: only the orbit camera travels; the final shot settles by
// changing its direction and lens before controls are enabled.
export class SurfaceJourney {
  constructor(reducedMotion = false) {
    this.phase = 'preparing';
    this.elapsed = 0;
    this.reducedMotion = reducedMotion;
    this.skipRequested = false;
    this.retreatFrom = 1;
  }
  enter(phase) { this.phase = phase; this.elapsed = 0; }
  ready() {
    if (this.phase === 'preparing') this.enter(this.skipRequested || this.reducedMotion ? 'landed' : 'approach');
  }
  fail() { if (this.phase === 'preparing') this.enter('error'); }
  skip() {
    this.skipRequested = true;
    if (['approach','settling'].includes(this.phase)) this.enter('landed');
    else if (['departing','retreating'].includes(this.phase)) this.enter('closed');
  }
  exit() {
    if (['closed','departing','retreating'].includes(this.phase)) return;
    if (this.reducedMotion || ['preparing','error'].includes(this.phase)) this.enter('closed');
    else if (this.phase === 'approach') {
      this.retreatFrom = this.sample().orbit;
      this.enter('retreating');
    } else this.enter('departing');
  }
  tick(milliseconds) {
    let remaining = Math.max(0, milliseconds);
    while (durations[this.phase] && remaining > 0) {
      const duration = durations[this.phase], step = Math.min(remaining, duration - this.elapsed);
      this.elapsed += step; remaining -= step;
      if (this.elapsed >= duration) {
        this.enter({approach:'settling',settling:'landed',departing:'retreating',retreating:'closed'}[this.phase]);
      }
    }
    return this.sample();
  }
  sample() {
    const t = durations[this.phase] ? clamp(this.elapsed / durations[this.phase]) : 0;
    if (this.phase === 'approach') return {orbit:ease(t),cover:ease((t-.66)/.34),settle:0,surface:false};
    if (this.phase === 'settling') return {orbit:1,cover:1-ease(t/.65),settle:ease(t),surface:true};
    if (this.phase === 'landed') return {orbit:1,cover:0,settle:1,surface:true};
    if (this.phase === 'departing') return {orbit:1,cover:ease(t),settle:1-ease(t)*.8,surface:true};
    if (this.phase === 'retreating') return {orbit:this.retreatFrom*(1-ease(t)),cover:this.retreatFrom===1?1-ease(t/.6):0,settle:0,surface:false};
    return {orbit:0,cover:0,settle:0,surface:false};
  }
}
