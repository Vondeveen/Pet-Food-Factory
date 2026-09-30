// Tiny synthesized sound effects — no audio files needed.
let ctx = null;
let master = null;
let noiseBuf = null;
export let muted = false;

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function env(node, t, a, peak, dur) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + a);
  node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function noise(dur, freq, q, peak = 0.8, type = 'bandpass', sweepTo = null) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.005, peak, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, type = 'sine', peak = 0.3, slideTo = null, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  env(g, t, 0.01, peak, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  squelch(combo = 0) {
    noise(0.25, 900, 3, 0.9, 'bandpass', 250);
    tone(180, 0.15, 'sine', 0.35, 70);
    tone(520 + Math.min(combo, 20) * 40, 0.12, 'triangle', 0.15, null, 0.05);
  },
  golden() {
    [880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, null, i * 0.06));
  },
  wrong() {
    tone(160, 0.35, 'sawtooth', 0.25, 90);
    noise(0.3, 400, 1, 0.6, 'lowpass', 150);
  },
  grind() {
    noise(0.6, 200, 2, 1, 'bandpass', 900);
    tone(70, 0.5, 'square', 0.2, 50);
  },
  flick() { noise(0.08, 2500, 2, 0.3, 'highpass'); },
  beep(high = false) { tone(high ? 880 : 440, high ? 0.4 : 0.15, 'square', 0.18); },
  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, null, i * 0.12));
  },
};
