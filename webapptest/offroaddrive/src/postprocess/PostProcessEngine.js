import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  CineonToneMapping,
  Color,
  HalfFloatType,
  LinearFilter,
  LinearToneMapping,
  Mesh,
  NeutralToneMapping,
  OrthographicCamera,
  ReinhardToneMapping,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';
import {
  POST_VERT,
  BLOOM_PREFILTER_FRAG,
  BLOOM_DOWN_FRAG,
  BLOOM_UP_FRAG,
  COMPOSITE_FRAG,
  EASU_FRAG,
  RCAS_FRAG,
} from './shaders/post.glsl.js';

/** Tone mapping names: [three's constant, number in the composite shader]. */
const TONE_MAPPING = Object.freeze({
  linear: [LinearToneMapping, 0],
  reinhard: [ReinhardToneMapping, 1],
  cineon: [CineonToneMapping, 2],
  aces: [ACESFilmicToneMapping, 3],
  agx: [AgXToneMapping, 4],
  neutral: [NeutralToneMapping, 5],
});

const _size = new Vector2();
const _c = new Color();

/**
 * The last step of the frame: draws the scene into an off-screen picture in
 * linear light, then exposes, tone maps and grades it once for the screen,
 * with bloom, a vignette, dithering, the look of water on the lens, and an
 * internal resolution below that of the screen made up for by upscaling.
 *
 *   await post.init(renderer);
 *   // in the loop, instead of renderer.render(scene, camera):
 *   post.update(deltaTime, camera);
 *   post.render(scene, camera);
 *
 * During a WebXR session, or where the device cannot draw to a float
 * texture, render() draws the scene straight to the screen as the renderer
 * would have, with the same tone mapping and exposure.
 */
export class PostProcessEngine extends BaseEngine {
  static engineName = 'PostProcessEngine';

