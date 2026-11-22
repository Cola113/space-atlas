/**
 * Pure Web Audio API deep-space radio carrier + subtle harmonic skylark motif.
 * Synthesized locally with zero external copyrighted audio files.
 * Stays muted by default until explicitly toggled by the user.
 */
export function createSongbirdRadio({ onChange = () => {} } = {}) {
  let ctx = null;
  let master = null;
  let noiseSource = null;
  let droneOsc = null;
  let timer = 0;
  let playing = false;
  let disposed = false;

  const scheduleChirp = () => {
    if (!playing || !ctx || !master || ctx.state !== 'running') return;
    const now = ctx.currentTime + 0.06;
    // Ethereal 3-note skylark-inspired radio harmonic phrase (B5 -> E6 -> F#6 -> C#6)
    const phrase = [
      { offset: 0.0, f0: 1975, f1: 2637, dur: 0.22, gain: 0.036 },
      { offset: 0.26, f0: 2637, f1: 2960, dur: 0.16, gain: 0.03 },
      { offset: 0.48, f0: 2960, f1: 2217, dur: 0.34, gain: 0.032 },
      { offset: 1.05, f0: 2217, f1: 2637, dur: 0.28, gain: 0.024 },
    ];
    for (const note of phrase) {
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.f0, now + note.offset);
      osc.frequency.exponentialRampToValueAtTime(note.f1, now + note.offset + note.dur);

      // Gentle radio flutter / trilling vibrato
      lfo.type = 'sine';
      lfo.frequency.value = 18;
      lfoGain.gain.value = 18;
      lfo.connect(lfoGain).connect(osc.frequency);

      filter.type = 'bandpass';
      filter.frequency.value = 2350;
      filter.Q.value = 2.8;

      env.gain.setValueAtTime(0.0001, now + note.offset);
      env.gain.exponentialRampToValueAtTime(note.gain, now + note.offset + 0.035);
      env.gain.exponentialRampToValueAtTime(0.0001, now + note.offset + note.dur + 0.18);

      osc.connect(filter).connect(env).connect(master);
      osc.start(now + note.offset);
      lfo.start(now + note.offset);
      osc.stop(now + note.offset + note.dur + 0.22);
      lfo.stop(now + note.offset + note.dur + 0.22);
    }
    timer = window.setTimeout(scheduleChirp, 4600);
  };

  function start() {
    if (disposed || playing) return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') void ctx.resume();

      master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.65);

      // Soft stereo delay for vast vacuum-radio depth
      const delay = ctx.createDelay(0.8);
      delay.delayTime.value = 0.34;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.36;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      master.connect(ctx.destination);
      master.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(ctx.destination);

      // Subtle narrowband deep-space carrier static
      const length = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * 0.45;
      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      const staticFilter = ctx.createBiquadFilter();
      staticFilter.type = 'bandpass';
      staticFilter.frequency.value = 1850;
      staticFilter.Q.value = 6.0;
      const staticGain = ctx.createGain();
      staticGain.gain.value = 0.012;
      noiseSource.connect(staticFilter).connect(staticGain).connect(master);
      noiseSource.start();

      // Very quiet warm sub-carrier hum (A3 / 220 Hz)
      droneOsc = ctx.createOscillator();
      droneOsc.type = 'sine';
      droneOsc.frequency.value = 220;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.014;
      droneOsc.connect(droneGain).connect(master);
      droneOsc.start();

      playing = true;
      scheduleChirp();
      onChange(true);
      return true;
    } catch {
      stop();
      return false;
    }
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
    const wasPlaying = playing;
    playing = false;
    try { noiseSource?.stop(); } catch { /* already stopped */ }
    try { droneOsc?.stop(); } catch { /* already stopped */ }
    noiseSource = null;
    droneOsc = null;
    if (ctx) {
      const closing = ctx;
      ctx = null;
      master = null;
      void closing.close().catch(() => {});
    }
    if (wasPlaying) onChange(false);
  }

  const handleVisibility = () => {
    if (document.hidden && playing) stop();
  };
  document.addEventListener('visibilitychange', handleVisibility);

  return {
    start,
    stop,
    toggle() {
      if (playing) { stop(); return false; }
      return start();
    },
    isPlaying: () => playing,
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    },
  };
}
