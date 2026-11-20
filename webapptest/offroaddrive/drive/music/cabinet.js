// A guitar speaker cabinet with a microphone in front of it, as an impulse
// response for a ConvolverNode: computed, no recording.
//
// A 4x12 cabinet's response is not a smooth curve. Besides the broad shape (a
// low thump from the closed box, a dip in the low mids, a presence peak, and a
// steep fall above 5 kHz), the paper cone breaks up into many small peaks and
// notches, and where the microphone stands moves them about. Those small
// irregularities are much of what makes a recorded amp sound real and not
// like a filter; so they are put in, from a seed (each guitar its own mic).
//
// Made as a minimum-phase response (by the cepstrum), like a real speaker's:
// all the energy at the start, no smear or pre-echo.

function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi;
        re[p] += vr; im[p] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** The cabinet's response in dB at frequency f (Hz). */
function shape(f, { lead, mic, bumps }) {
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-6));
  const oct = (a, b) => Math.log2(a / b);
  const bell = (fc, gain, width) => gain * Math.exp(-0.5 * (oct(f, fc) / width) ** 2);
  let g = 0;
  g += db(1 / Math.sqrt(1 + (75 / f) ** 4));                 // the closed box: nothing much below 75 Hz
  g += bell(110, 4, 0.35);                                   // its thump
  g += bell(lead ? 600 : 420, lead ? 0.5 : -3, 0.6);         // low-mid dip (the lead keeps its mids)
  g += bell(2400, 4.5, 0.55) + bell(4000, 2, 0.3);           // presence
  g += db(1 / Math.sqrt(1 + (f / 5200) ** 8));               // the steep top cut of a guitar speaker
  g -= mic * 3 * Math.max(0, oct(f, 1800));                  // off the cap: darker
  for (const b of bumps) g += bell(b.f, b.gain, b.width);   // cone break-up
  return g;
}

/**
 * @param {BaseAudioContext} ctx
 * @param {object} o
 * @param {number} o.seed  which microphone placement (each guitar its own)
 * @param {boolean} [o.lead]
 * @param {number} [o.mic] 0 = on the cap (bright) .. 1 = off axis (dark)
 */
export function cabinetIR(ctx, { seed = 1, lead = false, mic = 0.3 } = {}) {
  const N = 4096, rate = ctx.sampleRate;
  const r = rand(seed * 2654435761);
  // Cone break-up: a dozen small peaks and notches, mostly above 1 kHz.
  const bumps = [];
  for (let i = 0; i < 14; i++) {
    const f = 900 * Math.pow(2, r() * 2.9);  // 0.9 .. 6.7 kHz
    bumps.push({ f, gain: (r() * 2 - 1) * (f > 2000 ? 4 : 2.5), width: 0.04 + r() * 0.08 });
  }
  // Log magnitude per bin.
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= N / 2; k++) {
    const f = Math.max(10, (k * rate) / N);
    const lm = (shape(f, { lead, mic, bumps }) / 20) * Math.LN10;
    re[k] = lm;
    if (k > 0 && k < N / 2) re[N - k] = lm;
  }
  // Minimum phase: real cepstrum, fold onto the positive quefrencies, back.
  fft(re, im, true);
  for (let n = 1; n < N / 2; n++) { re[n] *= 2; re[N - n] = 0; im[n] = 0; im[N - n] = 0; }
  im[0] = 0; im[N / 2] = 0;
  fft(re, im);
  for (let k = 0; k < N; k++) {
    const m = Math.exp(re[k]);
    const p = im[k];
    re[k] = m * Math.cos(p); im[k] = m * Math.sin(p);
  }
  fft(re, im, true);
  // ~25 ms is plenty for a speaker; fade out the tail.
  const len = Math.min(N, Math.floor(rate * 0.025));
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = re[i] * (i > len * 0.7 ? 0.5 + 0.5 * Math.cos((Math.PI * (i - len * 0.7)) / (len * 0.3)) : 1);
  // Level: 0 dB at 1 kHz, like the filters it replaces.
  let sr = 0, si = 0;
  for (let i = 0; i < len; i++) { const a = (-2 * Math.PI * 1000 * i) / rate; sr += d[i] * Math.cos(a); si += d[i] * Math.sin(a); }
  const g1k = Math.hypot(sr, si) || 1;
  for (let i = 0; i < len; i++) d[i] /= g1k;
  return buf;
}