  static parameterSchema = {
    enabled: { type: 'boolean', default: true, group: 'Output', label: 'post-processing' },
    toneMapping: { type: 'select', default: 'aces', options: Object.keys(TONE_MAPPING), group: 'Output', label: 'tone mapping' },
    exposure: { type: 'number', default: 1, min: 0.02, max: 4, step: 0.01, group: 'Output' },
    saturation: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Colour' },
    contrast: { type: 'number', default: 1, min: 0.5, max: 1.5, step: 0.01, group: 'Colour' },
    temperature: { type: 'number', default: 0, min: -1, max: 1, step: 0.01, group: 'Colour', label: 'white balance: cool - warm' },
    tint: { type: 'number', default: 0, min: -1, max: 1, step: 0.01, group: 'Colour', label: 'white balance: green - magenta' },
    bloom: { type: 'boolean', default: true, group: 'Bloom' },
    bloomIntensity: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01, group: 'Bloom', label: 'intensity' },
    bloomThreshold: { type: 'number', default: 1.2, min: 0, max: 8, step: 0.01, group: 'Bloom', label: 'threshold' },
    bloomKnee: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.01, group: 'Bloom', label: 'soft knee' },
    bloomRadius: { type: 'number', default: 1, min: 0.5, max: 2, step: 0.01, group: 'Bloom', label: 'radius' },
    vignette: { type: 'number', default: 0.2, min: 0, max: 1, step: 0.01, group: 'Lens' },
    vignetteStart: { type: 'number', default: 0.55, min: 0, max: 1.3, step: 0.01, group: 'Lens', label: 'vignette start' },
    dither: { type: 'boolean', default: true, group: 'Lens' },
    waterEffects: { type: 'boolean', default: true, group: 'Water', label: 'water on the lens' },
    distortion: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Water', label: 'underwater sway' },
    waterBand: { type: 'number', default: 0.3, min: 0.05, max: 1.5, step: 0.01, group: 'Water', label: 'waterline band (m)' },
    waterColor: { type: 'color', default: '#2a8fb0', group: 'Water', label: 'water colour' },
    renderScale: { type: 'number', default: 1, min: 0.4, max: 1, step: 0.01, group: 'Resolution', label: 'render scale' },
    upscaler: { type: 'select', default: 'fsr', options: ['fsr', 'bilinear'], group: 'Resolution' },
    sharpness: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, group: 'Resolution', label: 'sharpening (when upscaled)' },
  };

  /**
   * scale        internal resolution as a share of the drawing buffer (multiplied by renderScale)
   * samples      MSAA samples of the scene picture
   * bloomLevels  halvings in the bloom chain (0 = no bloom)
   * fsr          edge-directed upscaling available (otherwise always bilinear)
   */
  static qualityPresets = {
    ultra: { scale: 1, samples: 4, bloomLevels: 6, fsr: true },
    high: { scale: 1, samples: 4, bloomLevels: 5, fsr: true },
    medium: { scale: 0.85, samples: 4, bloomLevels: 4, fsr: true },
    low: { scale: 0.7, samples: 2, bloomLevels: 0, fsr: false },
  };

  #renderer = null;
  #supported = false;
  #given;
  #waterDepth;
  #fallbackEnv = null;
  #time = 0;

  #quadScene = new Scene();
  #quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  #triangle;
  #quad;
  #materials;
  #sceneTarget = null;
  #ldrTarget = null;
  #upTarget = null;
  #bloomDown = [];
  #bloomUp = [];
  #stats = { mode: 'not started', internal: '-', passes: 0, bloomLevels: 0 };

  /**
   * @param {function} [options.waterDepth] `() => metres`: how far the camera is
   *   below the water surface, negative above it (e.g. `() => underwater.depth`).
   *   Without it there are no water effects.
   */
  constructor(options = {}) {
    super(options);
    this.#given = new Set(Object.keys(options.params ?? {}));
    this.#waterDepth = options.waterDepth ?? null;

    this.#triangle = new BufferGeometry();
    this.#triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const material = (name, fragmentShader, uniforms) => new ShaderMaterial({
      name: `PostProcessEngine.${name}`,
      vertexShader: POST_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.#materials = {
      prefilter: material('bloomPrefilter', BLOOM_PREFILTER_FRAG, {
        tInput: { value: null }, uPTexel: { value: new Vector2() }, uPBloom: { value: new Vector3() },
      }),
      down: material('bloomDown', BLOOM_DOWN_FRAG, { tInput: { value: null }, uPTexel: { value: new Vector2() } }),
      up: material('bloomUp', BLOOM_UP_FRAG, {
        tInput: { value: null }, tAdd: { value: null }, uPTexel: { value: new Vector2() },
      }),
      composite: material('composite', COMPOSITE_FRAG, {
        tScene: { value: null },
        tBloom: { value: null },
        toneMappingExposure: { value: 1 },
        uPBloomMix: { value: 0 },
        uPToneMap: { value: 3 },
        uPBalance: { value: new Vector3(1, 1, 1) },
        uPGrade: { value: new Vector2(1, 1) },
        uPVignette: { value: new Vector3(0.2, 0.55, 1) },
        uPTime: { value: 0 },
        uPHorizon: { value: new Vector3(0, 1, 0) },
        uPWaterLine: { value: -1e4 },
        uPWaterTint: { value: 0 },
        uPWaterColor: { value: new Vector3() },
        uPDistortion: { value: 1 },
        uPDither: { value: 0 },
      }),
      easu: material('upscale', EASU_FRAG, {
        tInput: { value: null }, uPInputSize: { value: new Vector2() }, uPOutputSize: { value: new Vector2() }, uPDither: { value: 0 },
      }),
      rcas: material('sharpen', RCAS_FRAG, {
        tInput: { value: null }, uPOutputSize: { value: new Vector2() }, uPSharpness: { value: 0 }, uPDither: { value: 0 },
      }),
    };
    this.#quad = new Mesh(this.#triangle, this.#materials.composite);
    this.#quad.frustumCulled = false;
    this.#quadScene.add(this.#quad);

    this._applyParameters(this.params);
  }

  /**
   * Remember the renderer. Tone mapping and exposure that were not given as
   * parameters are taken over from it, so adding the engine does not change
   * the look of an existing scene.
   */
  async init(renderer) {
    this.#renderer = renderer;
    const adopt = {};
    if (!this.#given.has('exposure')) adopt.exposure = renderer.toneMappingExposure;
    if (!this.#given.has('toneMapping')) {
      const name = Object.keys(TONE_MAPPING).find((k) => TONE_MAPPING[k][0] === renderer.toneMapping);
      if (name) adopt.toneMapping = name;
    }
    this.setParameters(adopt);
    this.#supported = renderer.capabilities.isWebGL2
      && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    return super.init(renderer);
  }

  /** True when the last render() went through the post-processing passes. */
  get active() {
    return this.#stats.mode === 'post';
  }

  /** Internal resolution as a share of the drawing buffer, preset and parameter together. */
  get effectiveScale() {
    return Math.min(1, Math.max(0.25, this.qualitySettings.scale * this.params.renderScale));
  }

  update(deltaTime, camera) {
    if (this.disposed) return;
    const env = this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
    const p = this.params;
    const u = this.#materials.composite.uniforms;
    if (deltaTime > 0) this.#time += deltaTime;
    u.uPTime.value = this.#time % 3600;

    // --- water on the lens ---------------------------------------------
    const depth = p.waterEffects && this.#waterDepth ? this.#waterDepth() : null;
    u.uPWaterLine.value = -1e4;
    u.uPWaterTint.value = 0;
    if (depth !== null && Number.isFinite(depth)) {
      if (depth > 0) {
        // Under water: the scene has its own water colour. Only the sway is added.
        u.uPWaterLine.value = 1e4;
      } else if (-depth < p.waterBand) {
        // Just above the surface: the waterline climbs up the picture as the
        // camera comes down, and reaches the top as the camera goes under.
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        const proj = camera.projectionMatrix.elements;
        // Height of a view ray over the horizon is linear across the picture.
        const a = e[1] / proj[0], b = e[5] / proj[5], c = -e[9];
        u.uPHorizon.value.set(a, b, c);
        const reach = Math.abs(a) + Math.abs(b) + 0.08;
        const t = -depth / p.waterBand;
        u.uPWaterLine.value = c + reach * (1 - 2 * t);
        u.uPWaterTint.value = 1;
      }
    }
    // The colour of water lit by today's sky, as UnderwaterEngine computes it.
    _c.copy(env.skyZenith).add(env.skyHorizon).multiplyScalar(0.5);
    const light = (_c.r + _c.g + _c.b) / 3;
    _c.set(p.waterColor);
    u.uPWaterColor.value.set(_c.r, _c.g, _c.b).multiplyScalar(light * 2.2);
  }

  /**
   * Draw the scene. Call it instead of renderer.render(scene, camera).
   * The renderer's tone mapping and exposure are set from the parameters for
   * the duration of the call and put back afterwards.
   */
  render(scene, camera) {
    const renderer = this.#renderer;
    if (!renderer) throw new Error('PostProcessEngine: call init(renderer) before render()');
    const p = this.params;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    renderer.toneMapping = TONE_MAPPING[p.toneMapping][0];
    renderer.toneMappingExposure = p.exposure;
    try {
      // In XR the renderer draws two eyes into the headset's own framebuffer.
      // Nothing here knows how to do that, so the scene goes straight there.
      const direct = this.disposed ? 'disposed' : !p.enabled ? 'off' : renderer.xr.isPresenting ? 'xr' : !this.#supported ? 'unsupported' : null;
      if (direct) {
        this.#stats = { mode: `direct (${direct})`, internal: '-', passes: 1, bloomLevels: 0 };
        renderer.render(scene, camera);
      } else {
        this.#renderPasses(scene, camera);
      }
    } finally {
      renderer.toneMapping = previousToneMapping;
      renderer.toneMappingExposure = previousExposure;
    }
  }

  getStats() {
    return { ...this.#stats };
  }

  _applyQuality() {}

  _applyParameters() {
    const p = this.params;
    const u = this.#materials.composite.uniforms;
    u.uPToneMap.value = TONE_MAPPING[p.toneMapping][1];
    u.toneMappingExposure.value = p.exposure;
    u.uPGrade.value.set(p.contrast, p.saturation);
    // Warm adds red and takes blue; magenta takes green. Kept at equal brightness.
    const r = 1 + 0.3 * p.temperature, g = 1 - 0.25 * p.tint, b = 1 - 0.3 * p.temperature;
    const k = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
    u.uPBalance.value.set(r * k, g * k, b * k);
    u.uPVignette.value.x = p.vignette;
    u.uPVignette.value.y = p.vignetteStart;
    u.uPDistortion.value = p.distortion;
  }

  _dispose() {
    this.#disposeTargets();
    this.#triangle.dispose();
    for (const m of Object.values(this.#materials)) m.dispose();
  }

  // --- passes ---------------------------------------------------------------

  #renderPasses(scene, camera) {
    const renderer = this.#renderer;
    const p = this.params;
    const q = this.qualitySettings;
    const m = this.#materials;
    const screen = renderer.getRenderTarget();
    if (screen) _size.set(screen.width, screen.height);
    else renderer.getDrawingBufferSize(_size);
    const W = _size.x, H = _size.y;
    const scale = this.effectiveScale;
    const w = Math.max(8, Math.round(W * scale)), h = Math.max(8, Math.round(H * scale));
    const upscaled = w < W || h < H;
    let passes = 1;

    // 1. The scene, in linear light. three leaves tone mapping and the
    //    conversion to sRGB out of every material when it draws to a target.
    this.#sceneTarget = this.#target(this.#sceneTarget, w, h, { type: HalfFloatType, samples: q.samples, depthBuffer: true });
    renderer.setRenderTarget(this.#sceneTarget);
    renderer.render(scene, camera);

    // 2. Bloom.
    let bloom = null, levels = 0;
    if (p.bloom && p.bloomIntensity > 0 && q.bloomLevels > 0) {
      const sizes = [];
      for (let i = 0, bw = w, bh = h; i < q.bloomLevels; i++) {
        bw = Math.round(bw / 2);
        bh = Math.round(bh / 2);
        if (Math.min(bw, bh) < 4) break;
        sizes.push([bw, bh]);
      }
      levels = sizes.length;
      for (let i = 0; i < levels; i++) {
        this.#bloomDown[i] = this.#target(this.#bloomDown[i], sizes[i][0], sizes[i][1], { type: HalfFloatType });
        if (i < levels - 1) this.#bloomUp[i] = this.#target(this.#bloomUp[i], sizes[i][0], sizes[i][1], { type: HalfFloatType });
      }
      m.prefilter.uniforms.tInput.value = this.#sceneTarget.texture;
      m.prefilter.uniforms.uPTexel.value.set(1 / w, 1 / h);
      m.prefilter.uniforms.uPBloom.value.set(p.bloomThreshold, p.bloomKnee, p.exposure);
      this.#pass(m.prefilter, this.#bloomDown[0]);
      for (let i = 1; i < levels; i++) {
        m.down.uniforms.tInput.value = this.#bloomDown[i - 1].texture;
        m.down.uniforms.uPTexel.value.set(1 / sizes[i - 1][0], 1 / sizes[i - 1][1]);
        this.#pass(m.down, this.#bloomDown[i]);
      }
      bloom = this.#bloomDown[levels - 1];
      for (let i = levels - 2; i >= 0; i--) {
        m.up.uniforms.tInput.value = bloom.texture;
        m.up.uniforms.tAdd.value = this.#bloomDown[i].texture;
        m.up.uniforms.uPTexel.value.set(p.bloomRadius / bloom.width, p.bloomRadius / bloom.height);
        this.#pass(m.up, this.#bloomUp[i]);
        bloom = this.#bloomUp[i];
      }
      passes += 2 * levels - 1;
    }

    // 3. Composite: at the internal resolution when upscaling, else straight to the screen.
    const cu = m.composite.uniforms;
    cu.tScene.value = this.#sceneTarget.texture;
    cu.tBloom.value = bloom ? bloom.texture : null;
    // The bloom was measured after exposure; the composite adds it before.
    cu.uPBloomMix.value = bloom ? p.bloomIntensity / (levels * Math.max(p.exposure, 1e-3)) : 0;
    cu.uPVignette.value.z = W / H;
    cu.uPDither.value = !upscaled && p.dither ? 1 : 0;
    if (!upscaled) {
      this.#pass(m.composite, screen);
      passes += 1;
    } else {
      this.#ldrTarget = this.#target(this.#ldrTarget, w, h, { type: UnsignedByteType });
      this.#pass(m.composite, this.#ldrTarget);
      // 4. Upscale, 5. sharpen. The last pass of the two dithers.
      const fsr = q.fsr && p.upscaler === 'fsr';
      const sharpen = p.sharpness > 0;
      let source = this.#ldrTarget;
      if (fsr) {
        m.easu.uniforms.tInput.value = source.texture;
        m.easu.uniforms.uPInputSize.value.set(w, h);
        m.easu.uniforms.uPOutputSize.value.set(W, H);
        m.easu.uniforms.uPDither.value = !sharpen && p.dither ? 1 : 0;
        if (sharpen) {
          this.#upTarget = this.#target(this.#upTarget, W, H, { type: UnsignedByteType });
          this.#pass(m.easu, this.#upTarget);
          source = this.#upTarget;
        } else {
          this.#pass(m.easu, screen);
        }
        passes += 1;
      }
      if (sharpen || !fsr) {
        m.rcas.uniforms.tInput.value = source.texture;
        m.rcas.uniforms.uPOutputSize.value.set(W, H);
        // Full strength at 1; each quarter less halves it, as in FSR's "stops".
        m.rcas.uniforms.uPSharpness.value = sharpen ? Math.pow(2, -2 * (1 - p.sharpness)) : 0;
        m.rcas.uniforms.uPDither.value = p.dither ? 1 : 0;
        this.#pass(m.rcas, screen);
        passes += 1;
      }
      passes += 1;
    }

    renderer.setRenderTarget(screen);
    this.#stats = { mode: 'post', internal: `${w} x ${h}`, passes, bloomLevels: levels };
  }

  #pass(material, target) {
    this.#quad.material = material;
    this.#renderer.setRenderTarget(target);
    this.#renderer.render(this.#quadScene, this.#quadCamera);
  }

  /** Reuse the target if it still fits, otherwise replace it. */
  #target(target, width, height, { type, samples = 0, depthBuffer = false }) {
    if (target && target.width === width && target.height === height && target.samples === samples) return target;
    target?.dispose();
    const next = new WebGLRenderTarget(width, height, {
      type,
      samples,
      depthBuffer,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    next.texture.name = 'PostProcessEngine';
    return next;
  }

  #disposeTargets() {
    for (const t of [this.#sceneTarget, this.#ldrTarget, this.#upTarget, ...this.#bloomDown, ...this.#bloomUp]) t?.dispose();
    this.#sceneTarget = this.#ldrTarget = this.#upTarget = null;
    this.#bloomDown.length = 0;
    this.#bloomUp.length = 0;
  }
}
