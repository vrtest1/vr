import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';
import { NOISE_GLSL } from '../core/shaders/noise.glsl.js';
import { OCEAN_VERT, OCEAN_FRAG } from './shaders/ocean.glsl.js';

const MAX_WAVES = 40;
const GRAVITY = 9.81;
const MIN_SPACING = 0.35; // metres between the innermost grid rings at sea level
const _p = new Vector3();

/** Small deterministic generator so the sea looks the same on every run. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ocean surface: wind-driven Gerstner waves on a camera-centred grid that
 * reaches the horizon, with sky reflection, sun glitter, whitecaps and, when a
 * seabed height function is supplied, shallow water and surf at the shore.
 *
 * It is lit by the lights already in the scene (the first DirectionalLight is
 * the sun, the first HemisphereLight the sky) and receives their shadows.
 */
export class OceanEngine extends BaseEngine {
  static engineName = 'OceanEngine';

  static parameterSchema = {
    // --- waves ---
    waveHeight: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Waves', label: 'wave height (x wind)' },
    choppiness: { type: 'number', default: 0.8, min: 0, max: 1.2, step: 0.01, group: 'Waves' },
    spread: { type: 'number', default: 0.55, min: 0, max: 1.5, step: 0.01, group: 'Waves', label: 'direction spread' },
    ripples: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Waves' },
    timeScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Waves', label: 'time scale' },
    seed: { type: 'int', default: 7, min: 0, max: 9999, step: 1, group: 'Waves' },
    // --- look ---
    deepColor: { type: 'color', default: '#123f52', group: 'Look' },
    shallowColor: { type: 'color', default: '#5cc2b0', group: 'Look' },
    scatterColor: { type: 'color', default: '#35d6b4', group: 'Look' },
    reflection: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Look', label: 'sky reflection' },
    clarity: { type: 'number', default: 5, min: 0.5, max: 60, step: 0.1, group: 'Look', label: 'clarity (m)' },
    foam: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Look', label: 'whitecaps' },
    foamThreshold: { type: 'number', default: 0.42, min: 0, max: 1.5, step: 0.01, group: 'Look', label: 'whitecap threshold' },
    shoreFoam: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Look', label: 'shore foam' },
    shoreDepth: { type: 'number', default: 5, min: 0.5, max: 40, step: 0.1, group: 'Look', label: 'shore calm depth (m)' },
    // --- rendering ---
    viewDistance: { type: 'number', default: 40000, min: 500, max: 200000, step: 100, group: 'Render', label: 'view distance (m)' },
    receiveShadow: { type: 'boolean', default: true, group: 'Render' },
    wireframe: { type: 'boolean', default: false, group: 'Render' },
  };

  /**
   * segments / rings  resolution of the polar grid
   * waves             number of Gerstner waves (also the per-pixel normal cost)
   * ripples           per-pixel capillary ripples
   */
  static qualityPresets = {
    ultra: { segments: 512, rings: 400, waves: 40, ripples: true },
    high: { segments: 384, rings: 320, waves: 32, ripples: true },
    medium: { segments: 256, rings: 240, waves: 20, ripples: true },
    low: { segments: 160, rings: 160, waves: 10, ripples: false },
  };

  #u;
  #material;
  #mesh;
  #geometry = null;
  #waveA = [];
  #waveB = [];
  #waveCount = 0;
  #time = 0;
  #windKey = '';
  #fallbackEnv = null;
  #stats = { hs: 0, peak: 0 };

