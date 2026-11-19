import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Data3DTexture,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  VSMShadowMap,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';
import {
  VOLUMETRIC_VERT_PARS,
  VOLUMETRIC_VERT,
  VOLUMETRIC_FRAG_PARS,
  VOLUMETRIC_FRAG,
  BACKDROP_VERT,
  BACKDROP_FRAG,
  FROXEL_VERT,
  FROXEL_FRAG,
  SMOKE_VERT,
  SMOKE_FRAG,
  MAX_SMOKE,
} from './shaders/volumetric.glsl.js';

const PATCH = Symbol('pweVolumetric');
const _c = new Color();
const _m = new Matrix4();
const _wind = new Vector3();

/** Small seeded random number generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A block of smooth noise that repeats in all three directions: three layers
 * of random values on coarse grids, blended. Values average 0.5.
 */
export function createFogNoise(size = 32, seed = 5) {
  const rnd = rng(seed);
  const layers = [[4, 0.55], [8, 0.3], [16, 0.15]].map(([n, weight]) => {
    const grid = new Float32Array(n * n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    return { n, weight, grid };
  });
  const smooth = (t) => t * t * (3 - 2 * t);
  const data = new Uint8Array(size * size * size);
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        for (const { n, weight, grid } of layers) {
          const fx = (x / size) * n, fy = (y / size) * n, fz = (z / size) * n;
          const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
          const tx = smooth(fx - x0), ty = smooth(fy - y0), tz = smooth(fz - z0);
          const at = (a, b, c) => grid[((c % n) * n + (b % n)) * n + (a % n)];
          const lerp = (a, b, t) => a + (b - a) * t;
          v += weight * lerp(
            lerp(lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), tx), lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx), ty),
            lerp(lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx), lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx), ty),
            tz,
          );
        }
        // Blending pulls everything toward the middle; spread it out again.
        data[i++] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.5) * 2.2 + 0.5)));
      }
    }
  }
  const texture = new Data3DTexture(data, size, size, size);
  texture.name = 'VolumetricEngine.noise';
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const SMOKE_DEFAULTS = Object.freeze({
  radius: 1.2, // metres, size of the source
  rise: 2.5, // metres per second
  life: 16, // seconds a puff lasts
  turbulence: 1, // how much the puffs wander and spread
  wind: 1, // how much of the wind the plume takes on
  color: '#8d8a86',
  opacity: 0.6,
});

/**
 * Fog, light shafts and smoke without a post-processing pass.
 *
 * - Fog: a layer that is densest at `baseHeight` and thins out upward.
 *   applyTo(material) makes a material fade into it; the engine itself draws
 *   the fog in front of the sky. Near the camera the fog is worked out on a
 *   coarse grid once per frame, which is what gives it wisps and shafts; that
 *   needs init(renderer). Without it the fog is smooth.
 * - Light shafts: pass the sun's DirectionalLight as `light`. Where its
 *   shadow map says the sun is blocked, the fog stays dark, which leaves
 *   bright shafts between the shadows.
 * - Smoke: addSmoke() puts a plume of puffs at a point. It rises, bends with
 *   the wind and stands in the fog.
 */
export class VolumetricEngine extends BaseEngine {
  static engineName = 'VolumetricEngine';

