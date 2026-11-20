// Synthesised truck sounds: a V6 engine, tyres on gravel, tyre scrub, knocks and splashes.
// All Web Audio, no samples. Call start() from a user gesture.

export class TruckSound {
  ctx = null;
  #out; #engine = []; #engineFilter; #engineGain; #rumble; #rumbleGain; #scrubGain; #scrubFilter;
  #noise; #volume = 0.8; #splashGain;
  #muffle; #bubbleBus; #curve; #remoteBus; #remoteMuffle; #remotes = new Map(); #bubbleTime = 0; #burst = 0; #lastT = 0;

  async start() {
    if (this.ctx) return this.ctx.resume();
    const ctx = (this.ctx = new AudioContext());
    this.#out = ctx.createGain();
    this.#out.gain.value = this.#volume;
    const comp = ctx.createDynamicsCompressor();
    // Under water everything is heard through a low-pass (see update()).
    this.#muffle = ctx.createBiquadFilter();
    this.#muffle.type = 'lowpass';
    this.#muffle.frequency.value = 18000;
    this.#muffle.Q.value = 0.7;
    this.#out.connect(this.#muffle).connect(comp).connect(ctx.destination);
    // Bubbles are in the water with the listener: not muffled, only softened.
    const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 2600;
    this.#bubbleBus = ctx.createGain(); this.#bubbleBus.gain.value = 0.5;
    this.#bubbleBus.connect(bf).connect(comp);
    // Other players' engines: their own bus, muffled only when the camera is
    // under water (each one also dulls when its own truck is in the water).
    this.#remoteMuffle = ctx.createBiquadFilter();
    this.#remoteMuffle.type = 'lowpass';
    this.#remoteMuffle.frequency.value = 18000;
    this.#remoteBus = ctx.createGain();
    this.#remoteBus.gain.value = this.#volume;
    this.#remoteBus.connect(this.#remoteMuffle).connect(comp);

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
    this.#curve = curve;
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
    if (this.#remoteBus) this.#remoteBus.gain.value = v;
  }

  get volume() { return this.#volume; }

  /**
   * How much of what we hear comes through water, 0..1: the truck (the
   * source) in the water muffles it partly, the camera (the listener) under
   * the surface fully.
   * @param {number} submerged   vehicle.submerged (0..1; afloat about 0.4)
   * @param {number} camDepth    camera depth below the surface (m, negative above)
   */
  static underwater(submerged, camDepth = -1) {
    const src = Math.min(1, Math.max(0, submerged / 0.35));
    const cam = Math.min(1, Math.max(0, (camDepth + 0.05) / 0.3));
    return Math.max(0.75 * src, cam);
  }

  /** Once per frame. */
  update(vehicle, camDepth = -1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - this.#lastT));
    this.#lastT = t;
    const under = TruckSound.underwater(vehicle.submerged, camDepth);
    this.#muffle.frequency.setTargetAtTime(18000 * Math.pow(420 / 18000, under), t, 0.08);
    // Bubbles: a burst when the truck goes in, then a trickle, more while paddling.
    if (vehicle.submerged > 0.1) {
      const paddle = vehicle.engineOn === false ? 0 : vehicle.pedal;
      const rate = 1.5 + 9 * paddle + 30 * this.#burst;
      this.#bubbleTime -= dt * rate;
      while (this.#bubbleTime < 0) { this.#bubble(t + Math.random() * 0.05); this.#bubbleTime += Math.random() * 1.6 + 0.2; }
    }
    this.#burst = Math.max(0, this.#burst - dt / 1.6);
    const k = 0.05;
    const rpm = vehicle.rpm;
    const fire = (rpm / 60) * 3; // V6 four-stroke: three firings per turn
    for (const { o, mult } of this.#engine) o.frequency.setTargetAtTime(fire * mult, t, k);
    const load = Math.max(vehicle.pedal, 0.12);
    this.#engineFilter.frequency.setTargetAtTime(180 + rpm * 0.35 * (0.5 + load), t, k);
    const drown = 1 - 0.6 * vehicle.submerged;
    // Water in the intake: the engine coughs more and more, then dies.
    const flood = vehicle.flood ?? 0;
    const cough = flood > 0.55 && Math.random() < (flood - 0.55) * 0.9 ? 0.12 : 1;
    const run = vehicle.engineOn === false ? 0 : Math.min(1, rpm / 300);
    this.#engineGain.gain.setTargetAtTime((0.1 + 0.22 * load + rpm / 30000) * drown * cough * run, t, k);

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
    if (fx.splash > 0) { this.knock(fx.splash, true); this.#plunge(fx.splash); fx.splash = 0; }
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
    else if (kind === 'goal') this.#fanfare(false);
    else if (kind === 'goal-first') this.#fanfare(true);
    // Someone else crossed the line: a short bright two-note call.
    else if (kind === 'other-goal') { tone(784, 0, 0.25, 0.18, 'square'); tone(1175, 0.12, 0.5, 0.18, 'square'); }
    // The rainbow star: a sweep up and a bright chord.
    else if (kind === 'rainbow') {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(1760, t + 0.55);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g).connect(this.#out);
      o.start(t); o.stop(t + 0.75);
      [659, 831, 988, 1319, 1661].forEach((f, i) => tone(f, 0.5 + i * 0.03, 0.9, 0.12, 'square'));
    }
    // A star: picked up (a quick rising sparkle).
    else if (kind === 'star') [784, 988, 1175, 1568, 1976, 2349].forEach((f, i) => tone(f, i * 0.05, 0.35, 0.16, 'sine'));
    // A star falling out of the sky: a soft falling whistle.
    else if (kind === 'fall') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1900, t);
      o.frequency.exponentialRampToValueAtTime(380, t + 2.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.4);
      g.gain.linearRampToValueAtTime(0.0, t + 2.2);
      o.connect(g).connect(this.#out);
      o.start(t);
      o.stop(t + 2.3);
    }
    // ... and landing: a soft low thump with a shimmer.
    else if (kind === 'land') { tone(110, 0, 0.5, 0.35, 'sine'); tone(1568, 0.02, 0.6, 0.06, 'sine'); tone(2093, 0.06, 0.6, 0.05, 'sine'); }
  }

  // --- the goal fanfare --------------------------------------------------

  /**
   * Our own fanfare: a rising run, two chords, a timpani roll into a big
   * held chord with a cymbal, bells on top. `first` (winning a race) adds a
   * second wave and holds it longer.
   */
  #fanfare(first) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.03;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.#out);
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    // Brass: two detuned saws through a low-pass that opens with the attack.
    const brass = (midi, at, dur, vol = 0.1) => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(500, at);
      f.frequency.linearRampToValueAtTime(4200, at + 0.06);
      f.frequency.exponentialRampToValueAtTime(1800, at + Math.min(dur, 0.5));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.03);
      g.gain.setValueAtTime(vol * 0.85, at + Math.max(0.05, dur - 0.12));
      g.gain.exponentialRampToValueAtTime(0.001, at + dur + 0.25);
      f.connect(g).connect(out);
      for (const d of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(midi);
        o.detune.value = d;
        // A little vibrato on the long notes.
        if (dur > 0.8) {
          const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
          const lg = ctx.createGain(); lg.gain.setValueAtTime(0, at); lg.gain.linearRampToValueAtTime(9, at + 0.6);
          lfo.connect(lg).connect(o.detune); lfo.start(at); lfo.stop(at + dur + 0.3);
        }
        o.connect(f);
        o.start(at);
        o.stop(at + dur + 0.3);
      }
    };
    const chord = (notes, at, dur, vol) => notes.forEach((m) => brass(m, at, dur, vol));
    // Timpani: a low sine that drops a little, with a soft noise thud.
    const timp = (midi, at, vol = 0.5) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(hz(midi) * 1.08, at);
      o.frequency.exponentialRampToValueAtTime(hz(midi), at + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      o.connect(g).connect(out);
      o.start(at); o.stop(at + 0.65);
    };
    const noiseHit = (at, dur, type, freq, vol) => {
      const src = ctx.createBufferSource();
      src.buffer = this.#noise;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      src.connect(f).connect(g).connect(out);
      src.start(at, Math.random()); src.stop(at + dur + 0.05);
    };
    const bell = (midi, at, vol = 0.07) => {
      for (const [mult, v] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz(midi) * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol * v, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + 1.6 / mult);
        o.connect(g).connect(out);
        o.start(at); o.stop(at + 1.7);
      }
    };

    let t = t0;
    // 1. A run up the scale.
    [60, 64, 67, 72, 76].forEach((m, i) => brass(m, t + i * 0.085, 0.14, 0.22));
    t += 0.5;
    // 2. Two chords, punched.
    chord([65, 69, 72, 77], t, 0.3, 0.13); timp(41, t, 0.8);
    t += 0.36;
    chord([67, 71, 74, 79], t, 0.3, 0.13); timp(43, t, 0.8);
    t += 0.36;
    // 3. A timpani roll into...
    for (let i = 0; i < 8; i++) timp(36, t + i * 0.045, 0.3 + i * 0.06);
    t += 0.38;
    // 4. ... the big chord, a cymbal, and bells over the top.
    const hold = first ? 2.6 : 1.9;
    chord([48, 55, 60, 64, 67, 72, 76], t, hold, 0.1);
    timp(36, t, 1.0);
    noiseHit(t, 2.4, 'highpass', 5000, 0.35);
    noiseHit(t, 0.4, 'bandpass', 1800, 0.25);
    [84, 88, 91, 96].forEach((m, i) => bell(m, t + 0.1 + i * 0.12, 0.12));
    if (first) {
      // Winning: the bells climb again and a last chord lifts a step up.
      [88, 91, 96, 100, 103].forEach((m, i) => bell(m, t + 0.9 + i * 0.1, 0.1));
      chord([50, 57, 62, 66, 69, 74, 78], t + hold - 0.2, 1.8, 0.09);
      timp(38, t + hold - 0.2, 0.6);
      noiseHit(t + hold - 0.2, 2.2, 'highpass', 6000, 0.3);
    }
  }

