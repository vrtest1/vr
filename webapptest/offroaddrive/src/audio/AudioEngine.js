import { Vector3 } from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';

const _p = new Vector3();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Procedural ambient sound with the Web Audio API. Nothing is loaded: every
 * layer is filtered noise or a short synthesised tone.
 *
 *   wind        band-passed noise; louder, brighter and gustier with wind speed
 *   waves       noise swelling in the rhythm of the sea, loud near the water
 *   rain        hissing noise that follows precipitation
 *   underwater  low rumble and bubbles while the camera is below the surface;
 *               everything from above is muffled
 *
 * It listens to the WorldEnvironment and the camera height only, so it works
 * with or without the other engines.
 *
 * Browsers only allow sound after a user gesture: call start() from a click
 * or key handler.
 */
export class AudioEngine extends BaseEngine {
  static engineName = 'AudioEngine';

  static parameterSchema = {
    volume: { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, group: 'Mix', label: 'master volume' },
    wind: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Mix' },
    waves: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Mix' },
    rain: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Mix' },
    underwater: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Mix' },
    bubbles: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Mix' },
    waterReach: { type: 'number', default: 120, min: 5, max: 2000, step: 1, group: 'Mix', label: 'sea audible up to (m)' },
  };

  /** bubbles: synthesised bubble tones; gusts: slow random wind swells. */
  static qualityPresets = {
    ultra: { bubbles: true, gusts: true },
    high: { bubbles: true, gusts: true },
    medium: { bubbles: true, gusts: true },
    low: { bubbles: false, gusts: false },
  };

  /** The AudioContext (null until start()). */
  context = null;
  /** True while the camera of the last update() was below the water surface. */
  submerged = false;

  #nodes = null;
  #fallbackEnv = null;
  #waterHeight;
  #waterProximity;
  #groundHeight;
  #shoreTimer = 0;
  #shoreTarget = 0;
  #shore = null;
  #time = 0;
  #gust = 0;
  #gustTarget = 0;
  #gustTimer = 0;
  #bubbleTimer = 0;
  #levels = { wind: 0, waves: 0, rain: 0, underwater: 0 };

  /**
   * @param {function} [options.waterHeight] `(x, z) => y` of the water surface at the listener
   * @param {function} [options.groundHeight] `(x, z) => y` of the ground (e.g.
   *   `(x, z) => terrain.getHeightAt(x, z)`). With it the waves are loud on a
   *   sea shore, a quiet wash out at sea, and nearly silent on a lake or inland.
   * @param {function} [options.waterProximity] `(position) => 0..1`, how present the sea is
   *   (1 = at the shore). Defaults to a falloff with height above the water.
   * @param {AudioContext} [options.context] use an existing context
   */
  constructor(options = {}) {
    super(options);
    this.#waterHeight = options.waterHeight ?? null;
    this.#waterProximity = options.waterProximity ?? null;
    this.#groundHeight = options.groundHeight ?? null;
    this.context = options.context ?? null;
  }

  /** True once start() has run and the context is producing sound. */
  get running() {
    return !!this.#nodes && this.context.state === 'running';
  }

  /**
   * Create the audio graph and start playing. Must be called from a user
   * gesture (click, key, touch) the first time. Safe to call again.
   */
  async start() {
    if (this.disposed) return this;
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) throw new Error('AudioEngine: Web Audio is not available in this browser');
    this.context ??= new Ctx();
    if (!this.#nodes) this.#build();
    if (this.context.state !== 'running') await this.context.resume();
    this.ready = true;
    return this;
  }

  /** Pause all sound (keeps the graph; start() resumes). */
  async stop() {
    if (this.context?.state === 'running') await this.context.suspend();
    return this;
  }

  /** An AnalyserNode on the final output, for meters or tests. */
  get analyser() {
    return this.#nodes?.analyser ?? null;
  }

