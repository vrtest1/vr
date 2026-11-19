// Plucked strings by the Karplus-Strong method, rendered once per note into an
// AudioBuffer and reused. A burst of filtered noise (the pick) circulates in a
// delay line one period long; a gentle low-pass in the loop takes the highs
// out faster than the lows, as on a real string.

const RATE = 22050; // enough for guitars behind a speaker cabinet; halves the memory

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/**
 * @param {number} f        frequency (Hz)
 * @param {object} o
 *   seconds   length of the buffer
 *   t60       time for the string to die away by 60 dB (s)
 *   bright    0..1, how bright the pick is (low-pass on the excitation)
 *   damp      0..1, extra low-pass in the loop (palm mute: high)
 *   pick      pick position along the string (0..0.5): comb-filters the excitation
 *   seed      noise seed (different takes for left and right)
 */
export function pluck(f, { seconds = 3, t60 = 3, bright = 0.6, damp = 0, pick = 0.15, seed = 1 } = {}) {
  const sr = RATE;
  const len = Math.floor(sr * seconds);
  const y = new Float32Array(len);
  // Loop delay: one period, less the half sample the averaging filter adds
  // (and a little more for the damping filter's delay).
  const D = sr / f - 0.5 - (damp > 0 ? damp / (1 - damp) : 0);
  const Ni = Math.max(2, Math.floor(D));
  // Per-period loss so the string falls 60 dB in t60 seconds.
  const g = Math.pow(0.001, 1 / Math.max(1, t60 * f));
  // Excitation: one period of noise, low-passed for brightness, comb for the pick position.
  const r = rand(seed);
  const exc = new Float32Array(Ni);
  let lp = 0;
  const a = 1 - bright * 0.9;
  for (let i = 0; i < Ni; i++) { lp = lp * a + r() * (1 - a); exc[i] = lp; }
  const p = Math.max(1, Math.floor(pick * Ni));
  for (let i = Ni - 1; i >= p; i--) exc[i] -= exc[i - p];
  let mean = 0;
  for (let i = 0; i < Ni; i++) mean += exc[i];
  mean /= Ni;
  let peak = 1e-9;
  for (let i = 0; i < Ni; i++) { exc[i] -= mean; peak = Math.max(peak, Math.abs(exc[i])); }
  for (let i = 0; i < Ni; i++) exc[i] /= peak;

  const frac = D - Math.floor(D);
  const di = Math.floor(D);
  let s = 0; // damping filter state
  for (let n = 0; n < len; n++) {
    let fb = 0;
    const k = n - di;
    if (k - 1 >= 0) {
      // y[n - D] and y[n - D - 1] by linear interpolation, averaged.
      const y0 = y[k] * (1 - frac) + y[k - 1] * frac;
      const y1 = y[k - 1] * (1 - frac) + (k - 2 >= 0 ? y[k - 2] : 0) * frac;
      fb = 0.5 * (y0 + y1) * g;
      if (damp > 0) { s = s * damp + fb * (1 - damp); fb = s; }
    }
    y[n] = (n < Ni ? exc[n] : 0) + fb;
  }
  // DC block and a short fade at the end.
  let px = 0, py = 0;
  for (let n = 0; n < len; n++) { const v = y[n] - px + 0.995 * py; px = y[n]; py = v; y[n] = v; }
  const fade = Math.min(len, Math.floor(sr * 0.05));
  for (let i = 0; i < fade; i++) y[len - 1 - i] *= i / fade;
  return { data: y, rate: sr };
}

/** Buffers per (note, kind, take), made on first use. */
export class StringBank {
  #ctx; #cache = new Map();
  static KINDS = {
    open: { seconds: 4, t60: 6, bright: 0.75, pick: 0.12 },
    mute: { seconds: 0.45, t60: 0.22, bright: 0.45, damp: 0.55, pick: 0.2 },
    lead: { seconds: 4.5, t60: 9, bright: 0.85, pick: 0.1 },
    bass: { seconds: 3, t60: 3.5, bright: 0.35, pick: 0.25 },
    bassMute: { seconds: 0.5, t60: 0.3, bright: 0.3, damp: 0.4, pick: 0.25 },
    clean: { seconds: 4, t60: 3.2, bright: 0.55, pick: 0.18 },
  };

  constructor(ctx) { this.#ctx = ctx; }

  get(note, kind, take = 0) {
    const key = `${note}|${kind}|${take}`;
    let b = this.#cache.get(key);
    if (!b) {
      const f = 440 * Math.pow(2, (note - 69) / 12);
      const { data, rate } = pluck(f, { ...StringBank.KINDS[kind], seed: note * 7919 + take * 104729 + kind.length * 31 });
      b = this.#ctx.createBuffer(1, data.length, rate);
      b.copyToChannel(data, 0);
      this.#cache.set(key, b);
    }
    return b;
  }
}
