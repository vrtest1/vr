// A small heavy metal band in Web Audio: two distorted rhythm guitars (left and
// right), bass, drums, a lead guitar and a clean guitar. Plays the songs in
// songs.js. No samples; everything is synthesised.
import { SONGS, DRUMS } from './songs.js';
import { StringBank } from './strings.js';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1);
}
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** Turn a song into a flat, time-sorted list of events (times in steps). */
export function compile(song) {
  const S = song.steps;
  const bars = [];
  for (const part of song.parts) {
    const n = Math.max(part.gtr?.length ?? 0, part.clean?.length ?? 0, part.drums?.length ?? 0, part.lead?.length ?? 0);
    for (let i = 0; i < n; i++) bars.push({ gtr: part.gtr?.[i], lead: part.lead?.[i], clean: part.clean?.[i], drums: part.drums?.[i] ?? 'none' });
  }
  const events = [];
  const melodic = (track) => {
    // Flatten the track into one token list so holds can cross bar lines.
    const tokens = [];
    bars.forEach((b, bi) => {
      const bar = b[track];
      const t = bar ? bar.trim().split(/\s+/) : Array(S).fill('.');
      if (t.length !== S) throw new Error(`${song.en} ${track} bar ${bi + 1}: ${t.length} steps, expected ${S}`);
      tokens.push(...t);
    });
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === '-' || tok === '.') continue;
      let len = 1;
      while (i + len < tokens.length && tokens[i + len] === '-') len++;
      let name = tok, mode = 'chord', bend = null;
      if (track !== 'gtr') mode = 'single';
      if (name.includes('/')) [name, bend] = name.split('/');
      if (name.endsWith('m') && track === 'gtr') { mode = 'mute'; name = name.slice(0, -1); }
      else if (name.endsWith('s') && track === 'gtr') { mode = 'single'; name = name.slice(0, -1); }
      const ev = { step: i, len, track, note: midi(name), mode, bend: bend ? midi(bend) : null };
      events.push(ev);
      if (track === 'gtr') events.push({ ...ev, track: 'bass', note: ev.note - 12 });
    }
  };
  melodic('gtr');
  melodic('lead');
  melodic('clean');
  bars.forEach((b, bi) => {
    const pat = DRUMS[b.drums];
    if (!pat) throw new Error(`${song.en}: unknown drum pattern ${b.drums}`);
    for (const [voice, line] of Object.entries(pat)) {
      if (line.length !== S) throw new Error(`${song.en} drums ${b.drums}.${voice}: ${line.length} steps, expected ${S}`);
      for (let i = 0; i < S; i++) {
        const c = line[i];
        if (c === '.') continue;
        const v = voice === 't' ? `t${c}` : voice;
        events.push({ step: bi * S + i, track: 'drum', voice: v, accent: c === 'X' });
      }
    }
  });
  events.sort((a, b) => a.step - b.step);
  return { events, totalSteps: bars.length * S, bars: bars.length };
}

// ---------------------------------------------------------------------------

