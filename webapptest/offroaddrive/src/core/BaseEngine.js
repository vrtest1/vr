import { Group } from 'three';
import { Emitter } from './Emitter.js';
import { normalizeQuality } from './Quality.js';

/**
 * Base class of every engine (Terrain, Ocean, Atmosphere, ...).
 *
 * The public contract is the same everywhere:
 *
 *   constructor(options)        options = { environment, quality, params }
 *   await init(renderer)        optional async setup; resolves to the engine
 *   addTo(scene) / removeFromScene()
 *   update(deltaTime, camera)   once per frame
 *   setQuality(preset)          'ultra' | 'high' | 'medium' | 'low'
 *   setParameters(parameters)   partial update, validated against the schema
 *   getParameters()
 *   getStats()                  numbers for the performance overlay
 *   dispose()
 *
 * Subclasses declare:
 *
 *   static engineName      = 'TerrainEngine'
 *   static parameterSchema = { name: { type, default, min, max, step, options, group, label } }
 *   static qualityPresets  = { ultra: {...}, high: {...}, medium: {...}, low: {...} }
 *
 * and implement `_applyQuality(settings, preset)`, `_applyParameters(changed)`
 * and `_dispose()`.
 *
 * Events: `change` ({ changed, engine }), `quality` (preset).
 */
export class BaseEngine extends Emitter {
  static engineName = 'BaseEngine';
  static parameterSchema = {};
  static qualityPresets = { ultra: {}, high: {}, medium: {}, low: {} };

  /** Everything the engine renders lives under this group. */
  object3d = new Group();
  environment = null;
  quality = 'high';
  params = {};
  ready = false;
  disposed = false;

  constructor(options = {}) {
    super();
    const ctor = this.constructor;
    this.object3d.name = ctor.engineName;
    this.environment = options.environment ?? null;
    this.quality = normalizeQuality(options.quality ?? 'high');
    for (const [name, def] of Object.entries(ctor.parameterSchema)) this.params[name] = def.default;
    if (options.params) Object.assign(this.params, this.#validate(options.params));
  }

  /** Settings table of the current preset. */
  get qualitySettings() {
    return this.constructor.qualityPresets[this.quality];
  }

  /** Async setup hook. The default has nothing to wait for. */
  async init(_renderer) {
    this.ready = true;
    return this;
  }

  addTo(scene) {
    scene.add(this.object3d);
    return this;
  }

  removeFromScene() {
    this.object3d.removeFromParent();
    return this;
  }

  // eslint-disable-next-line no-unused-vars
  update(deltaTime, camera) {}

  setQuality(preset) {
    const q = normalizeQuality(preset);
    if (q === this.quality) return this;
    this.quality = q;
    this._applyQuality(this.qualitySettings, q);
    this.emit('quality', q);
    return this;
  }

  setParameters(parameters) {
    const valid = this.#validate(parameters);
    const changed = {};
    for (const key in valid) {
      if (this.params[key] !== valid[key]) {
        this.params[key] = valid[key];
        changed[key] = valid[key];
      }
    }
    if (Object.keys(changed).length) {
      this._applyParameters(changed);
      this.emit('change', { changed, engine: this });
    }
    return this;
  }

  getParameters() {
    return { ...this.params };
  }

  getStats() {
    return {};
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.removeFromScene();
    this._dispose();
    this.clearListeners();
  }

  // --- subclass hooks -----------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  _applyQuality(settings, preset) {}
  // eslint-disable-next-line no-unused-vars
  _applyParameters(changed) {}
  _dispose() {}

  /** Check names and types, clamp numbers to the schema range. */
  #validate(parameters) {
    const schema = this.constructor.parameterSchema;
    const name = this.constructor.engineName;
    const out = {};
    for (const [key, raw] of Object.entries(parameters)) {
      const def = schema[key];
      if (!def) throw new Error(`${name}: unknown parameter "${key}"`);
      let v = raw;
      switch (def.type) {
        case 'number':
        case 'int':
          v = Number(v);
          if (!Number.isFinite(v)) throw new Error(`${name}: "${key}" must be a finite number`);
          if (def.type === 'int') v = Math.round(v);
          if (def.min !== undefined) v = Math.max(def.min, v);
          if (def.max !== undefined) v = Math.min(def.max, v);
          break;
        case 'boolean':
          v = Boolean(v);
          break;
        case 'select':
          if (!def.options.includes(v)) {
            throw new Error(`${name}: "${key}" must be one of ${def.options.join(', ')}`);
          }
          break;
        default:
          break;
      }
      out[key] = v;
    }
    return out;
  }
}