  update(deltaTime, camera) {
    if (!this.#nodes || this.disposed) return;
    const env = this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
    const n = this.#nodes;
    const p = this.params;
    const q = this.qualitySettings;
    const ctx = this.context;
    const now = ctx.currentTime;
    const dt = Math.max(deltaTime, 0);
    this.#time += dt;

    camera.updateMatrixWorld();
    _p.setFromMatrixPosition(camera.matrixWorld);
    const surface = this.#waterHeight ? this.#waterHeight(_p.x, _p.z) : env.waterLevel;
    const height = _p.y - surface;
    this.submerged = height < 0;
    const depth = Math.max(-height, 0);
    let near = Math.exp(-Math.max(height, 0) / (p.waterReach * 0.35));
    if (this.#waterProximity) {
      near = clamp(this.#waterProximity(_p), 0, 1);
    } else if (this.#groundHeight) {
      // Looking at the ground around the listener a few times a second is plenty.
      this.#shoreTimer -= dt;
      if (this.#shoreTimer <= 0 || this.#shore === null) {
        this.#shoreTarget = this.#surfAt(_p.x, _p.z, env.waterLevel);
        this.#shoreTimer = 0.3;
        if (this.#shore === null) this.#shore = this.#shoreTarget;
      }
      this.#shore += (this.#shoreTarget - this.#shore) * Math.min(1, dt * 1.5);
      near *= this.#shore;
    }

    // Gusts: the wind level wanders around its mean every few seconds.
    if (q.gusts) {
      this.#gustTimer -= dt;
      if (this.#gustTimer <= 0) {
        this.#gustTarget = Math.random() * 2 - 1;
        this.#gustTimer = 1.5 + Math.random() * 4;
      }
      this.#gust += (this.#gustTarget - this.#gust) * Math.min(1, dt * 0.6);
    }

    const U = env.windSpeed;
    const above = this.submerged ? 0 : 1;
    const set = (param, value, tau = 0.15) => param.setTargetAtTime(value, now, tau);

    // Wind: quiet below 1 m/s, a roar by 25 m/s; pitch rises with speed.
    const windLevel = clamp(Math.pow(U / 22, 1.4), 0, 1.3) * (1 + 0.35 * this.#gust) * p.wind;
    set(n.windGain.gain, 0.5 * windLevel * above + 0.04 * windLevel * (1 - above));
    set(n.windBand.frequency, 260 + 38 * U + 120 * this.#gust * Math.min(U / 8, 1));
    set(n.windHigh.gain, 0.12 * clamp((U - 6) / 16, 0, 1) * (1 + 0.5 * this.#gust) * p.wind * above);

    // Waves: one swell per dominant wave period, sharper when the sea is rough.
    const peakLength = clamp(0.9 * U * U, 2, 400);
    const period = clamp(Math.sqrt((2 * Math.PI * peakLength) / 9.81), 2.2, 11);
    const phase = (this.#time / period) % 1;
    const swell = Math.pow(0.5 - 0.5 * Math.cos(phase * 2 * Math.PI), 1.6);
    const sea = clamp(0.25 + U / 14, 0, 1.2) * near * p.waves;
    set(n.waveGain.gain, sea * (0.18 + 0.5 * swell) * above, 0.25);
    set(n.waveBand.frequency, 500 + 900 * swell + 25 * U, 0.3);

    // Rain.
    set(n.rainGain.gain, 0.45 * Math.pow(env.precipitation, 0.8) * (env.temperature > 0.5 ? 1 : 0.15) * p.rain * above, 0.4);

    // Under water: the world above is muffled and a low rumble takes over.
    set(n.muffle.frequency, this.submerged ? clamp(700 - depth * 25, 220, 700) : 18000, 0.08);
    set(n.rumbleGain.gain, this.submerged ? (0.5 + 0.25 * clamp(U / 15, 0, 1)) * p.underwater : 0, 0.12);
    set(n.rumbleBand.frequency, clamp(160 - depth * 3, 70, 160));
    set(n.master.gain, p.volume, 0.05);

    // Bubbles: single ones now and then, a burst right after going under.
    if (q.bubbles && this.submerged && p.bubbles > 0) {
      this.#bubbleTimer -= dt;
      if (this.#bubbleTimer <= 0) {
        this.#bubble(now, 0.5 + Math.random() * 0.5);
        this.#bubbleTimer = (0.15 + Math.random() * 1.6) / p.bubbles;
      }
    }
    if (this.submerged && !this.#levels.wasSubmerged && q.bubbles) {
      for (let i = 0; i < 14; i++) this.#bubble(now + 0.03 + Math.random() * 0.9, 0.6 + Math.random() * 0.6);
    }
    this.#levels.wasSubmerged = this.submerged;
    this.#levels.wind = windLevel;
    this.#levels.waves = sea;
    this.#levels.rain = env.precipitation;
    this.#levels.underwater = this.submerged ? 1 : 0;
  }

  /**
   * How much of the sound of waves belongs at a place, 0..1. Waves are heard
   * where they break: on a shore, with open water behind it. Out at sea
   * there is only a quiet wash, and a lake hardly makes a sound.
   */
  #surfAt(x, z, waterLevel) {
    const wet = (px, pz) => (this.#groundHeight(px, pz) < waterLevel - 0.15 ? 1 : 0);
    // Close by: is there both land and water? Far off: is the water open?
    let close = wet(x, z), open = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      close += wet(x + c * 30, z + s * 30) + wet(x + c * 90, z + s * 90);
      open += wet(x + c * 400, z + s * 400) + wet(x + c * 1200, z + s * 1200);
    }
    close /= 17;
    open = clamp((open / 16 - 0.08) / 0.22, 0, 1);
    const shore = clamp(4 * close * (1 - close) * 1.3, 0, 1);
    return shore * open + 0.22 * close * (1 - shore) * open + 0.1 * shore * (1 - open);
  }

  getStats() {
    return {
      state: this.context ? this.context.state : 'not started',
      submerged: this.submerged ? 'yes' : 'no',
      wind: this.#levels.wind,
      sea: this.#levels.waves,
    };
  }

  _applyParameters() {}
  _applyQuality() {}

  _dispose() {
    if (this.#nodes) {
      for (const source of this.#nodes.sources) {
        try { source.stop(); } catch { /* already stopped */ }
      }
      this.#nodes.master.disconnect();
      this.#nodes = null;
    }
    this.context?.close?.();
    this.context = null;
  }

  // --- internals ----------------------------------------------------------

  /** Looping noise buffers: white, and "brown" (random walk) for low rumble. */
  #noiseBuffer(seconds, brown) {
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    // Crossfade the ends so the loop point cannot be heard.
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[length - fade + i] * (1 - t);
    }
    return buffer;
  }

  #build() {
    const ctx = this.context;
    const sources = [];
    const noise = (buffer, offset) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.loopEnd = buffer.duration - 0.25;
      s.start(0, offset);
      sources.push(s);
      return s;
    };
    const filter = (type, frequency, Q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = Q;
      return f;
    };
    const gain = (value = 0) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };

    const white = this.#noiseBuffer(5, false);
    const brown = this.#noiseBuffer(7, true);

    const master = gain(0);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    // Everything that happens above the surface goes through one low-pass
    // filter, which closes when the listener goes under.
    const muffle = filter('lowpass', 18000, 0.5);
    muffle.connect(master);

    const windBand = filter('bandpass', 400, 0.6);
    const windGain = gain();
    noise(brown, 0).connect(windBand).connect(windGain).connect(muffle);
    const windHigh = gain(); // the whistle of strong wind
    noise(white, 1.3).connect(filter('bandpass', 2400, 2.5)).connect(windHigh).connect(muffle);

    const waveBand = filter('bandpass', 700, 0.5);
    const waveGain = gain();
    noise(white, 2.1).connect(waveBand).connect(waveGain).connect(muffle);

    const rainGain = gain();
    noise(white, 3.7).connect(filter('highpass', 2500)).connect(rainGain).connect(muffle);

    const rumbleBand = filter('lowpass', 140, 0.9);
    const rumbleGain = gain();
    noise(brown, 2.9).connect(rumbleBand).connect(rumbleGain).connect(master);

    this.#nodes = { sources, master, analyser, muffle, windBand, windGain, windHigh, waveBand, waveGain, rainGain, rumbleBand, rumbleGain };
  }

  /** One bubble: a sine that chirps upward as the bubble shrinks. */
  #bubble(when, size) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = 280 + 620 * (1 - size) + Math.random() * 120;
    const length = 0.05 + 0.09 * size;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random() * 0.8), when + length);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.09 * this.params.bubbles * size, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, when + length);
    osc.connect(g).connect(this.#nodes.master);
    osc.start(when);
    osc.stop(when + length + 0.02);
  }
}