  static parameterSchema = {
    strength: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Fog', label: 'overall strength' },
    visibility: { type: 'number', default: 500, min: 15, max: 20000, step: 5, group: 'Fog', label: 'visibility in the fog (m)' },
    baseHeight: { type: 'number', default: 0, min: -500, max: 5000, step: 1, group: 'Fog', label: 'base above water level (m)' },
    falloff: { type: 'number', default: 40, min: 2, max: 2000, step: 1, group: 'Fog', label: 'thickness (m)' },
    humidityResponse: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, group: 'Fog', label: 'follows humidity' },
    wisps: { type: 'number', default: 0.6, min: 0, max: 1, step: 0.01, group: 'Wisps', label: 'amount' },
    wispSize: { type: 'number', default: 90, min: 5, max: 1000, step: 1, group: 'Wisps', label: 'size (m)' },
    drift: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Wisps', label: 'drift with wind' },
    tint: { type: 'color', default: '#ffffff', group: 'Light', label: 'fog colour' },
    brightness: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Light' },
    sunScatter: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Light', label: 'sunlight in the fog' },
    anisotropy: { type: 'number', default: 0.6, min: 0, max: 0.85, step: 0.01, group: 'Light', label: 'glow toward the sun' },
    shafts: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, group: 'Light', label: 'light shafts' },
    range: { type: 'number', default: 350, min: 20, max: 3000, step: 5, group: 'Light', label: 'detail range (m)' },
    smoke: { type: 'boolean', default: true, group: 'Smoke' },
    smokeOpacity: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Smoke', label: 'opacity' },
    timeScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Smoke', label: 'time scale' },
  };

  /**
   * grid           cells of the fog grid: [across, down, slices in depth, columns of
   *                tiles in the texture]; null = no grid (smooth fog, no wisps, no shafts)
   * octaves        layers of noise in the wisps
   * smokeParticles puffs per smoke source
   */
  static qualityPresets = {
    ultra: { grid: [160, 90, 48, 8], octaves: 2, smokeParticles: 96 },
    high: { grid: [128, 72, 32, 8], octaves: 2, smokeParticles: 64 },
    medium: { grid: [96, 54, 24, 6], octaves: 1, smokeParticles: 40 },
    low: { grid: null, octaves: 1, smokeParticles: 24 },
  };

  /** The sun's DirectionalLight, or null. Its shadow map makes the shafts. */
  light = null;

  #u;
  #renderer = null;
  #noise;
  #triangle;
  #backdrop;
  #backdropMaterial;
  #gridTarget = null;
  #gridMaterial;
  #gridMesh;
  #gridScene = new Scene();
  #gridCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  #gridOn = false;
  #smokeMesh;
  #smokeMaterial;
  #smokes = [];
  #smokeDirty = true;
  #patched = new Set();
  #time = 0;
  #wind = new Vector3();
  #windReady = false;
  #drift = new Vector3();
  #fallbackEnv = null;
  #submerged;
  #shaftsOn = false;
  #extinction = 0;

  /**
   * @param {DirectionalLight} [options.light] the sun; without it there are no shafts
   * @param {function} [options.submerged] `() => boolean`, true while the camera is
   *   under water (e.g. `() => underwater.submerged`): the fog in front of the sky is
   *   then left out, since the water hides it
   */
  constructor(options = {}) {
    super(options);
    this.light = options.light ?? null;
    this.#submerged = options.submerged ?? null;
    this.#noise = createFogNoise();
    const vec4s = () => Array.from({ length: MAX_SMOKE }, () => new Vector4());
    this.#u = {
      uFStrength: { value: 1 },
      uFFog: { value: new Vector3(0, 0, 40) },
      uFAmbient: { value: new Vector3() },
      uFSun: { value: new Vector3() },
      uFSunDir: { value: new Vector3(0, 1, 0) },
      uFG: { value: 0.6 },
      uFFroxel: { value: new Vector4(1, 1, 0, 350) },
      uFFroxelTile: { value: [1, 1] },
      uFFroxelTex: { value: null },
      uFFroxelViewProj: { value: new Matrix4() },
      uFProjInv: { value: new Matrix4() },
      uFCamWorld: { value: new Matrix4() },
      uFNoise: { value: new Vector4(0.6, 1 / 90, 2, 0) },
      uFNoiseOffset: { value: new Vector3() },
      uFNoiseTex: { value: this.#noise },
      uFShadowMap: { value: null },
      uFShadowMatrix: { value: new Matrix4() },
      uFShafts: { value: 0 },
      uFTime: { value: 0 },
      uFWind: { value: new Vector3() },
      uFSmokePos: { value: vec4s() },
      uFSmokeMove: { value: vec4s() },
      uFSmokeColor: { value: vec4s() },
    };

    this.#triangle = new BufferGeometry();
    this.#triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.#backdropMaterial = new ShaderMaterial({
      name: 'VolumetricEngine.backdrop',
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      uniforms: this.#u,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.#backdrop = new Mesh(this.#triangle, this.#backdropMaterial);
    this.#backdrop.name = 'VolumetricEngine.backdrop';
    this.#backdrop.frustumCulled = false;
    this.#backdrop.renderOrder = 10002; // over the sky, which is drawn at 10000
    this.object3d.add(this.#backdrop);

    this.#gridMaterial = new ShaderMaterial({
      name: 'VolumetricEngine.grid',
      vertexShader: FROXEL_VERT,
      fragmentShader: FROXEL_FRAG,
      uniforms: this.#u,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.#gridMesh = new Mesh(this.#triangle, this.#gridMaterial);
    this.#gridMesh.frustumCulled = false;
    this.#gridScene.add(this.#gridMesh);

    this.#smokeMaterial = new ShaderMaterial({
      name: 'VolumetricEngine.smoke',
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: this.#u,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.#smokeMesh = new Mesh(new InstancedBufferGeometry(), this.#smokeMaterial);
    this.#smokeMesh.name = 'VolumetricEngine.smoke';
    this.#smokeMesh.frustumCulled = false;
    this.#smokeMesh.renderOrder = 10003; // after the backdrop, or the backdrop would paint over it
    this.#smokeMesh.visible = false;
    this.object3d.add(this.#smokeMesh);

    this._applyParameters(this.params);
    this._applyQuality(this.qualitySettings);
  }

  /** The fog grid is drawn with this renderer. Without it the fog is smooth. */
  async init(renderer) {
    this.#renderer = renderer ?? null;
    return super.init(renderer);
  }

  /**
   * Put a material in the fog. Works with three's built-in materials and with
   * the materials of the other engines.
   *
   * `{ grid: false }` gives the material the smooth fog only (no wisps, no
   * shafts), which saves its two texture reads.
   *
   * Order matters when several engines patch one material: AtmosphereEngine
   * first, then this, then UnderwaterEngine.
   */
  applyTo(material, { grid = true } = {}) {
    if (material[PATCH]) return material;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const uniforms = this.#u;
    material[PATCH] = { previous, previousKey };
    material.onBeforeCompile = function (shader, renderer) {
      previous?.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VOLUMETRIC_VERT_PARS}`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VOLUMETRIC_VERT}`);
      const define = grid ? '' : '#define PWF_NO_GRID\n';
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${define}${VOLUMETRIC_FRAG_PARS}`)
        .replace('#include <tonemapping_fragment>', `${VOLUMETRIC_FRAG}\n#include <tonemapping_fragment>`);
    };
    material.customProgramCacheKey = function () {
      return `${previousKey ? previousKey.call(this) : ''}|pwe-volumetric${grid ? '' : '-flat'}`;
    };
    material.needsUpdate = true;
    this.#patched.add(material);
    return material;
  }

  /** Undo applyTo(). */
  removeFrom(material) {
    const patch = material[PATCH];
    if (!patch) return material;
    material.onBeforeCompile = patch.previous;
    material.customProgramCacheKey = patch.previousKey;
    delete material[PATCH];
    material.needsUpdate = true;
    this.#patched.delete(material);
    return material;
  }

  /** applyTo() for every built-in material under an object. */
  applyToObject(object3d, options) {
    object3d.traverse((o) => {
      if (!o.material || o === this.#backdrop || o === this.#smokeMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial) {
          this.applyTo(m, options);
        }
      }
    });
  }

  /**
   * Start a plume of smoke.
   * @param {object} options `position` (Vector3-like, required) plus any of
   *   radius, rise, life, turbulence, wind, color, opacity (see SMOKE_DEFAULTS)
   * @returns a handle: `handle.set({ ... })` changes it, `handle.remove()` ends it
   */
  addSmoke(options = {}) {
    if (this.#smokes.length >= MAX_SMOKE) throw new Error(`VolumetricEngine: at most ${MAX_SMOKE} smoke sources`);
    if (!options.position) throw new Error('VolumetricEngine: addSmoke needs a position');
    const engine = this;
    const smoke = {
      ...SMOKE_DEFAULTS,
      position: new Vector3(),
      set(next) {
        for (const key in next) {
          if (key === 'position') this.position.copy(next.position);
          else if (key in SMOKE_DEFAULTS) this[key] = next[key];
          else throw new Error(`VolumetricEngine: unknown smoke option "${key}"`);
        }
        return this;
      },
      remove() {
        engine.removeSmoke(this);
      },
    };
    smoke.set(options);
    this.#smokes.push(smoke);
    this.#smokeDirty = true;
    return smoke;
  }

  removeSmoke(smoke) {
    const i = this.#smokes.indexOf(smoke);
    if (i < 0) return;
    this.#smokes.splice(i, 1);
    this.#smokeDirty = true;
  }

  /** The smoke sources, in the order they were added. */
  get smokes() {
    return [...this.#smokes];
  }

  update(deltaTime, camera) {
    if (this.disposed) return;
    const env = this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
    const u = this.#u;
    const p = this.params;
    const q = this.qualitySettings;
    const dt = deltaTime > 0 ? deltaTime : 0;

    // --- fog -------------------------------------------------------------
    // "Visibility" is where 5 % of the light is left. Damp air holds more fog.
    const humid = Math.min(Math.max(1 + ((env.humidity - 55) / 45) * 1.5, 0.3), 2.5);
    this.#extinction = (3.0 / p.visibility) * (1 + p.humidityResponse * (humid - 1));
    u.uFFog.value.set(this.#extinction, env.waterLevel + p.baseHeight, p.falloff);
    u.uFStrength.value = p.strength;
    u.uFSunDir.value.copy(env.sunDirection);

    // The wisps move with the wind and slowly well up.
    _wind.copy(env.windVector).multiplyScalar(env.windSpeed);
    const k = (p.drift * dt) / p.wispSize;
    this.#drift.x -= _wind.x * k;
    this.#drift.z -= _wind.z * k;
    this.#drift.y -= 0.6 * k;
    for (const axis of ['x', 'y', 'z']) this.#drift[axis] -= Math.floor(this.#drift[axis]);
    u.uFNoiseOffset.value.copy(this.#drift);

    // --- light -----------------------------------------------------------
    // Fog lit by the sky looks like the sky near the horizon.
    _c.set(p.tint);
    const sky = env.skyHorizon, zenith = env.skyZenith;
    u.uFAmbient.value.set(
      _c.r * (0.65 * sky.r + 0.35 * zenith.r),
      _c.g * (0.65 * sky.g + 0.35 * zenith.g),
      _c.b * (0.65 * sky.b + 0.35 * zenith.b),
    ).multiplyScalar(p.brightness);
    // Fog lit by the sun: a share of what a white surface facing the sun shows.
    const light = this.light;
    const day = Math.min(Math.max((env.sunDirection.y + 0.02) / 0.06, 0), 1);
    const gain = (0.5 / Math.PI) * p.sunScatter * p.brightness * day;
    if (light) {
      u.uFSun.value.set(_c.r * light.color.r, _c.g * light.color.g, _c.b * light.color.b).multiplyScalar(light.intensity * gain);
    } else {
      const s = env.sunColor;
      u.uFSun.value.set(_c.r * s.r, _c.g * s.g, _c.b * s.b).multiplyScalar(3 * env.sunIntensity * gain);
    }

    // --- shafts ----------------------------------------------------------
    const map = light?.castShadow ? light.shadow.map : null;
    const renderer = this.#renderer;
    const usable = !!map && p.shafts > 0 && !!q.grid && !!renderer
      && renderer.shadowMap.enabled && renderer.shadowMap.type !== VSMShadowMap;
    this.#shaftsOn = usable;
    u.uFShadowMap.value = usable ? map.texture : null;
    u.uFShafts.value = usable ? p.shafts : 0;
    // The grid is drawn now, before this frame's shadow map: both the map
    // and this matrix are the previous frame's, so they belong together.
    if (usable) u.uFShadowMatrix.value.copy(light.shadow.matrix);

    // --- the grid ---------------------------------------------------------
    this.#gridOn = !!q.grid && !!renderer && p.strength > 0;
    if (this.#gridOn) {
      const [w, h, slices, columns] = q.grid;
      const rows = Math.ceil(slices / columns);
      if (!this.#gridTarget || this.#gridTarget.width !== w * columns || this.#gridTarget.height !== h * rows) {
        this.#gridTarget?.dispose();
        this.#gridTarget = new WebGLRenderTarget(w * columns, h * rows, {
          type: HalfFloatType,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
          depthBuffer: false,
        });
        this.#gridTarget.texture.name = 'VolumetricEngine.grid';
      }
      camera.updateMatrixWorld();
      u.uFFroxel.value.set(columns, rows, slices, p.range);
      u.uFFroxelTile.value[0] = w;
      u.uFFroxelTile.value[1] = h;
      u.uFProjInv.value.copy(camera.projectionMatrixInverse);
      u.uFCamWorld.value.copy(camera.matrixWorld);
      u.uFFroxelViewProj.value.multiplyMatrices(camera.projectionMatrix, _m.copy(camera.matrixWorld).invert());
      // The pass must not read the texture it is writing.
      u.uFFroxelTex.value = null;
      const previousTarget = renderer.getRenderTarget();
      const xrEnabled = renderer.xr.enabled;
      renderer.xr.enabled = false; // a plain 2D pass, even during an XR session
      renderer.setRenderTarget(this.#gridTarget);
      renderer.render(this.#gridScene, this.#gridCamera);
      renderer.setRenderTarget(previousTarget);
      renderer.xr.enabled = xrEnabled;
      u.uFFroxelTex.value = this.#gridTarget.texture;
    } else {
      u.uFFroxel.value.z = 0;
      u.uFFroxelTex.value = null;
    }

    this.#backdrop.visible = p.strength > 0 && !(this.#submerged?.() ?? false);

    // --- smoke -----------------------------------------------------------
    if (this.#smokeDirty) this.#rebuildSmoke();
    this.#time += dt * p.timeScale;
    u.uFTime.value = this.#time % 7200;
    // A plume has no memory, so a sudden change of wind would swing all of
    // it at once. Follow the wind slowly instead.
    if (!this.#windReady) {
      this.#wind.copy(_wind);
      this.#windReady = true;
    } else {
      this.#wind.lerp(_wind, 1 - Math.exp(-dt * 0.4));
    }
    u.uFWind.value.copy(this.#wind);
    this.#smokeMesh.visible = p.smoke && this.#smokes.length > 0;
    for (let i = 0; i < this.#smokes.length; i++) {
      const s = this.#smokes[i];
      u.uFSmokePos.value[i].set(s.position.x, s.position.y, s.position.z, s.radius);
      u.uFSmokeMove.value[i].set(s.rise, s.life, s.turbulence, s.wind);
      _c.set(s.color);
      u.uFSmokeColor.value[i].set(_c.r, _c.g, _c.b, s.opacity * p.smokeOpacity);
    }
  }

  getStats() {
    const q = this.qualitySettings;
    return {
      'visibility m': this.#extinction > 0 ? 3 / this.#extinction : Infinity,
      grid: this.#gridOn ? q.grid.slice(0, 3).join(' x ') : 'off',
      shafts: this.#shaftsOn ? 'on' : 'off',
      'smoke sources': this.#smokes.length,
      puffs: this.#smokes.length * q.smokeParticles,
      materials: this.#patched.size,
    };
  }

  _applyQuality(q) {
    this.#u.uFNoise.value.z = q.octaves;
    this.#smokeDirty = true;
  }

  _applyParameters() {
    const p = this.params;
    const u = this.#u;
    u.uFG.value = p.anisotropy;
    u.uFNoise.value.x = p.wisps;
    u.uFNoise.value.y = 1 / p.wispSize;
  }

  _dispose() {
    for (const material of [...this.#patched]) this.removeFrom(material);
    this.#smokes.length = 0;
    this.#triangle.dispose();
    this.#backdropMaterial.dispose();
    this.#gridMaterial.dispose();
    this.#gridTarget?.dispose();
    this.#gridTarget = null;
    this.#smokeMesh.geometry.dispose();
    this.#smokeMaterial.dispose();
    this.#noise.dispose();
  }

  /** One quad, drawn once per puff of every source. */
  #rebuildSmoke() {
    this.#smokeDirty = false;
    const per = this.qualitySettings.smokeParticles;
    const count = this.#smokes.length * per;
    this.#smokeMesh.geometry.dispose();
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    const emitters = new Float32Array(count);
    const rnd = rng(2024);
    for (let e = 0; e < this.#smokes.length; e++) {
      for (let i = 0; i < per; i++) {
        const j = e * per + i;
        // Ages are spread evenly, so the plume has no gaps and no bursts.
        seeds[j * 4] = (i + rnd()) / per;
        seeds[j * 4 + 1] = rnd();
        seeds[j * 4 + 2] = rnd();
        seeds[j * 4 + 3] = rnd();
        emitters[j] = e;
      }
    }
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    geometry.setAttribute('aEmitter', new InstancedBufferAttribute(emitters, 1));
    geometry.instanceCount = count;
    this.#smokeMesh.geometry = geometry;
  }
}
