import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';
import {
  UNDERWATER_VERT_PARS,
  UNDERWATER_VERT,
  UNDERWATER_FRAG_PARS,
  UNDERWATER_FRAG,
  BACKDROP_VERT,
  BACKDROP_FRAG,
} from './shaders/underwater.glsl.js';

const PATCH = Symbol('pweUnderwater');
// Relative loss of red, green and blue in clear sea water.
const EXTINCTION_RATIO = [4.5, 1.0, 0.6];
const _p = new Vector3();
const _c = new Color();

/**
 * Underwater optics without a post-processing pass.
 *
 * applyTo(material) teaches a material what water does to light: colours fade
 * with depth (red first), caustics play over anything below the surface, and
 * everything seen through water sinks into the water colour with distance,
 * with light shafts when the sun is out. It works from above too: the seabed
 * seen through shallow water gets the same treatment.
 *
 * While the camera is under water the engine also draws a backdrop of open
 * water in place of the sky.
 */
export class UnderwaterEngine extends BaseEngine {
  static engineName = 'UnderwaterEngine';

  static parameterSchema = {
    clarity: { type: 'number', default: 40, min: 2, max: 120, step: 0.5, group: 'Water', label: 'visibility (m)' },
    waterColor: { type: 'color', default: '#2a8fb0', group: 'Water', label: 'water colour' },
    brightness: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Water' },
    strength: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Water', label: 'overall strength' },
    caustics: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Light' },
    causticScale: { type: 'number', default: 7, min: 1, max: 40, step: 0.1, group: 'Light', label: 'caustic size (m)' },
    rays: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Light', label: 'light shafts' },
    timeScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Light', label: 'time scale' },
  };

  /** raySteps: samples per pixel for the light shafts (0 = off). */
  static qualityPresets = {
    ultra: { raySteps: 10 },
    high: { raySteps: 8 },
    medium: { raySteps: 5 },
    low: { raySteps: 0 },
  };

  /** True while the camera of the last update() was below the water surface. */
  submerged = false;
  /** Camera depth below the surface in metres (negative above water). */
  depth = 0;

  #u;
  #backdrop;
  #geometry;
  #material;
  #patched = new Set();
  #time = 0;
  #fallbackEnv = null;
  #waterHeight;

  /**
   * @param {function} [options.waterHeight] `(x, z) => y` of the water surface
   *   at the camera, e.g. `(x, z) => ocean.getHeightAt(x, z)`, so going under
   *   follows the waves. Defaults to the flat water level.
   */
  constructor(options = {}) {
    super(options);
    this.#waterHeight = options.waterHeight ?? null;
    this.#u = {
      uULevel: { value: 0 },
      uUExtinction: { value: new Vector3() },
      uUScatter: { value: new Vector3() },
      uUSunDir: { value: new Vector3(0, 1, 0) },
      uUSun: { value: 1 },
      uUTime: { value: 0 },
      uUCaustics: { value: 1 },
      uUCausticScale: { value: 7 },
      uURays: { value: 1 },
      uURaySteps: { value: 10 },
      uUStrength: { value: 1 },
    };

    this.#geometry = new BufferGeometry();
    this.#geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.#material = new ShaderMaterial({
      name: 'UnderwaterEngine.backdrop',
      vertexShader: BACKDROP_VERT,
      fragmentShader: BACKDROP_FRAG,
      uniforms: this.#u,
      depthWrite: false,
      fog: false,
    });
    this.#backdrop = new Mesh(this.#geometry, this.#material);
    this.#backdrop.name = 'UnderwaterEngine.backdrop';
    this.#backdrop.frustumCulled = false;
    this.#backdrop.renderOrder = 10001; // after the sky, which it replaces under water
    this.#backdrop.visible = false;
    this.object3d.add(this.#backdrop);

    this._applyParameters(this.params);
    this._applyQuality(this.qualitySettings);
  }

  /**
   * Make a material react to water. Works with three's built-in materials,
   * TerrainEngine's material and OceanEngine's material.
   *
   * For the water surface itself pass `{ surface: true }`: it then only fades
   * with distance when seen from below, and is left alone from above.
   * If the material also gets AtmosphereEngine.applyTo(), call that first.
   */
  applyTo(material, { surface = false } = {}) {
    if (material[PATCH]) return material;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const uniforms = this.#u;
    material[PATCH] = { previous, previousKey };
    material.onBeforeCompile = function (shader, renderer) {
      previous?.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${UNDERWATER_VERT_PARS}`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${UNDERWATER_VERT}`);
      // Last thing before tone mapping, so it also swallows any haze that
      // was added for the stretch of the view ray that is really under water.
      const define = surface ? '#define PWU_SURFACE\n' : '';
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${define}${UNDERWATER_FRAG_PARS}`)
        .replace('#include <tonemapping_fragment>', `${UNDERWATER_FRAG}\n#include <tonemapping_fragment>`);
    };
    material.customProgramCacheKey = function () {
      return `${previousKey ? previousKey.call(this) : ''}|pwe-underwater${surface ? '-surface' : ''}`;
    };
    material.needsUpdate = true;
    this.#patched.add(material);
    return material;
  }

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

  /** applyTo() for every built-in lit material under an object. */
  applyToObject(object3d) {
    object3d.traverse((o) => {
      if (!o.material || o === this.#backdrop) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial) {
          this.applyTo(m);
        }
      }
    });
  }

  update(deltaTime, camera) {
    if (this.disposed) return;
    const env = this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
    const u = this.#u;
    const p = this.params;

    if (deltaTime > 0) this.#time += deltaTime * p.timeScale;
    u.uUTime.value = this.#time % 3600;
    u.uULevel.value = env.waterLevel;
    u.uUSunDir.value.copy(env.sunDirection);
    u.uUSun.value = Math.min(1, env.sunIntensity * 1.4) * (env.sunDirection.y > 0 ? 1 : 0);

    // Water colour lit by today's sky: same units as the rest of the scene.
    _c.copy(env.skyZenith).add(env.skyHorizon).multiplyScalar(0.5);
    const light = (_c.r + _c.g + _c.b) / 3;
    _c.set(p.waterColor);
    u.uUScatter.value.set(_c.r, _c.g, _c.b).multiplyScalar(light * 2.2 * p.brightness);

    camera.updateMatrixWorld();
    _p.setFromMatrixPosition(camera.matrixWorld);
    const surface = this.#waterHeight ? this.#waterHeight(_p.x, _p.z) : env.waterLevel;
    this.depth = surface - _p.y;
    this.submerged = this.depth > 0;
    this.#backdrop.visible = this.submerged && p.strength > 0;
  }

  getStats() {
    return {
      submerged: this.submerged ? 'yes' : 'no',
      'depth m': this.depth,
      'ray steps': this.#u.uURaySteps.value,
      materials: this.#patched.size,
    };
  }

  _applyQuality(q) {
    this.#u.uURaySteps.value = q.raySteps;
  }

  _applyParameters() {
    const p = this.params;
    const u = this.#u;
    // "Visibility" is where green light has dropped to about 5 %.
    const k = 3.0 / p.clarity;
    u.uUExtinction.value.set(EXTINCTION_RATIO[0] * k, EXTINCTION_RATIO[1] * k, EXTINCTION_RATIO[2] * k);
    u.uUCaustics.value = p.caustics;
    u.uUCausticScale.value = p.causticScale;
    u.uURays.value = p.rays;
    u.uUStrength.value = p.strength;
  }

  _dispose() {
    for (const material of [...this.#patched]) this.removeFrom(material);
    this.#geometry.dispose();
    this.#material.dispose();
  }
}