  /**
   * @param {object} [options.seabed] `{ glsl, uniforms }` where glsl defines
   *   `float pwoSeabedHeight(vec2 xz)` (world height of the ground in metres).
   *   With TerrainEngine: `terrain.getHeightShader({ functionName: 'pwoSeabedHeight' })`.
   */
  constructor(options = {}) {
    super(options);
    for (let i = 0; i < MAX_WAVES; i++) {
      this.#waveA.push(new Vector4());
      this.#waveB.push(new Vector4());
    }
    this.#u = {
      uOWaveA: { value: this.#waveA },
      uOWaveB: { value: this.#waveB },
      uOWaveCount: { value: 0 },
      uOTime: { value: 0 },
      uOLevel: { value: 0 },
      uOShoreDepth: { value: 5 },
      uOCenter: { value: new Vector2() },
      uOGridScale: { value: 1 },
      uOAngularStep: { value: 0.02 },
      uOMinSpacing: { value: MIN_SPACING },
      uODeepColor: { value: new Color() },
      uOShallowColor: { value: new Color() },
      uOScatterColor: { value: new Color() },
      uOSkyZenith: { value: new Color() },
      uOSkyHorizon: { value: new Color() },
      uOSkyHorizonSun: { value: new Color() },
      uOReflection: { value: 1 },
      uOClarity: { value: 5 },
      uOFoam: { value: 1 },
      uOFoamThreshold: { value: 0.42 },
      uOShoreFoam: { value: 1 },
      uORipples: { value: 1 },
      uOMaxRoughness: { value: 0.05 },
      uOWind: { value: new Vector2(1, 0) },
    };

    const seabed = options.seabed ?? null;
    const seabedGlsl = seabed ? `#define PWO_SEABED\n${seabed.glsl}` : '';
    const uniforms = UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]);
    Object.assign(uniforms, this.#u, seabed?.uniforms);
    this.#material = new ShaderMaterial({
      name: 'OceanEngine.material',
      uniforms,
      vertexShader: OCEAN_VERT.replace('PWO_SEABED_GLSL', seabedGlsl),
      fragmentShader: OCEAN_FRAG.replace('PWO_NOISE_GLSL', NOISE_GLSL).replace('PWO_SEABED_GLSL', seabedGlsl),
      lights: true,
      fog: true,
      side: DoubleSide,
      // Only shallow water is see-through, and that needs a seabed to know the depth.
      transparent: !!seabed,
    });

    this.#mesh = new Mesh(undefined, this.#material);
    this.#mesh.name = 'OceanEngine.mesh';
    this.#mesh.frustumCulled = false;
    this.#mesh.matrixAutoUpdate = false;
    this.object3d.add(this.#mesh);

    this._applyParameters(this.params);
    this._applyQuality(this.qualitySettings);
  }

  // --- public -------------------------------------------------------------

  /** The Mesh that draws the water. */
  get mesh() {
    return this.#mesh;
  }

  /** The water material, e.g. for `atmosphere.applyTo(ocean.material)`. */
  get material() {
    return this.#material;
  }

  /** Significant wave height (m) of the current sea state. */
  get significantWaveHeight() {
    return this.#stats.hs;
  }

  /**
   * Water surface height at (x, z) right now. It sums the vertical motion of
   * every wave and ignores their sideways motion and the calming near shores,
   * so with high choppiness it is off by a fraction of the wave height.
   */
  getHeightAt(x, z) {
    const env = this.#env();
    let y = env.waterLevel;
    for (let i = 0; i < this.#waveCount; i++) {
      const a = this.#waveA[i];
      const b = this.#waveB[i];
      y += a.w * Math.sin(a.z * (a.x * x + a.y * z) - b.y * this.#time + b.z);
    }
    return y;
  }

  update(deltaTime, camera) {
    if (this.disposed) return;
    const env = this.#env();
    const u = this.#u;
    const p = this.params;

    if (deltaTime > 0) this.#time += deltaTime * p.timeScale;
    // Keep float32 precision in the shader: wave phases only need time modulo a long period.
    u.uOTime.value = this.#time % 36000;
    u.uOLevel.value = env.waterLevel;
    u.uOSkyZenith.value.copy(env.skyZenith);
    u.uOSkyHorizon.value.copy(env.skyHorizon);
    u.uOSkyHorizonSun.value.copy(env.skyHorizonSun);

    const windKey = `${env.windSpeed.toFixed(2)}|${env.windDirection.toFixed(1)}`;
    if (windKey !== this.#windKey) {
      this.#windKey = windKey;
      this.#buildWaves(env);
    }

    camera.updateMatrixWorld();
    _p.setFromMatrixPosition(camera.matrixWorld);
    u.uOCenter.value.set(_p.x, _p.z);
    // Higher up, the same grid covers more water with coarser cells.
    u.uOGridScale.value = Math.max(1, Math.abs(_p.y - env.waterLevel) / 6);
  }

  getStats() {
    const q = this.qualitySettings;
    return {
      waves: this.#waveCount,
      'Hs m': this.#stats.hs,
      'peak m': this.#stats.peak,
      triangles: q.segments * (2 * q.rings + 1),
    };
  }

  // --- BaseEngine hooks ---------------------------------------------------

  _applyQuality(q) {
    this.#u.uORipples.value = q.ripples ? this.params.ripples : 0;
    this.#buildGeometry(q);
    this.#windKey = '';
  }

  _applyParameters(changed) {
    const p = this.params;
    const u = this.#u;
    u.uODeepColor.value.set(p.deepColor);
    u.uOShallowColor.value.set(p.shallowColor);
    u.uOScatterColor.value.set(p.scatterColor);
    u.uOReflection.value = p.reflection;
    u.uOClarity.value = p.clarity;
    u.uOFoam.value = p.foam;
    u.uOFoamThreshold.value = p.foamThreshold;
    u.uOShoreFoam.value = p.shoreFoam;
    u.uOShoreDepth.value = p.shoreDepth;
    u.uORipples.value = this.qualitySettings.ripples ? p.ripples : 0;
    this.#material.wireframe = p.wireframe;
    this.#mesh.receiveShadow = p.receiveShadow;
    if ('waveHeight' in changed || 'choppiness' in changed || 'spread' in changed || 'seed' in changed) {
      this.#windKey = '';
    }
    if ('viewDistance' in changed && this.#geometry) this.#buildGeometry(this.qualitySettings);
  }

  _dispose() {
    this.#geometry?.dispose();
    this.#material.dispose();
  }

  // --- internals ----------------------------------------------------------

  #env() {
    return this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
  }

  /**
   * Sea state from the wind. Significant wave height and peak wavelength
   * follow the usual fully-developed-sea rules of thumb; the waves are spread
   * geometrically from above the peak down to ripples.
   */
  #buildWaves(env) {
    const p = this.params;
    const n = Math.min(MAX_WAVES, this.qualitySettings.waves);
    const rand = mulberry(p.seed * 7919 + 13);
    const U = Math.max(env.windSpeed, 0.3);
    const hs = Math.min((0.21 * U * U) / GRAVITY, 14) * p.waveHeight;
    const peak = Math.min(Math.max(0.9 * U * U, 2), 400);
    const longest = peak * 1.6;
    const shortest = 0.45;
    const windAngle = Math.atan2(env.windVector.z, env.windVector.x);

    let energy = 0;
    const amps = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const lambda = longest * Math.pow(shortest / longest, t) * (0.9 + 0.2 * rand());
      const x = lambda / peak;
      // Amplitude grows with wavelength up to the peak and falls off beyond it.
      const amp = x < 1 ? x : Math.exp(-(x - 1) * 2.5);
      // Short waves scatter more widely around the wind direction.
      const g = rand() + rand() + rand() - 1.5;
      const angle = windAngle + g * p.spread * (0.7 + 1.8 * (1 - Math.min(x, 1)));
      const k = (2 * Math.PI) / lambda;
      this.#waveA[i].set(Math.cos(angle), Math.sin(angle), k, amp);
      this.#waveB[i].set(0, Math.sqrt(GRAVITY * k), rand() * Math.PI * 2, 0);
      amps.push(amp);
      energy += amp * amp * 0.5;
    }
    // Hs = 4 * sqrt(total variance).
    const scale = energy > 0 ? hs / (4 * Math.sqrt(energy)) : 0;
    for (let i = 0; i < n; i++) {
      const a = this.#waveA[i];
      a.w = amps[i] * scale;
      // Gerstner steepness shared out so the crests sharpen but never loop.
      this.#waveB[i].x = a.w > 1e-6 ? p.choppiness / (a.z * a.w * n) : 0;
    }
    for (let i = n; i < MAX_WAVES; i++) {
      this.#waveA[i].set(1, 0, 1, 0);
      this.#waveB[i].set(0, 0, 0, 0);
    }
    this.#waveCount = n;
    this.#u.uOWaveCount.value = n;
    this.#u.uOWind.value.set(env.windVector.x, env.windVector.z).multiplyScalar(Math.min(U, 12) * 0.12);
    // Measured sea-surface slope variance grows roughly linearly with wind (Cox & Munk).
    this.#u.uOMaxRoughness.value = 2 * (0.003 + 0.00512 * Math.min(U, 20));
    this.#stats.hs = hs;
    this.#stats.peak = peak;
  }

  /** Polar grid: ring spacing grows geometrically out to viewDistance. */
  #buildGeometry(q) {
    this.#geometry?.dispose();
    const { segments: m, rings: n } = q;
    const R = this.params.viewDistance;

    // Find the growth factor g with MIN_SPACING * (g^n - 1) / (g - 1) = R.
    let lo = 1.0001, hi = 2;
    for (let i = 0; i < 60; i++) {
      const g = 0.5 * (lo + hi);
      if ((MIN_SPACING * (Math.pow(g, n) - 1)) / (g - 1) < R) lo = g;
      else hi = g;
    }
    const g = 0.5 * (lo + hi);

    const ringCount = n + 1; // one extra ring pushed out to the horizon
    const positions = new Float32Array((1 + ringCount * m) * 3);
    let r = 0, step = MIN_SPACING, k = 3;
    for (let i = 0; i < ringCount; i++) {
      r = i < n ? r + step : r * 40;
      step *= g;
      for (let j = 0; j < m; j++) {
        const a = (j / m) * Math.PI * 2;
        positions[k++] = Math.cos(a) * r;
        positions[k++] = 0;
        positions[k++] = Math.sin(a) * r;
      }
    }
    const indices = new Uint32Array(m * 3 + (ringCount - 1) * m * 6);
    k = 0;
    for (let j = 0; j < m; j++) {
      indices[k++] = 0;
      indices[k++] = 1 + ((j + 1) % m);
      indices[k++] = 1 + j;
    }
    for (let i = 0; i < ringCount - 1; i++) {
      for (let j = 0; j < m; j++) {
        const a = 1 + i * m + j;
        const b = 1 + i * m + ((j + 1) % m);
        const c = a + m;
        const d = b + m;
        indices[k++] = a; indices[k++] = b; indices[k++] = c;
        indices[k++] = b; indices[k++] = d; indices[k++] = c;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    this.#geometry = geometry;
    this.#mesh.geometry = geometry;
    this.#u.uOAngularStep.value = (2 * Math.PI) / m;
  }
}
