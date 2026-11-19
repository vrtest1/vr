// Synthesised truck sounds: a V6 engine, tyres on gravel, tyre scrub, knocks and splashes.
// All Web Audio, no samples. Call start() from a user gesture.

export class TruckSound {
  ctx = null;
  #out; #engine = []; #engineFilter; #engineGain; #rumble; #rumbleGain; #scrubGain; #scrubFilter;
  #noise; #volume = 0.8; #splashGain;

  async start() {
    if (this.ctx) return this.ctx.resume();
    const ctx = (this.ctx = new AudioContext());
    this.#out = ctx.createGain();
    this.#out.gain.value = this.#volume;
    const comp = ctx.createDynamicsCompressor();
    this.#out.connect(comp).connect(ctx.destination);

    // White noise buffer shared by the noise voices.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.#noise = buf;
    const noise = () => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n; };

    // Engine: firing pulses (sawtooth) + sub harmonic + a little noise, through a throttle-dependent low-pass.
    this.#engineFilter = ctx.createBiquadFilter();
    this.#engineFilter.type = 'lowpass';
    this.#engineFilter.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    this.#engineGain = ctx.createGain();
    this.#engineGain.gain.value = 0;
    this.#engineFilter.connect(shaper).connect(this.#engineGain).connect(this.#out);
    for (const [type, mult, gain] of [['sawtooth', 1, 0.35], ['square', 0.5, 0.25], ['sawtooth', 1.5, 0.12], ['triangle', 0.25, 0.4]]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.#engineFilter);
      o.start();
      this.#engine.push({ o, mult });
    }
    const en = noise();
    const enf = ctx.createBiquadFilter(); enf.type = 'bandpass'; enf.frequency.value = 300; enf.Q.value = 0.8;
    const eng = ctx.createGain(); eng.gain.value = 0.08;
    en.connect(enf).connect(eng).connect(this.#engineFilter);

    // Rolling noise: low rumble that grows with speed and rough ground.
    const rn = noise();
    this.#rumble = ctx.createBiquadFilter(); this.#rumble.type = 'lowpass'; this.#rumble.frequency.value = 400;
    this.#rumbleGain = ctx.createGain(); this.#rumbleGain.gain.value = 0;
    rn.connect(this.#rumble).connect(this.#rumbleGain).connect(this.#out);

    // Scrub: tyres sliding on dirt (band-passed noise).
    const sn = noise();
    this.#scrubFilter = ctx.createBiquadFilter(); this.#scrubFilter.type = 'bandpass'; this.#scrubFilter.frequency.value = 900; this.#scrubFilter.Q.value = 0.7;
    this.#scrubGain = ctx.createGain(); this.#scrubGain.gain.value = 0;
    sn.connect(this.#scrubFilter).connect(this.#scrubGain).connect(this.#out);

    // Water swish.
    const wn = noise();
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 700;
    this.#splashGain = ctx.createGain(); this.#splashGain.gain.value = 0;
    wn.connect(wf).connect(this.#splashGain).connect(this.#out);
  }

  set volume(v) {
    this.#volume = v;
    if (this.#out) this.#out.gain.value = v;
  }

  get volume() { return this.#volume; }

  /** Once per frame. */
  update(vehicle) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const k = 0.05;
    const rpm = vehicle.rpm;
    const fire = (rpm / 60) * 3; // V6 four-stroke: three firings per turn
    for (const { o, mult } of this.#engine) o.frequency.setTargetAtTime(fire * mult, t, k);
    const load = Math.max(vehicle.pedal, 0.12);
    this.#engineFilter.frequency.setTargetAtTime(180 + rpm * 0.35 * (0.5 + load), t, k);
    const drown = 1 - 0.6 * vehicle.submerged;
    this.#engineGain.gain.setTargetAtTime((0.1 + 0.22 * load + rpm / 30000) * drown, t, k);

    const v = Math.abs(vehicle.speed);
    const fx = vehicle.fx;
    const onGround = vehicle.wheels.some((w) => w.contact);
    this.#rumble.frequency.setTargetAtTime(150 + v * 18, t, 0.1);
    this.#rumbleGain.gain.setTargetAtTime(onGround ? Math.min(0.5, v * 0.012 * (0.5 + fx.roughness)) : 0, t, 0.08);
    this.#scrubGain.gain.setTargetAtTime(onGround ? Math.min(0.45, fx.slip * 0.6) : 0, t, 0.04);
    this.#scrubFilter.frequency.setTargetAtTime(600 + v * 25, t, 0.1);
    this.#splashGain.gain.setTargetAtTime(vehicle.submerged > 0 ? Math.min(0.5, 0.1 + v * 0.05) : 0, t, 0.1);

    if (fx.impact > 1.5) this.knock(Math.min(1, fx.impact / 8));
    if (fx.crash > 1) { this.crash(fx.crash / 9); fx.crash = 0; }
    if (fx.splash > 0) { this.knock(fx.splash, true); fx.splash = 0; }
  }

  #lastCrash = 0;
  /** Two trucks colliding: a body thump, crumpling sheet metal, a ring, glass on hard hits. */
  crash(strength) {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.#lastCrash < 0.25) return;
    this.#lastCrash = ctx.currentTime;
    const t = ctx.currentTime;
    const k = Math.min(1, strength);
    const burst = (type, f, q, level, decay, offset = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = this.#noise;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + offset);
      g.gain.linearRampToValueAtTime(level, t + offset + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + decay);
      src.connect(fl).connect(g).connect(this.#out);
      src.start(t + offset, Math.random());
      src.stop(t + offset + decay + 0.05);
    };
    burst('lowpass', 160, 0.7, 1.2 * k, 0.35);                 // the body hit
    burst('bandpass', 1400, 1.2, 0.9 * k, 0.18);               // crunch
    burst('bandpass', 2600, 2, 0.5 * k, 0.12, 0.03);           // crumple
    burst('bandpass', 900, 3, 0.4 * k, 0.25, 0.06);
    // Panel ring: a few inharmonic partials.
    for (const [f, d] of [[187, 0.6], [433, 0.45], [691, 0.35], [1220, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * (0.95 + Math.random() * 0.1), t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12 * k, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(this.#out);
      o.start(t); o.stop(t + d + 0.05);
    }
    if (k > 0.6) for (let i = 0; i < 6; i++) burst('highpass', 5000 + Math.random() * 3000, 1, 0.25 * k, 0.05, 0.08 + i * 0.03 + Math.random() * 0.03); // glass
  }

  /** Countdown beeps and the goal fanfare. */
  chime(kind) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const tone = (f, at, dur, vol = 0.25, type = 'triangle') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(vol, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
      o.connect(g).connect(this.#out);
      o.start(t + at);
      o.stop(t + at + dur + 0.05);
    };
    if (kind === 'tick') tone(660, 0, 0.25);
    else if (kind === 'go') tone(1320, 0, 0.6, 0.3);
    else if (kind === 'goal') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, i === 3 ? 1.2 : 0.3, 0.28));
  }

  #lastKnock = 0;
  /** A thud (body hitting something) or a splash. */
  knock(strength, wet = false) {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.#lastKnock < 0.12) return;
    this.#lastKnock = ctx.currentTime;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = wet ? 1200 : 220 + 300 * strength;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (wet ? 0.9 : 0.35));
    src.connect(f).connect(g).connect(this.#out);
    src.start(t, Math.random());
    src.stop(t + 1);
  }
}
