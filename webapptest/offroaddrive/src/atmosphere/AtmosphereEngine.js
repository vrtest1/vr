import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  GLSL3,
  HalfFloatType,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  ClampToEdgeWrapping,
} from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';
import { AtmosphereModel, generateCloudNoise } from './AtmosphereModel.js';
import {
  LUT_VERT,
  TRANSMITTANCE_FRAG,
  MULTISCATTER_FRAG,
  SKYVIEW_FRAG,
  CLOUD_FRAG,
  SKY_VERT,
  SKY_FRAG,
  AERIAL_VERT_PARS,
  AERIAL_VERT,
  AERIAL_FRAG_PARS,
  AERIAL_FRAG,
} from './shaders/atmosphere.glsl.js';

const RG = 6360;
const RAYLEIGH_550 = 13.558e-3; // per km at sea level
const MIE_EXT = 3.996e-3 + 4.4e-3;
const SUN_ANGULAR_RADIUS = 0.004675; // radians
const PATCH = Symbol('pweAerial');

const _p = new Vector3();
const _t = [0, 0, 0];
const _sky = [0, 0, 0];
const _c = new Color();
const _size = new Vector2();
const _rot = new Matrix4();
const _vp = new Matrix4();
const _z = new Color();
const _h = new Color();
const _hs = new Color();

/**
 * Sky, sun, clouds, lighting and aerial perspective.
 *
 * - Sky: physically based scattering from three small lookup textures
 *   (transmittance, multiple scattering, sky view). Only the sky view is
 *   redrawn per frame, and only when the sun or the camera height changed.
 * - Clouds: one layer, ray marched inside the sky pass.
 * - Lights: a DirectionalLight and a HemisphereLight whose colour and
 *   intensity come from the same model, so the ground matches the sky.
 * - Aerial perspective: applyTo(material) makes any three.js material fade
 *   into the sky with distance.
 *
 * Needs `await init(renderer)` before the first update.
 */
export class AtmosphereEngine extends BaseEngine {
  static engineName = 'AtmosphereEngine';