function distortionCurve(amount) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Asymmetric soft clip: a little even-harmonic warmth like a valve amp.
    c[i] = Math.tanh(amount * x + 0.15 * amount * x * x * 0.3) / Math.tanh(amount);
  }
  return c;
}

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class MetalBand {
  ctx; out;
  #noise; #reverb; #rev; #g = {}; #lead;

  constructor(ctx, destination) {
    this.ctx = ctx;
    const out = (this.out = ctx.createGain());
    out.gain.value = 0.5;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -7; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.1;
    const trim = ctx.createGain(); trim.gain.value = 0.82; // drum transients get past the limiter's attack
    out.connect(glue).connect(limit).connect(trim).connect(destination);

    const len = ctx.sampleRate;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.#noise = nb;

    // Room.
    this.#reverb = ctx.createConvolver();
    this.#reverb.buffer = impulse(ctx, 2.6, 3);
    this.#rev = ctx.createGain();
    this.#rev.gain.value = 0.35;
    this.#rev.connect(this.#reverb).connect(out);

    // Rhythm guitars: one amp per side so the chord distorts together, like a real amp.
    for (const [side, pan] of [['L', -0.85], ['R', 0.85]]) this.#g[side] = this.#amp(pan, 9, 0.15); // -6 dB from the first mix
    this.#lead = this.#amp(0, 16, 0.19, true); // -2 dB
    // Bass and clean guitar buses.
    this.bass = ctx.createGain(); this.bass.gain.value = 0.4;
    const bassLp = ctx.createBiquadFilter(); bassLp.type = 'lowpass'; bassLp.frequency.value = 900;
    const bassDrive = ctx.createWaveShaper(); bassDrive.curve = distortionCurve(1.8);
    this.bass.connect(bassDrive).connect(bassLp).connect(out);
    this.clean = ctx.createGain(); this.clean.gain.value = 0.42;
    const cleanLp = ctx.createBiquadFilter(); cleanLp.type = 'lowpass'; cleanLp.frequency.value = 3200;
    // Chorus: a short modulated delay mixed in.
    const cd = ctx.createDelay(0.05); cd.delayTime.value = 0.012;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.8;
    const lg = ctx.createGain(); lg.gain.value = 0.003;
    lfo.connect(lg).connect(cd.delayTime); lfo.start();
    const cPanL = ctx.createStereoPanner(); cPanL.pan.value = -0.4;
    const cPanR = ctx.createStereoPanner(); cPanR.pan.value = 0.4;
    this.clean.connect(cleanLp);
    cleanLp.connect(cPanL).connect(out);
    cleanLp.connect(cd).connect(cPanR).connect(out);
    const cleanSend = ctx.createGain(); cleanSend.gain.value = 0.9;
    cleanLp.connect(cleanSend).connect(this.#rev);
    // Drum kit: its own bus with a punchy compressor and a short room.
    this.kit = ctx.createGain(); this.kit.gain.value = 1;
    const kitComp = ctx.createDynamicsCompressor();
    kitComp.threshold.value = -14; kitComp.ratio.value = 4; kitComp.attack.value = 0.008; kitComp.release.value = 0.12;
    this.drums = ctx.createGain(); this.drums.gain.value = 3.65; // +4 dB
    this.kit.connect(kitComp).connect(this.drums).connect(out);
    this.room = ctx.createGain(); this.room.gain.value = 0.5;
    const roomVerb = ctx.createConvolver(); roomVerb.buffer = impulse(ctx, 0.7, 4);
    this.room.connect(roomVerb).connect(this.drums);
    this.strings = new StringBank(ctx);
  }

  /** Amp + cabinet chain; returns its input node. */
  /**
   * Amp and speaker cabinet; returns its input node. Two gain stages with a
   * filter between them, as in a valve amp: the first adds a mid push and
   * softens the pick, the second does the real distortion, and the high cut in
   * between keeps it from turning into the fizzy, "synth" kind of distortion.
   */
  #amp(pan, drive, level, lead = false) {
    const ctx = this.ctx;
    const bq = (type, f, q = 0.7, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b; };
    const input = ctx.createGain();
    const tight = bq('highpass', lead ? 220 : 120);
    const push = bq('peaking', lead ? 900 : 750, 0.8, lead ? 7 : 5); // the overdrive pedal in front
    const g1 = ctx.createGain(); g1.gain.value = drive * 0.35;
    const s1 = ctx.createWaveShaper(); s1.curve = distortionCurve(1.4); s1.oversample = '2x';
    const between = bq('lowpass', 6500, 0.5);
    const g2 = ctx.createGain(); g2.gain.value = lead ? 4.2 : 3.4;
    const s2 = ctx.createWaveShaper(); s2.curve = distortionCurve(lead ? 2.6 : 2.2); s2.oversample = '4x';
    // Cabinet: a 4x12 has a low thump, a dip in the low mids, a presence peak,
    // and almost nothing above 5 kHz (that steep cut is most of the "real amp" sound).
    const cab = [
      bq('highpass', 80, 0.7),
      bq('peaking', 115, 1.2, 3),
      bq('peaking', lead ? 600 : 420, 1, lead ? 1 : -4),
      bq('peaking', lead ? 1700 : 2300, 1.4, lead ? 5 : 3.5),
      bq('lowpass', lead ? 5000 : 4600, 0.9),
      bq('lowpass', lead ? 5400 : 5000, 0.6),
      bq('notch', 7600, 2),
    ];
    const gain = ctx.createGain(); gain.gain.value = level;
    const panner = ctx.createStereoPanner(); panner.pan.value = pan;
    let node = input.connect(tight).connect(push).connect(g1).connect(s1).connect(between).connect(g2).connect(s2);
    for (const f of cab) node = node.connect(f);
    node.connect(gain).connect(panner).connect(this.out);
    const send = ctx.createGain(); send.gain.value = lead ? 0.5 : 0.12;
    gain.connect(send).connect(this.#rev);
    if (lead) {
      // Dotted-eighth echo for the solos (time set per song).
      const dl = ctx.createDelay(2); dl.delayTime.value = 0.45;
      const fb = ctx.createGain(); fb.gain.value = 0.28;
      const wet = ctx.createGain(); wet.gain.value = 0.22;
      gain.connect(dl); dl.connect(fb).connect(dl); dl.connect(wet).connect(panner);
      this.leadDelay = dl;
    }
    return input;
  }

  // --- instruments --------------------------------------------------------

  #play(buffer, t, dest, { gain = 1, end = null, release = 0.03, detune = 0, bite = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.detune.setValueAtTime(detune + bite, t);
    if (bite) src.detune.setTargetAtTime(detune, t + 0.005, 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    const stopAt = end === null ? t + buffer.duration : Math.min(t + buffer.duration, end + release * 4);
    if (end !== null) g.gain.setTargetAtTime(0, end, release);
    src.connect(g).connect(dest);
    src.start(t);
    src.stop(stopAt + 0.02);
    return src;
  }

  /** Render every string a song needs before it starts. */
  prepare(events) {
    for (const e of events) {
      if (e.track === 'gtr') {
        const kind = e.mode === 'mute' ? 'mute' : 'open';
        for (const n of e.mode === 'chord' ? [e.note, e.note + 7, e.note + 12] : [e.note]) { this.strings.get(n, kind, 0); this.strings.get(n, kind, 1); }
      } else if (e.track === 'bass') this.strings.get(e.note, e.mode === 'mute' ? 'bassMute' : 'bass', 0);
      else if (e.track === 'lead') this.strings.get(e.note, 'lead', 0);
      else if (e.track === 'clean') this.strings.get(e.note, 'clean', 0);
    }
  }

  /** Rhythm guitar: plucked strings (root, fifth, octave), down-strummed. */
  rhythm(t, dur, note, mode, side, offset) {
    t += offset;
    const take = side === 'L' ? 0 : 1;
    const muted = mode === 'mute';
    const strings = mode === 'chord' ? [note, note + 7, note + 12] : [note];
    const end = muted ? t + Math.min(dur, 0.2) : t + dur;
    strings.forEach((n, i) => {
      const b = this.strings.get(n, muted ? 'mute' : 'open', take);
      // Strum: each string a few milliseconds after the one below; slightly human timing.
      const at = t + i * (muted ? 0.003 : 0.008) + (Math.random() - 0.5) * 0.008;
      // The two guitarists are never exactly in tune with each other, nor picking equally hard.
      const tune = side === 'L' ? -3 : 4;
      const hard = 0.85 + Math.random() * 0.3;
      this.#play(b, at, this.#g[side], { gain: (muted ? 0.75 : 0.55) * (i === 0 ? 1 : 0.8) * hard, end, release: muted ? 0.02 : 0.035, detune: tune, bite: muted ? 6 : 12 });
    });
  }

  bassNote(t, dur, note, mode) {
    const muted = mode === 'mute';
    const b = this.strings.get(note, muted ? 'bassMute' : 'bass', 0);
    this.#play(b, t, this.bass, { gain: 1.1, end: muted ? t + Math.min(dur, 0.2) : t + dur, release: 0.04 });
  }

  leadNote(t, dur, note, bend) {
    const ctx = this.ctx;
    const src = this.#play(this.strings.get(note, 'lead', 0), t, this.#lead, { gain: 0.9, end: t + dur, release: 0.05, bite: 15 });
    // Bend: push the pitch up the way a finger does (quick, then settling).
    if (bend !== null) src.detune.setTargetAtTime((bend - note) * 100, t + Math.min(0.1, dur * 0.25), 0.045);
    if (dur > 0.35) {
      // Finger vibrato on held notes, coming in after the note settles.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.3;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(0, t + Math.min(dur * 0.4, 0.3));
      depth.gain.linearRampToValueAtTime(25, t + Math.min(dur, 0.8));
      lfo.connect(depth).connect(src.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.3);
    }
  }

  cleanNote(t, note) {
    this.#play(this.strings.get(note, 'clean', 0), t, this.clean, { gain: 0.8 });
  }

  // --- drums ----------------------------------------------------------------

  #noiseHit(t, { hp = 0, lp = 0, bp = 0, q = 1, level, decay, attack = 0, dest = this.kit, rev = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    let node = src;
    for (const [type, f] of [['highpass', hp], ['lowpass', lp], ['bandpass', bp]]) {
      if (!f) continue;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      node.connect(fl); node = fl;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(attack ? 0 : level, t);
    if (attack) g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    node.connect(g).connect(dest);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(this.room); }
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  #tone(t, f0, f1, sweep, level, decay, type = 'sine', rev = 0, dest = this.kit) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g).connect(dest);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(this.room); }
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /** Cymbal metal: six detuned square waves at inharmonic ratios, band-passed. */
  #metal(t, base, level, decay, hp, rev = 0) {
    const ctx = this.ctx;
    const mix = ctx.createGain(); mix.gain.value = 1 / 6;
    for (const r of [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r * (1 + (Math.random() - 0.5) * 0.004);
      o.connect(mix);
      o.start(t); o.stop(t + decay + 0.05);
    }
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hp * 1.4; bp.Q.value = 0.6;
    const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(level * 0.3, t + decay * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    mix.connect(bp).connect(h).connect(g).connect(this.kit);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(this.room); }
  }

  drum(t, voice, accent) {
    const a = accent ? 1.12 : 0.95 + Math.random() * 0.1; // a drummer never hits twice the same
    switch (voice) {
      case 'k':
        // Shell thump, beater click, a bit of skin.
        this.#tone(t, 120, 48, 0.05, 1.0 * a, 0.32, 'sine', 0.05);
        this.#tone(t, 260, 90, 0.02, 0.35 * a, 0.06, 'triangle');
        this.#noiseHit(t, { bp: 3200, q: 0.8, level: 0.55 * a, decay: 0.018 });
        break;
      case 's':
        // Two head modes, the crack, and the wires underneath that ring on.
        this.#tone(t, 210, 180, 0.04, 0.55 * a, 0.12, 'sine', 0.3);
        this.#tone(t, 340, 300, 0.03, 0.3 * a, 0.08, 'sine', 0.3);
        this.#noiseHit(t, { bp: 1800, q: 0.7, level: 0.7 * a, decay: 0.09, rev: 0.4 });
        this.#noiseHit(t, { hp: 3500, level: 0.55 * a, decay: 0.24, rev: 0.45 });
        break;
      case 'h':
        this.#metal(t, 400, 0.22 * a, 0.06, 7000);
        this.#noiseHit(t, { hp: 9000, level: 0.12 * a, decay: 0.04 });
        break;
      case 'o':
        this.#metal(t, 400, 0.2 * a, 0.45, 6500);
        this.#noiseHit(t, { hp: 8000, level: 0.1, decay: 0.35 });
        break;
      case 'r':
        this.#metal(t, 520, 0.16 * a, 1.1, 5000, 0.1);
        this.#noiseHit(t, { hp: 9000, level: 0.05, decay: 0.15 });
        break;
      case 'c':
        this.#metal(t, 340, 0.45 * a, 2.6, 3800, 0.3);
        this.#noiseHit(t, { hp: 5000, level: 0.35 * a, decay: 2.2, attack: 0.004, rev: 0.3 });
        break;
      case 't1': this.#tone(t, 200, 150, 0.15, 0.85, 0.4, 'sine', 0.3); this.#noiseHit(t, { bp: 1500, level: 0.2, decay: 0.05 }); break;
      case 't2': this.#tone(t, 150, 110, 0.18, 0.9, 0.45, 'sine', 0.3); this.#noiseHit(t, { bp: 1200, level: 0.2, decay: 0.05 }); break;
      case 't3': this.#tone(t, 105, 75, 0.22, 0.95, 0.55, 'sine', 0.3); this.#noiseHit(t, { bp: 900, level: 0.2, decay: 0.06 }); break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------

/** Plays the songs in order, looping the list. */
export class MetalBGM {
  ctx = null;
  band = null;
  playing = false;
  index = 0;
  onchange = null; // (song | null) => void
  #compiled = []; #timer = null; #start = 0; #cursor = 0; #song = null; #comp = null; #volume = 0.55; #fadeEnd = 0;

  get songs() { return SONGS; }
  get current() { return this.playing ? SONGS[this.index] : null; }

  #lp = null; #lpGain = null; #under = 0;

  /** 0 = dry, 1 = heard from under the water: dull and a little quieter. */
  setUnderwater(amount, now = false) {
    this.#under = amount;
    if (!this.#lp) return;
    const t = this.ctx.currentTime, k = now ? 0 : 0.1;
    const f = 20000 * Math.pow(380 / 20000, amount);
    if (now) { this.#lp.frequency.value = f; this.#lpGain.gain.value = 1 - 0.3 * amount; return; }
    this.#lp.frequency.setTargetAtTime(f, t, k);
    this.#lpGain.gain.setTargetAtTime(1 - 0.3 * amount, t, k);
  }

  set volume(v) { this.#volume = v; if (this.band) this.band.out.gain.value = v; }
  get volume() { return this.#volume; }

  /** Call from a user gesture. */
  async play(index = this.index) {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // Heard through water when the truck is in it (see setUnderwater).
      this.#lp = this.ctx.createBiquadFilter();
      this.#lp.type = 'lowpass';
      this.#lp.Q.value = 0.7;
      this.#lpGain = this.ctx.createGain();
      this.#lp.connect(this.#lpGain).connect(this.ctx.destination);
      this.band = new MetalBand(this.ctx, this.#lp);
      this.setUnderwater(this.#under, true);
      this.band.out.gain.value = this.#volume;
      this.#compiled = SONGS.map(compile);
    }
    await this.ctx.resume();
    this.stop(false);
    this.index = ((index % SONGS.length) + SONGS.length) % SONGS.length;
    this.#song = SONGS[this.index];
    this.#comp = this.#compiled[this.index];
    this.band.prepare(this.#comp.events);
    this.#start = Math.max(this.ctx.currentTime + 0.15, this.#fadeEnd);
    this.#cursor = 0;
    this.band.leadDelay.delayTime.value = (60 / this.#song.bpm) * 0.75;
    this.playing = true;
    this.#timer = setInterval(() => this.#schedule(), 40);
    this.#schedule();
    this.onchange?.(this.#song);
  }

  next() { return this.play(this.index + 1); }

  stop(notify = true) {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.playing && this.band) {
      // Fade out what is already scheduled.
      const g = this.band.out.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.3);
      g.setValueAtTime(this.#volume, t + 0.6);
      this.#fadeEnd = t + 0.6; // the next song starts after the fade
    }
    this.playing = false;
    if (notify) this.onchange?.(null);
  }

  #stepTime(step) {
    const s = this.#song;
    const dur = 60 / s.bpm / (s.steps / 4);
    return this.#start + step * dur + (step % 2 === 1 ? s.swing * dur : 0);
  }

  #schedule() {
    const { events, totalSteps } = this.#comp;
    const horizon = this.ctx.currentTime + 0.25;
    const band = this.band;
    while (this.#cursor < events.length) {
      const e = events[this.#cursor];
      const t = this.#stepTime(e.step);
      if (t > horizon) break;
      this.#cursor++;
      if (t < this.ctx.currentTime - 0.05) continue; // fell behind (tab was hidden)
      const dur = e.len ? this.#stepTime(e.step + e.len) - t : 0;
      switch (e.track) {
        case 'gtr':
          band.rhythm(t, dur, e.note, e.mode, 'L', 0);
          band.rhythm(t, dur, e.note, e.mode, 'R', 0.007);
          break;
        case 'bass': band.bassNote(t, dur, e.note, e.mode); break;
        case 'lead': band.leadNote(t, dur, e.note, e.bend); break;
        case 'clean': band.cleanNote(t, e.note); break;
        case 'drum': band.drum(t, e.voice, e.accent); break;
        default: break;
      }
    }
    if (this.#cursor >= events.length && this.ctx.currentTime > this.#stepTime(totalSteps) + 1.5) this.next();
  }
}