  // --- super armour: a quick, bright arpeggio loop while it lasts ---------

  #rainbowTimer = null;
  #rainbowNext = 0;
  #rainbowStep = 0;

  /** Start (true) or stop (false) the rainbow loop. */
  rainbow(on) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) { clearInterval(this.#rainbowTimer); this.#rainbowTimer = null; return; }
    if (this.#rainbowTimer) return;
    // Our own little loop: four chords, each arpeggiated up and down in 16ths.
    const chords = [[69, 73, 76, 81], [66, 69, 73, 78], [62, 66, 69, 74], [64, 68, 71, 76]]; // A, F#m, D, E
    const order = [0, 1, 2, 3, 2, 1, 2, 3];
    const step = 60 / 168 / 4; // 16ths at 168 BPM
    this.#rainbowNext = ctx.currentTime + 0.05;
    this.#rainbowStep = 0;
    const play = (midi, at, len, vol, type) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      o.connect(g).connect(this.#out);
      o.start(at); o.stop(at + len + 0.02);
    };
    this.#rainbowTimer = setInterval(() => {
      while (this.#rainbowNext < ctx.currentTime + 0.25) {
        const i = this.#rainbowStep++;
        const chord = chords[Math.floor(i / 16) % 4];
        const note = chord[order[i % 8]] + (i % 16 >= 8 ? 12 : 0);
        play(note, this.#rainbowNext, step * 0.9, 0.07, 'square');
        if (i % 4 === 0) play(chord[0] - 24, this.#rainbowNext, step * 3.5, 0.09, 'triangle'); // a bass pulse
        this.#rainbowNext += step;
      }
    }, 60);
  }

  // --- other players' engines -------------------------------------------

  /** A smaller copy of our engine voice, placed in 3D at the other truck. */
  #remoteVoice() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.#curve;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 6;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 10000;
    filter.connect(shaper).connect(gain).connect(panner).connect(this.#remoteBus);
    const detune = (Math.random() - 0.5) * 60; // no two engines quite alike
    const osc = [['sawtooth', 1, 0.35], ['square', 0.5, 0.25], ['triangle', 0.25, 0.4]].map(([type, mult, g]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(filter);
      o.start();
      return { o, mult };
    });
    return { filter, gain, panner, osc, lastRpm: 800, load: 0.2 };
  }

  /**
   * Once per frame: other players' engines, heard from where their trucks are.
   * @param {Iterable<object>} others  { id, root, position, rpm, lastHeard (s) }
   * @param {THREE.Camera} camera     the listener
   * @param {number} camDepth         camera depth below the surface (m)
   * @param {function} water          (x, z) => water surface height
   */
  updateRemotes(others, camera, camDepth = -1, water = null) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, k = 0.06;
    // The listener: the camera.
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const L = ctx.listener;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.setTargetAtTime(e[12], t, 0.02); L.positionY.setTargetAtTime(e[13], t, 0.02); L.positionZ.setTargetAtTime(e[14], t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      L.setPosition(e[12], e[13], e[14]);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    const camUnder = TruckSound.underwater(0, camDepth);
    this.#remoteMuffle.frequency.setTargetAtTime(18000 * Math.pow(420 / 18000, camUnder), t, 0.08);

    const seen = new Set();
    const now = performance.now() / 1000;
    for (const r of others) {
      seen.add(r.id);
      let v = this.#remotes.get(r.id);
      if (!v) { v = this.#remoteVoice(); this.#remotes.set(r.id, v); }
      const p = r.position;
      if (v.panner.positionX) {
        v.panner.positionX.setTargetAtTime(p.x, t, 0.03); v.panner.positionY.setTargetAtTime(p.y, t, 0.03); v.panner.positionZ.setTargetAtTime(p.z, t, 0.03);
      } else v.panner.setPosition(p.x, p.y, p.z);
      const rpm = r.rpm || 0;
      // No pedal comes over the wire: rising revs sound like throttle.
      v.load += ((rpm > v.lastRpm + 5 ? 1 : 0.15) - v.load) * 0.1;
      v.lastRpm = rpm;
      const fire = (rpm / 60) * 3;
      for (const { o, mult } of v.osc) o.frequency.setTargetAtTime(Math.max(1, fire * mult), t, k);
      v.filter.frequency.setTargetAtTime(180 + rpm * 0.35 * (0.5 + v.load), t, k);
      const alive = r.root.visible && now - r.lastHeard < 3 && rpm > 300;
      const wet = water && water(p.x, p.z) - p.y > -0.2 ? 0.45 : 1; // their truck in the water
      v.gain.gain.setTargetAtTime(alive ? (0.1 + 0.22 * v.load + rpm / 30000) * wet : 0, t, 0.1);
    }
    for (const [id, v] of this.#remotes) {
      if (seen.has(id)) continue;
      v.gain.gain.setTargetAtTime(0, t, 0.05);
      for (const { o } of v.osc) o.stop(t + 0.3);
      setTimeout(() => v.panner.disconnect(), 500);
      this.#remotes.delete(id);
    }
  }

  /** For tests: the other players' engine voices now. */
  get remoteVoices() {
    return [...this.#remotes].map(([id, v]) => ({ id, gain: v.gain.gain.value, hz: v.osc[0].o.frequency.value }));
  }

  /** One bubble: a short sine whose pitch rises as it grows and pops. */
  #bubble(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = 260 + Math.random() * Math.random() * 1100;
    const len = 0.03 + Math.random() * 0.07;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.8), t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.18, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(this.#bubbleBus);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /** Going in: a deep gulp and a rush of bubbles. */
  #plunge(strength) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7 * strength, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(this.#bubbleBus);
    o.start(t);
    o.stop(t + 0.65);
    this.#burst = Math.min(1, 0.4 + strength);
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