  static parameterSchema = {
    // --- sky ---
    sunIrradiance: { type: 'number', default: 20, min: 1, max: 100, step: 0.5, group: 'Sky', label: 'sun irradiance' },
    rayleighScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Sky', label: 'rayleigh (air)' },
    hazeScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Sky', label: 'haze (x visibility)' },
    mieAnisotropy: { type: 'number', default: 0.8, min: 0, max: 0.95, step: 0.01, group: 'Sky', label: 'haze anisotropy' },
    ozoneScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Sky', label: 'ozone' },
    groundAlbedo: { type: 'color', default: '#8f8a7c', group: 'Sky', label: 'ground albedo' },
    sunDiskScale: { type: 'number', default: 1, min: 0.2, max: 10, step: 0.1, group: 'Sky', label: 'sun size' },
    sunDiskBrightness: { type: 'number', default: 0.02, min: 0, max: 1, step: 0.005, group: 'Sky', label: 'sun disk brightness' },
    stars: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, group: 'Sky' },
    // --- clouds ---
    clouds: { type: 'boolean', default: true, group: 'Clouds' },
    coverageBias: { type: 'number', default: 0, min: -1, max: 1, step: 0.01, group: 'Clouds', label: 'coverage bias' },
    cloudBase: { type: 'number', default: 1600, min: 200, max: 8000, step: 10, group: 'Clouds', label: 'base (m)' },
    cloudThickness: { type: 'number', default: 1500, min: 200, max: 5000, step: 10, group: 'Clouds', label: 'thickness (m)' },
    cloudScale: { type: 'number', default: 18000, min: 2000, max: 80000, step: 100, group: 'Clouds', label: 'pattern size (m)' },
    cloudDensity: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Clouds', label: 'density' },
    temporalClouds: { type: 'boolean', default: true, group: 'Clouds', label: 'accumulate over frames' },
    cloudSpeed: { type: 'number', default: 1, min: 0, max: 30, step: 0.1, group: 'Clouds', label: 'drift (x wind)' },
    // --- light ---
    sunLightScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Light', label: 'sun light' },
    skyLightScale: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Light', label: 'sky light' },
    castShadow: { type: 'boolean', default: true, group: 'Light' },
    shadowRange: { type: 'number', default: 700, min: 50, max: 5000, step: 10, group: 'Light', label: 'shadow range (m)' },
    aerialPerspective: { type: 'number', default: 1, min: 0, max: 4, step: 0.01, group: 'Light', label: 'aerial perspective' },
  };

  /**
   * skyView          sky-view LUT size
   * skySteps         scattering samples per sky-view texel
   * cloudSteps       cloud march samples per pixel (0 turns clouds off)
   * cloudLightSteps  samples toward the sun per cloud sample
   * cloudResolution  size of the accumulated cloud buffer relative to the screen
   * cloudHistory     how much of the previous frames is kept (0..1)
   * shadowMapSize    0 disables the sun shadow
   */
  static qualityPresets = {
    ultra: { skyView: [256, 144], skySteps: 40, cloudSteps: 40, cloudLightSteps: 5, cloudResolution: 0.75, cloudHistory: 0.92, shadowMapSize: 4096 },
    high: { skyView: [192, 108], skySteps: 32, cloudSteps: 24, cloudLightSteps: 4, cloudResolution: 0.5, cloudHistory: 0.9, shadowMapSize: 2048 },
    medium: { skyView: [160, 90], skySteps: 24, cloudSteps: 12, cloudLightSteps: 2, cloudResolution: 0.5, cloudHistory: 0.9, shadowMapSize: 1024 },
    low: { skyView: [128, 72], skySteps: 16, cloudSteps: 6, cloudLightSteps: 1, cloudResolution: 0.4, cloudHistory: 0.9, shadowMapSize: 0 },
  };

  /** CPU copy of the medium, used for light colours. */
  model = new AtmosphereModel();
  /** DirectionalLight for the sun (null when created with lights: false). */
  sunLight = null;
  /** HemisphereLight for sky and ground bounce (null when created with lights: false). */
  skyLight = null;

  #renderer = null;
  #u;
  #lutScene = new Scene();
  #lutCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  #lutMesh;
  #triangle;
  #matT;
  #matMS;
  #matSky;
  #matCloud;
  #cloudTargets = [null, null];
  #cloudIndex = 0;
  #historyValid = false;
  #prevViewProj = new Matrix4();
  #prevPos = new Vector3();
  #frame = 0;
  #rtT = null;
  #rtMS = null;
  #rtSky = null;
  #noise = null;
  #dome;
  #domeMaterial;
  #fallbackEnv = null;
  #mediumDirty = true;
  #skyKey = '';
  #envVersion = -1;
  #lightKey = '';
  #patched = new Set();
  #cloudOffset = new Vector2();
  #skyUpdates = 0;

  constructor(options = {}) {
    super(options);

    this.#u = {
      uARayleighScale: { value: 1 },
      uAMieScale: { value: 1 },
      uAOzoneScale: { value: 1 },
      uAMieG: { value: 0.8 },
      uAGroundAlbedo: { value: new Color() },
      uATransmittance: { value: null },
      uAMultiScatter: { value: null },
      uASkyView: { value: null },
      uACamHeight: { value: RG + 0.01 },
      uASunDir: { value: new Vector3(0, 1, 0) },
      uASteps: { value: 32 },
      uASunIrradiance: { value: 20 },
      uASunAngularRadius: { value: SUN_ANGULAR_RADIUS },
      uASunDiskGain: { value: 0.02 },
      uAStars: { value: 1 },
      uASunLight: { value: new Vector3() },
      uAAmbient: { value: new Vector3() },
      uACloudNoise: { value: null },
      uACoverage: { value: 0 },
      uACloudBase: { value: 1.6 },
      uACloudTop: { value: 3.1 },
      uACloudScale: { value: 18 },
      uACloudDensity: { value: 25 },
      uACloudOffset: { value: this.#cloudOffset },
      uACloudSteps: { value: 24 },
      uACloudLightSteps: { value: 4 },
      uACloudLodBias: { value: 0 },
      uACloudTex: { value: null },
      uAUseCloudTex: { value: 0 },
      uAResolution: { value: new Vector2(1, 1) },
      uAHistory: { value: null },
      uAInvViewProj: { value: new Matrix4() },
      uAPrevViewProj: { value: new Matrix4() },
      uACamDelta: { value: new Vector3() },
      uAFrame: { value: 0 },
      uAHistoryWeight: { value: 0 },
      uASeaLevel: { value: 0 },
      uAFogExtinction: { value: 0 },
      uAAerial: { value: 1 },
      uAOvercast: { value: new Vector3() },
      uAOvercastMix: { value: 0 },
    };
    const u = this.#u;

    // One triangle that covers the screen, shared by the LUT passes and the sky.
    this.#triangle = new BufferGeometry();
    this.#triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

    const lut = (fragmentShader) =>
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: LUT_VERT,
        fragmentShader,
        uniforms: u,
        depthTest: false,
        depthWrite: false,
      });
    this.#matT = lut(TRANSMITTANCE_FRAG);
    this.#matMS = lut(MULTISCATTER_FRAG);
    this.#matSky = lut(SKYVIEW_FRAG);
    this.#matCloud = lut(CLOUD_FRAG);
    this.#lutMesh = new Mesh(this.#triangle, this.#matT);
    this.#lutMesh.frustumCulled = false;
    this.#lutScene.add(this.#lutMesh);

    // The sky itself: drawn at the far plane after everything opaque, so it
    // only shades pixels nothing else covered.
    this.#domeMaterial = new ShaderMaterial({
      name: 'AtmosphereEngine.sky',
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: u,
      depthWrite: false,
      fog: false,
    });
    this.#dome = new Mesh(this.#triangle, this.#domeMaterial);
    this.#dome.name = 'AtmosphereEngine.sky';
    this.#dome.frustumCulled = false;
    this.#dome.renderOrder = 10000;
    this.#dome.visible = false; // until init() has made the LUTs
    // The accumulated clouds are looked up by pixel position, so the sky has
    // to know the size of whatever it is being drawn into: the screen, or a
    // render target of another size (PostProcessEngine's render scale).
    this.#dome.onBeforeRender = (renderer) => {
      const target = renderer.getRenderTarget();
      if (target) u.uAResolution.value.set(target.width, target.height);
      else renderer.getDrawingBufferSize(u.uAResolution.value);
    };
    this.object3d.add(this.#dome);

    if (options.lights !== false) {
      this.sunLight = new DirectionalLight(0xffffff, 0);
      this.sunLight.name = 'AtmosphereEngine.sun';
      this.sunLight.shadow.bias = -0.0004;
      this.sunLight.shadow.normalBias = 1.2;
      this.skyLight = new HemisphereLight(0xffffff, 0x444444, 0);
      this.skyLight.name = 'AtmosphereEngine.skyLight';
      this.object3d.add(this.sunLight, this.sunLight.target, this.skyLight);
    }

    this._applyParameters(this.params);
    this._applyQuality(this.qualitySettings);
  }

  // --- public -------------------------------------------------------------

  /** Create the lookup textures. Must be awaited before update(). */
  async init(renderer) {
    if (!renderer) throw new Error('AtmosphereEngine.init(renderer): a WebGLRenderer is required');
    this.#renderer = renderer;
    const target = (w, h) =>
      new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        wrapS: ClampToEdgeWrapping,
        wrapT: ClampToEdgeWrapping,
        depthBuffer: false,
        generateMipmaps: false,
      });
    this.#rtT = target(256, 64);
    this.#rtMS = target(32, 32);
    this.#u.uATransmittance.value = this.#rtT.texture;
    this.#u.uAMultiScatter.value = this.#rtMS.texture;
    this.#createSkyTarget();

    const noise = new DataTexture(generateCloudNoise(256), 256, 256, RGBAFormat);
    noise.wrapS = noise.wrapT = RepeatWrapping;
    noise.minFilter = LinearMipmapLinearFilter;
    noise.magFilter = LinearFilter;
    noise.generateMipmaps = true;
    noise.needsUpdate = true;
    this.#noise = noise;
    this.#u.uACloudNoise.value = noise;

    this.#mediumDirty = true;
    this.#dome.visible = true;
    this.ready = true;
    return this;
  }

  /**
   * Add aerial perspective to a material: with distance it fades into the sky
   * colour of that direction (blue first, like real haze). Works with three's
   * built-in lit materials and with TerrainEngine's material. It replaces the
   * material's scene.fog handling. Call again after replacing a material.
   */
  applyTo(material) {
    if (material[PATCH]) return material;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const uniforms = this.#u;
    material[PATCH] = { previous, previousKey };
    material.onBeforeCompile = function (shader, renderer) {
      previous?.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${AERIAL_VERT_PARS}`)
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${AERIAL_VERT}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${AERIAL_FRAG_PARS}`)
        .replace('#include <tonemapping_fragment>', `${AERIAL_FRAG}\n#include <tonemapping_fragment>`)
        .replace('#include <fog_fragment>', '');
    };
    material.customProgramCacheKey = function () {
      return `${previousKey ? previousKey.call(this) : ''}|pwe-aerial`;
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

  /** applyTo() for every material under an object. */
  applyToObject(object3d) {
    object3d.traverse((o) => {
      if (!o.material || o === this.#dome) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial) {
          this.applyTo(m);
        }
      }
    });
  }

  update(deltaTime, camera) {
    if (!this.ready || this.disposed) return;
    const env = this.#env();
    const u = this.#u;
    const p = this.params;

    camera.updateMatrixWorld();
    _p.setFromMatrixPosition(camera.matrixWorld);
    const altitude = Math.max((_p.y - env.waterLevel) * 0.001, 0.002);
    u.uACamHeight.value = RG + Math.min(altitude, 80);
    u.uASeaLevel.value = env.waterLevel;
    u.uASunDir.value.copy(env.sunDirection);

    // Clouds drift with the wind.
    if (deltaTime > 0) {
      const k = (env.windSpeed * p.cloudSpeed * deltaTime) / p.cloudScale;
      this.#cloudOffset.x -= env.windVector.x * k;
      this.#cloudOffset.y -= env.windVector.z * k;
    }

    if (env.version !== this.#envVersion) {
      this.#envVersion = env.version;
      this.#syncEnvironment(env);
    }

    if (this.#mediumDirty) {
      this.#renderLut(this.#matT, this.#rtT);
      this.#renderLut(this.#matMS, this.#rtMS);
      this.#mediumDirty = false;
      this.#skyKey = '';
      this.#lightKey = '';
    }

    // The sky view only depends on the sun height and the camera altitude.
    const skyKey = `${env.sunDirection.y.toFixed(5)}|${altitude.toFixed(3)}`;
    if (skyKey !== this.#skyKey) {
      this.#skyKey = skyKey;
      this.#renderLut(this.#matSky, this.#rtSky);
      this.#skyUpdates++;
    }

    this.#updateLights(env, altitude);
    this.#renderClouds(camera);
  }

  getStats() {
    const q = this.qualitySettings;
    return {
      'sky lut': `${q.skyView[0]}x${q.skyView[1]}`,
      'lut redraws': this.#skyUpdates,
      'cloud steps': this.#u.uACloudSteps.value,
      'cloud buffer': this.#cloudTargets[0] && this.#u.uAUseCloudTex.value ? `${this.#cloudTargets[0].width}x${this.#cloudTargets[0].height}` : 'off',
      coverage: this.#u.uACoverage.value,
    };
  }

  // --- BaseEngine hooks ---------------------------------------------------

  _applyQuality(q) {
    const u = this.#u;
    u.uASteps.value = q.skySteps;
    u.uACloudLightSteps.value = q.cloudLightSteps;
    u.uACloudSteps.value = this.params.clouds ? q.cloudSteps : 0;
    if (this.sunLight) {
      const shadow = this.sunLight.shadow;
      this.sunLight.castShadow = this.params.castShadow && q.shadowMapSize > 0;
      if (q.shadowMapSize > 0 && shadow.mapSize.x !== q.shadowMapSize) {
        shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        shadow.map?.dispose();
        shadow.map = null;
      }
    }
    if (this.#renderer) this.#createSkyTarget();
    this.#skyKey = '';
    this.#disposeCloudTargets(); // recreated at the new resolution
  }

  _applyParameters(changed) {
    const p = this.params;
    const u = this.#u;
    const m = this.model;

    u.uASunIrradiance.value = p.sunIrradiance;
    u.uASunAngularRadius.value = SUN_ANGULAR_RADIUS * p.sunDiskScale;
    // Keep the disk's total light the same when its size changes.
    u.uASunDiskGain.value = p.sunDiskBrightness;
    u.uAStars.value = p.stars;
    u.uACloudBase.value = p.cloudBase * 0.001;
    u.uACloudTop.value = (p.cloudBase + p.cloudThickness) * 0.001;
    u.uACloudScale.value = p.cloudScale * 0.001;
    u.uACloudDensity.value = p.cloudDensity * 25;
    u.uACloudSteps.value = p.clouds ? this.qualitySettings.cloudSteps : 0;
    u.uAAerial.value = p.aerialPerspective;
    if (this.sunLight) this.sunLight.castShadow = p.castShadow && this.qualitySettings.shadowMapSize > 0;

    if ('rayleighScale' in changed || 'ozoneScale' in changed || 'mieAnisotropy' in changed ||
        'groundAlbedo' in changed || 'hazeScale' in changed) {
      m.rayleighScale = u.uARayleighScale.value = p.rayleighScale;
      m.ozoneScale = u.uAOzoneScale.value = p.ozoneScale;
      m.mieG = u.uAMieG.value = p.mieAnisotropy;
      u.uAGroundAlbedo.value.set(p.groundAlbedo);
      this.#mediumDirty = true;
      this.#envVersion = -1; // haze depends on visibility * hazeScale
    }
    this.#lightKey = '';
  }

  _dispose() {
    for (const material of [...this.#patched]) this.removeFrom(material);
    this.#rtT?.dispose();
    this.#rtMS?.dispose();
    this.#rtSky?.dispose();
    this.#disposeCloudTargets();
    this.#matCloud.dispose();
    this.#noise?.dispose();
    this.#matT.dispose();
    this.#matMS.dispose();
    this.#matSky.dispose();
    this.#domeMaterial.dispose();
    this.#triangle.dispose();
    this.sunLight?.shadow.map?.dispose();
    this.sunLight?.dispose();
    this.skyLight?.dispose();
  }

  // --- internals ----------------------------------------------------------

  #env() {
    return this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
  }

  #createSkyTarget() {
    const [w, h] = this.qualitySettings.skyView;
    if (this.#rtSky && this.#rtSky.width === w && this.#rtSky.height === h) return;
    this.#rtSky?.dispose();
    this.#rtSky = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping, // azimuth wraps around
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.#u.uASkyView.value = this.#rtSky.texture;
    this.#skyKey = '';
  }

  #disposeCloudTargets() {
    this.#cloudTargets[0]?.dispose();
    this.#cloudTargets[1]?.dispose();
    this.#cloudTargets[0] = this.#cloudTargets[1] = null;
    this.#historyValid = false;
    this.#u.uAUseCloudTex.value = 0;
  }

  /**
   * Draw this frame's clouds into the accumulation buffer. Every frame marches
   * with a different sample offset and is blended with the reprojected result
   * of the frames before, which is what lets a few steps look like many.
   */
  #renderClouds(camera) {
    const u = this.#u;
    const p = this.params;
    const renderer = this.#renderer;
    const q = this.qualitySettings;
    // XR draws two eyes with their own cameras; there the sky pass marches directly.
    if (!p.clouds || !p.temporalClouds || u.uACoverage.value <= 0.001 || renderer.xr.isPresenting) {
      u.uAUseCloudTex.value = 0;
      u.uACloudLodBias.value = 0;
      this.#historyValid = false;
      return;
    }

    renderer.getDrawingBufferSize(_size);
    u.uAResolution.value.copy(_size);
    const w = Math.max(8, Math.round(_size.x * q.cloudResolution));
    const h = Math.max(8, Math.round(_size.y * q.cloudResolution));
    if (!this.#cloudTargets[0] || this.#cloudTargets[0].width !== w || this.#cloudTargets[0].height !== h) {
      this.#disposeCloudTargets();
      for (let i = 0; i < 2; i++) {
        this.#cloudTargets[i] = new WebGLRenderTarget(w, h, {
          type: HalfFloatType,
          format: RGBAFormat,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
          wrapS: ClampToEdgeWrapping,
          wrapT: ClampToEdgeWrapping,
          depthBuffer: false,
          generateMipmaps: false,
        });
      }
    }

    // View-projection without the camera position: directions stay precise
    // however far the camera is from the origin.
    _rot.extractRotation(camera.matrixWorld).transpose();
    _vp.multiplyMatrices(camera.projectionMatrix, _rot);
    u.uAInvViewProj.value.copy(_vp).invert();
    u.uAPrevViewProj.value.copy(this.#prevViewProj);
    u.uACamDelta.value.copy(_p).sub(this.#prevPos).multiplyScalar(0.001);
    u.uAFrame.value = this.#frame = (this.#frame + 1) % 1024;
    u.uAHistoryWeight.value = this.#historyValid ? q.cloudHistory : 0;
    // With accumulation the noise can be read one-and-a-half mips sharper.
    u.uACloudLodBias.value = -1.5;

    const target = this.#cloudTargets[this.#cloudIndex];
    u.uAHistory.value = this.#cloudTargets[1 - this.#cloudIndex].texture;
    this.#renderLut(this.#matCloud, target);
    u.uACloudTex.value = target.texture;
    u.uAUseCloudTex.value = 1;
    this.#cloudIndex = 1 - this.#cloudIndex;
    this.#prevViewProj.copy(_vp);
    this.#prevPos.copy(_p);
    this.#historyValid = true;
  }

  #renderLut(material, target) {
    const renderer = this.#renderer;
    const previousTarget = renderer.getRenderTarget();
    const xrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false; // LUTs are plain 2D passes, even during an XR session
    this.#lutMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.#lutScene, this.#lutCamera);
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = xrEnabled;
  }

  /** Visibility becomes haze; cloud cover becomes cloud coverage. */
  #syncEnvironment(env) {
    const u = this.#u;
    const p = this.params;
    // Koschmieder: total extinction = 3.912 / visibility. What Rayleigh does
    // not explain is haze.
    const visKm = env.visibility * 0.001;
    const total = 3.912 / visKm;
    const haze = Math.max(total - RAYLEIGH_550, 0.25 * MIE_EXT) * p.hazeScale;
    // The sky model is only valid for moderate haze; thicker fog is added as
    // plain grey extinction in the aerial perspective.
    const mieScale = Math.min(haze / MIE_EXT, 40);
    u.uAFogExtinction.value = Math.max(haze - mieScale * MIE_EXT, 0);
    if (Math.abs(mieScale - u.uAMieScale.value) > 1e-4) {
      this.model.mieScale = u.uAMieScale.value = mieScale;
      this.#mediumDirty = true;
    }
    const cover = Math.min(1, Math.max(0, env.cloudCover + p.coverageBias));
    u.uACoverage.value = Math.pow(cover, 0.55);
    u.uAOvercastMix.value = 0.85 * cover * cover;
    this.#lightKey = '';
  }

  #updateLights(env, altitude) {
    const p = this.params;
    const u = this.#u;
    const sunY = env.sunDirection.y;
    const key = `${sunY.toFixed(4)}|${altitude.toFixed(2)}|${env.version}`;
    const m = this.model;

    if (key !== this.#lightKey) {
      this.#lightKey = key;
      const E = p.sunIrradiance;
      const cover = Math.min(1, Math.max(0, env.cloudCover + p.coverageBias));

      // Sunlight at the ground and at the cloud layer.
      m.transmittance(u.uACloudBase.value, sunY, _t);
      u.uASunLight.value.set(_t[0] * E, _t[1] * E, _t[2] * E);
      m.transmittance(altitude, sunY, _t);
      const cloudShade = 1 - 0.85 * Math.pow(cover, 2.5);

      // Sky light. A faint floor keeps nights readable.
      m.meanSkyRadiance(altitude, sunY, _sky);
      const night = 0.0006;
      const skyR = _sky[0] + night * 0.6, skyG = _sky[1] + night * 0.8, skyB = _sky[2] + night * 1.4;
      // Under cloud the sky light turns grey and comes from the cloud deck.
      const grey = (skyR + skyG + skyB) / 3 + 0.02 * Math.max(sunY, 0) * (_t[0] + _t[1] + _t[2]) / 3;
      const k = cover * cover;
      const aR = skyR + (grey - skyR) * k, aG = skyG + (grey - skyG) * k, aB = skyB + (grey - skyB) * k;
      u.uAAmbient.value.set(aR * E, aG * E, aB * E);
      u.uAOvercast.value.set(grey * E * 1.6, grey * E * 1.65, grey * E * 1.7);

      // Publish sky colours for engines that reflect the sky.
      const og = grey * 1.6;
      const sky3 = (viewCos, azimuth, target) => {
        m.skyRadiance(altitude, sunY, viewCos, azimuth, _sky);
        return target.setRGB(
          (_sky[0] + night + (og - _sky[0]) * k) * E,
          (_sky[1] + night + (og - _sky[1]) * k) * E,
          (_sky[2] + night * 2 + (og - _sky[2]) * k) * E,
        );
      };
      env.setSkyColors(sky3(0.95, 1.6, _z), sky3(0.06, 2.6, _h), sky3(0.06, 0.5, _hs));

      if (this.sunLight) {
        const peak = Math.max(_t[0], _t[1], _t[2], 1e-5);
        this.sunLight.color.setRGB(_t[0] / peak, _t[1] / peak, _t[2] / peak);
        this.sunLight.intensity = E * peak * cloudShade * p.sunLightScale;

        // Hemisphere light colours are irradiance: PI * mean radiance from above,
        // and what a grey-brown ground bounces back from below.
        const skyE = Math.PI * E * p.skyLightScale;
        const peakSky = Math.max(aR, aG, aB, 1e-6);
        this.skyLight.color.setRGB(aR / peakSky, aG / peakSky, aB / peakSky);
        this.skyLight.intensity = skyE * peakSky;
        const down = E * Math.max(sunY, 0) * cloudShade;
        const g = 0.22 / Math.max(skyE * peakSky, 1e-6);
        _c.setRGB(
          (down * _t[0] + skyE * aR) * g * 1.05,
          (down * _t[1] + skyE * aG) * g,
          (down * _t[2] + skyE * aB) * g * 0.8,
        );
        this.skyLight.groundColor.copy(_c);
      }
    }

    if (this.sunLight) {
      // Shadow frustum centred on the camera, snapped to shadow texels so
      // shadows do not swim when the camera moves.
      const light = this.sunLight;
      const r = p.shadowRange;
      const cam = light.shadow.camera;
      if (cam.right !== r) {
        cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
        cam.near = 1; cam.far = 8000;
        cam.updateProjectionMatrix();
      }
      const texel = (2 * r) / light.shadow.mapSize.x;
      const tx = Math.round(_p.x / texel) * texel;
      const ty = Math.round(_p.y / texel) * texel;
      const tz = Math.round(_p.z / texel) * texel;
      const d = env.sunDirection;
      light.target.position.set(tx, ty, tz);
      light.position.set(tx + d.x * 4000, ty + Math.max(d.y, 0.02) * 4000, tz + d.z * 4000);
    }
  }
}
