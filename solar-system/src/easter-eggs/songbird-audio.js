/**
 * Pure Web Audio API deep-space radio carrier + restrained harmonic skylark echo.
 * Synthesized locally with zero external copyrighted audio files.
 * Stays muted by default until explicitly toggled by the user.
 */
export function createSongbirdRadio({ onChange = () => {} } = {}) {
  let ctx = null;
  let master = null;
  let echoIn = null;
  let noiseSource = null;
  let droneOscA = null;
  let droneOscE = null;
  let lfoOsc = null;
  let timer = 0;
  let phraseIndex = 0;
  let playing = false;
  let disposed = false;

  // Three gentle A-minor / Dorian harmonic phrases in a comfortable mid-high
  // register (523–1175 Hz) so the signal reads like a distant deep-space radio
  // echo rather than a piercing high-frequency beep.
  const phrases = [
    [
      { offset: 0.0, f0: 659.25, f1: 783.99, dur: 0.48, gain: 0.028 },  // E5 -> G5
      { offset: 0.56, f0: 880.0, f1: 987.77, dur: 0.42, gain: 0.024 },  // A5 -> B5
      { offset: 1.12, f0: 987.77, f1: 783.99, dur: 0.68, gain: 0.022 }, // B5 -> G5
      { offset: 2.02, f0: 659.25, f1: 587.33, dur: 0.72, gain: 0.018 }, // E5 -> D5
    ],
    [
      { offset: 0.0, f0: 587.33, f1: 659.25, dur: 0.52, gain: 0.025 },  // D5 -> E5
      { offset: 0.62, f0: 783.99, f1: 880.0, dur: 0.58, gain: 0.024 },  // G5 -> A5
      { offset: 1.42, f0: 1174.66, f1: 987.77, dur: 0.74, gain: 0.019 },// D6 -> B5
    ],
    [
      { offset: 0.0, f0: 880.0, f1: 783.99, dur: 0.55, gain: 0.024 },   // A5 -> G5
      { offset: 0.74, f0: 659.25, f1: 783.99, dur: 0.48, gain: 0.022 }, // E5 -> G5
      { offset: 1.46, f0: 523.25, f1: 659.25, dur: 0.85, gain: 0.020 }, // C5 -> E5
    ],
  ];

  const schedulePhrase = () => {
    if (!playing || !ctx || !echoIn || ctx.state !== 'running') return;
    const now = ctx.currentTime + 0.08;
    const phrase = phrases[phraseIndex % phrases.length];
    phraseIndex += 1;

    for (const note of phrase) {
      const start = now + note.offset;
      const stopAt = start + note.dur + 0.65;

      const oscMain = ctx.createOscillator();
      const oscHarm = ctx.createOscillator();
      const harmGain = ctx.createGain();
      const vib = ctx.createOscillator();
      const vibGain = ctx.createGain();
      const toneFilter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      oscMain.type = 'sine';
      oscMain.frequency.setValueAtTime(note.f0, start);
      oscMain.frequency.exponentialRampToValueAtTime(note.f1, start + note.dur * 0.82);

      // Soft warm triangle overtone one octave down to round out the sine core
      oscHarm.type = 'triangle';
      oscHarm.frequency.setValueAtTime(note.f0 * 0.5, start);
      oscHarm.frequency.exponentialRampToValueAtTime(note.f1 * 0.5, start + note.dur * 0.82);
      harmGain.gain.value = 0.22;

      vib.type = 'sine';
      vib.frequency.value = 5.2;
      vibGain.gain.value = 3.2;
      vib.connect(vibGain).connect(oscMain.frequency);

      toneFilter.type = 'lowpass';
      toneFilter.frequency.value = 1550;
      toneFilter.Q.value = 1.1;

      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(note.gain, start + 0.14);
      env.gain.exponentialRampToValueAtTime(note.gain * 0.55, start + note.dur);
      env.gain.exponentialRampToValueAtTime(0.0001, start + note.dur + 0.58);

      oscMain.connect(toneFilter);
      oscHarm.connect(harmGain).connect(toneFilter);
      toneFilter.connect(env).connect(echoIn);

      oscMain.start(start);
      oscHarm.start(start);
      vib.start(start);
      oscMain.stop(stopAt);
      oscHarm.stop(stopAt);
      vib.stop(stopAt);
    }

    const nextPauseMs = 6200 + Math.round(Math.random() * 2600);
    timer = window.setTimeout(schedulePhrase, nextPauseMs);
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
      master.gain.exponentialRampToValueAtTime(0.85, ctx.currentTime + 0.75);
      master.connect(ctx.destination);

      // Warm dark-feedback delay line for distant vacuum-radio depth
      echoIn = ctx.createGain();
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.42;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 1150;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.34;
      const wet = ctx.createGain();
      wet.gain.value = 0.48;

      echoIn.connect(master);
      echoIn.connect(delay);
      delay.connect(damp);
      damp.connect(feedback);
      feedback.connect(delay);
      damp.connect(wet);
      wet.connect(master);

      // Gentle pink-tinted deep-space receiver floor noise
      const length = ctx.sampleRate * 3;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        channel[i] = (b0 + b1 + b2 + white * 0.018) * 0.55;
      }
      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      const staticFilter = ctx.createBiquadFilter();
      staticFilter.type = 'bandpass';
      staticFilter.frequency.value = 920;
      staticFilter.Q.value = 2.4;
      const staticGain = ctx.createGain();
      staticGain.gain.value = 0.011;
      noiseSource.connect(staticFilter).connect(staticGain).connect(master);
      noiseSource.start();

      // Subtle breathing open-fifth carrier bed (A2 110 Hz + E3 164.81 Hz)
      const droneBus = ctx.createGain();
      droneBus.gain.value = 0.0085;
      const droneLpf = ctx.createBiquadFilter();
      droneLpf.type = 'lowpass';
      droneLpf.frequency.value = 340;
      droneOscA = ctx.createOscillator();
      droneOscA.type = 'sine';
      droneOscA.frequency.value = 110;
      droneOscE = ctx.createOscillator();
      droneOscE.type = 'sine';
      droneOscE.frequency.value = 164.81;
      const eGain = ctx.createGain();
      eGain.gain.value = 0.45;
      lfoOsc = ctx.createOscillator();
      lfoOsc.type = 'sine';
      lfoOsc.frequency.value = 0.09;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.0025;
      lfoOsc.connect(lfoDepth).connect(droneBus.gain);

      droneOscA.connect(droneLpf);
      droneOscE.connect(eGain).connect(droneLpf);
      droneLpf.connect(droneBus).connect(master);
      droneOscA.start();
      droneOscE.start();
      lfoOsc.start();

      playing = true;
      phraseIndex = 0;
      schedulePhrase();
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
    const closing = ctx;
    const fading = master;
    const nSrc = noiseSource;
    const dA = droneOscA;
    const dE = droneOscE;
    const lfo = lfoOsc;
    ctx = null;
    master = null;
    echoIn = null;
    noiseSource = null;
    droneOscA = null;
    droneOscE = null;
    lfoOsc = null;

    if (closing) {
      const cleanup = () => {
        try { nSrc?.stop(); } catch { /* already stopped */ }
        try { dA?.stop(); } catch { /* already stopped */ }
        try { dE?.stop(); } catch { /* already stopped */ }
        try { lfo?.stop(); } catch { /* already stopped */ }
        void closing.close().catch(() => {});
      };
      if (fading && closing.state === 'running') {
        try {
          const now = closing.currentTime;
          fading.gain.cancelScheduledValues(now);
          fading.gain.setValueAtTime(Math.max(0.0001, fading.gain.value), now);
          fading.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
          window.setTimeout(cleanup, 190);
        } catch {
          cleanup();
        }
      } else {
        cleanup();
      }
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
