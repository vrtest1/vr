import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBADepthPacking,
  Scene,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { WorldEnvironment } from '../core/WorldEnvironment.js';
import { hash2 } from '../core/noise.js';
import { NOISE_GLSL } from '../core/shaders/noise.glsl.js';
import { GRASS_VERT, GRASS_FRAG, FLAT_GROUND_GLSL } from './shaders/grass.glsl.js';
import {
  TREE_VERT_PARS, TREE_NORMAL, TREE_COLOR, TREE_VERT, TREE_CULL, TREE_LOGDEPTH, TREE_LOGDEPTH_PARS,
  TREE_FRAG_PARS, TREE_FRAG_DITHER, TREE_FRAG_SURFACE, TREE_FRAG_NORMAL, TREE_FRAG_LIGHT,
  BILLBOARD_VERT, BILLBOARD_FRAG, BAKE_VERT, BAKE_FRAG,
} from './shaders/tree.glsl.js';
import { buildTreeModel, createTreeGeometry } from './treeGeometry.js';
import { createLeafAtlas } from './leafAtlas.js';
import { COVER_GLSL } from './shaders/grass.glsl.js';

const CHUNK = 320; // metres per tree chunk
const HALF_DIAGONAL = CHUNK * Math.SQRT1_2;
const RECORD = 9; // numbers per tree: x, y, z, yaw, scale across, scale up, model, random, birth
const NEAR_STEP = 4; // the lists of nearby trees are rebuilt when the camera has moved this far (m)
const FADE_BAND = 0.2; // share of each hand-over distance over which two levels of detail are mixed
const PAD = 1.04; // margin around a tree in its billboard

// The tree models: [species, seed]. Two different individuals of each real tree.
const MODELS = [
  ['spruce', 11], ['spruce', 12], ['pine', 21], ['pine', 22], ['oak', 31], ['oak', 32],
  ['birch', 41], ['birch', 42], ['bush', 51], ['snag', 61],
];
const TRUNK_RADIUS = { spruce: 0.36, pine: 0.32, oak: 0.5, birch: 0.2, snag: 0.3 }; // trunk + some flare, m at scale 1
const FIRST = { spruce: 0, pine: 2, oak: 4, birch: 6, bush: 8, snag: 9 };

// One billboard: an upright card (z = 0) and a flat one seen from above (z = 1).
const CARD_POSITIONS = [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1];
const CARD_INDEX = [0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7];

const _p = new Vector3();
const _last = new Vector3();
const _color = new Color();
const _sample = {};
const _sample2 = {};
// Trees judge the slope over this many metres, not at a point.
const SLOPE_SPAN = 14;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const unit = (h) => h / 4294967296;
const MAX_SHAKES = 16; // bushes swaying at once (setBushShake); also in tree.glsl.js
const MAX_CUTS = 8; // boxes the grass keeps out of (setGrassCutouts); also in grass.glsl.js
// A smooth random field, 0..1, with features `size` metres across.
const smoothField = (x, z, size, s) => {
  const px = x / size, pz = z / size;
  const ix = Math.floor(px), iz = Math.floor(pz);
  const fx = px - ix, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const v = (i, j) => unit(hash2(ix + i, iz + j, s));
  return v(0, 0) * (1 - ux) * (1 - uz) + v(1, 0) * ux * (1 - uz) + v(0, 1) * (1 - ux) * uz + v(1, 1) * ux * uz;
};

/**
 * Grass and trees.
 *
 * Grass is drawn as instanced blades that are placed, shaped and blown by the
 * wind entirely in the vertex shader; the CPU does nothing per blade.
 *
 * Trees are placed on the CPU, one chunk of forest per frame. Each tree is
 * drawn in one of three ways, chosen per tree by its distance: the full mesh
 * with branches and leaf cards, a lighter mesh, or a billboard baked from the
 * mesh. Neighbouring levels are mixed with a dither pattern over a band of
 * distance, so nothing pops.
 *
 * Where things grow comes from the ground description you pass in. Without
 * one, everything grows evenly on a flat plane.
 */
export class VegetationEngine extends BaseEngine {
  static engineName = 'VegetationEngine';

  static parameterSchema = {
    grass: { type: 'boolean', default: true, group: 'Grass' },
    grassDensity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, group: 'Grass', label: 'density' },
    grassHeight: { type: 'number', default: 0.5, min: 0.05, max: 2, step: 0.01, group: 'Grass', label: 'height (m)' },
    grassWidth: { type: 'number', default: 0.04, min: 0.005, max: 0.2, step: 0.001, group: 'Grass', label: 'blade width (m)' },
    grassColor: { type: 'color', default: '#4f7a2c', group: 'Grass' },
    dryGrassColor: { type: 'color', default: '#8f8650', group: 'Grass' },
    trees: { type: 'boolean', default: true, group: 'Trees' },
    canopyColor: { type: 'color', default: '#2c4a1c', group: 'Trees', label: 'forest colour far away' },
    treeDensity: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, group: 'Trees', label: 'density' },
    bushDensity: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Trees', label: 'bushes' },
    treeScale: { type: 'number', default: 1, min: 0.3, max: 3, step: 0.01, group: 'Trees', label: 'size' },
    lodScale: { type: 'number', default: 1, min: 0.3, max: 2, step: 0.01, group: 'Trees', label: 'detail distance (x)' },
    castShadow: { type: 'boolean', default: true, group: 'Trees' },
    wind: { type: 'number', default: 1, min: 0, max: 3, step: 0.01, group: 'Wind', label: 'wind response' },
    seed: { type: 'int', default: 1, min: 0, max: 9999, step: 1, group: 'Wind' },
  };

  /**
   * near / far     grass patches: [cells per side, spacing in metres] (far may be null)
   * segments       quads per blade
   * treeRange      trees are placed out to this distance (m)
   * treeLod        [full mesh within, lighter mesh within] (m); billboards beyond
   * treeSpacing    metres between candidate tree positions
   * treeShadows    2 = both meshes cast shadows, 1 = only the full mesh, 0 = none
   * impostor       pixels per tree in the billboard atlas
   */
  static qualityPresets = {
    ultra: { near: [384, 0.14], far: [256, 0.7], segments: 4, treeRange: 2600, treeLod: [140, 400], treeSpacing: 8, treeShadows: 2, impostor: 256 },
    high: { near: [288, 0.16], far: [192, 0.8], segments: 3, treeRange: 2000, treeLod: [110, 340], treeSpacing: 9, treeShadows: 2, impostor: 256 },
    medium: { near: [192, 0.2], far: [128, 0.9], segments: 2, treeRange: 1300, treeLod: [70, 220], treeSpacing: 11, treeShadows: 1, impostor: 192 },
    low: { near: [128, 0.28], far: null, segments: 2, treeRange: 800, treeLod: [40, 130], treeSpacing: 13, treeShadows: 0, impostor: 128 },
  };

  #shared;
  #ground;
  #sampler;
  #hasSampler = false;
  #grass = []; // { mesh, material, geometry, uniforms }
  #time = 0;
  #now = 0;
  #fallbackEnv = null;

  #treeGroup = new Group();
  #models; // from buildTreeModel()
  #leafAtlas;
  #treeMaterials = []; // [lighter mesh, full mesh]
  #treeDepthMaterials = [];
  #billboardMaterial;
  #near = []; // per model and level: { model, lod, mesh, geometry, a, b, attrA, attrB, capacity, count }
  #nearDirty = true;
  #nearCounts = [0, 0];
  #rings = null;
  #chunks = new Map();
  #treeCount = 0;
  #pending = 0;
  #renderer = null;
  #probe = null;
  #atlas = null; // { albedo, normal, cell }
  #atlasDirty = true;

  /**
   * @param {object} [options.ground] `{ glsl, uniforms }` for the grass, defining
   *   `vec3 pwvGroundHeight(vec2 xz)` and `vec2 pwvGroundInfo(vec3 pos, vec3 normal)`.
   *   With TerrainEngine: `terrain.getGroundShader()`.
   * @param {function} [options.sample] `(x, z, out) => out` for the trees, filling
   *   `{ height, slope, vegetation, moisture, temperature }` (slope = 1 - normal.y).
   *   With TerrainEngine: `(x, z, out) => terrain.getBiomeAt(x, z, out)`.
   * @param {number} [options.groundY] height of the flat ground used when neither is given
   */
  constructor(options = {}) {
    super(options);
    this.#ground = options.ground ?? null;
    const groundY = options.groundY ?? 0;
    this.#hasSampler = !!options.sample;
    this.#sampler = options.sample ?? ((x, z, out) => {
      out.height = groundY; out.slope = 0; out.vegetation = 1; out.moisture = 0.6; out.temperature = 15;
      return out;
    });

    this.#shared = {
      uVCam: { value: new Vector3() },
      uVTime: { value: 0 },
      uVNow: { value: 0 },
      uVWind: { value: new Vector2() },
      uVHeight: { value: 0.5 },
      uVWaterLevel: { value: -1e6 },
      uVDensity: { value: 1 },
      uVColor: { value: new Color() },
      uVDryColor: { value: new Color() },
      uVGroundY: { value: groundY },
      uVLod: { value: new Vector4(80, 100, 240, 300) },
      uVRange: { value: new Vector2(1700, 2000) },
      uVCover: { value: new Vector4(1, 1, 0, 0) },
      uVCanopy: { value: new Color() },
      // One cheap light for the grass that is not a three.js light (see setGrassLamp).
      uVLampPos: { value: new Vector3() },
      uVLampDir: { value: new Vector3(0, 0, 1) },
      uVLampColor: { value: new Color(0, 0, 0) },
      uVLampRange: { value: 8 },
      // Things standing in the grass (vehicles): see setGrassCutouts.
      uVCut: { value: Array.from({ length: MAX_CUTS }, () => new Vector4()) },
      uVCutSize: { value: Array.from({ length: MAX_CUTS }, () => new Vector4()) },
      uVCutCount: { value: 0 },
      // Bushes swaying after something pushed through them: see setBushShake.
      uVShake: { value: Array.from({ length: MAX_SHAKES }, () => new Vector4()) },
      uVShakeCount: { value: 0 },
    };

    this.#models = MODELS.map(([species, seed]) => buildTreeModel(species, seed));
    this.#leafAtlas = createLeafAtlas(256);
    for (const lod of [1, 2]) {
      this.#treeMaterials.push(this.#createTreeMaterial(lod, false));
      this.#treeDepthMaterials.push(this.#createTreeMaterial(lod, true));
    }
    this.#billboardMaterial = this.#createBillboardMaterial();

    this.#treeGroup.name = 'VegetationEngine.trees';
    this.object3d.add(this.#treeGroup);

    // The billboards are baked with the renderer. If init(renderer) is never
    // called, this invisible object picks the renderer up from the first frame.
    const probe = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    probe.name = 'VegetationEngine.probe';
    probe.frustumCulled = false;
    probe.onBeforeRender = (renderer) => { this.#renderer ??= renderer; };
    this.object3d.add(probe);
    this.#probe = probe;

    this._applyParameters(this.params);
    this._applyQuality(this.qualitySettings);
  }

  // --- public -------------------------------------------------------------

  /**
   * Optional. Gives the engine the renderer it bakes the tree billboards with;
   * without it the renderer is taken from the first rendered frame.
   */
  async init(renderer) {
    if (renderer) this.#renderer = renderer;
    return super.init(renderer);
  }

  /** Grass materials (one per patch), e.g. for `atmosphere.applyTo(m)`. */
  /**
   * A light that only the grass sees (and so costs nothing elsewhere): e.g. a
   * vehicle's rear lamps, whose light on the ground is drawn separately.
   * @param {Vector3} position  world
   * @param {Vector3} direction world, unit: it shines this way and to the sides, not back
   * @param {Color} color       colour x intensity (candela); black turns it off
   * @param {number} [range]    m
   */
  setGrassLamp(position, direction, color, range = 8) {
    const u = this.#shared;
    u.uVLampPos.value.copy(position);
    u.uVLampDir.value.copy(direction);
    u.uVLampColor.value.copy(color);
    u.uVLampRange.value = range;
  }

  /**
   * Keep the grass out of things standing in it (offroad-drive's trucks): under
   * each box, blades grow no taller than its clearance, rising back to their
   * height a little way outside it. Bushes and low branches inside a box (below
   * its roof) are pushed out to its sides. Up to MAX_CUTS (8) boxes.
   * @param {{x: number, z: number, rightX: number, rightZ: number, halfWidth: number, halfLength: number, clearance: number, top?: number}[]} list
   *   centre on the ground, the box's right-hand direction (unit, xz), half sizes,
   *   how high its underside is above the ground and its roof (m)
   */
  setGrassCutouts(list) {
    const u = this.#shared;
    const n = Math.min(MAX_CUTS, list.length);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      u.uVCut.value[i].set(c.x, c.z, c.rightX, c.rightZ);
      u.uVCutSize.value[i].set(c.halfWidth, c.halfLength, Math.max(0, c.clearance), c.top ?? 2);
    }
    u.uVCutCount.value = n;
  }

  /**
   * Bushes that something has just pushed through sway for a while. Each entry
   * names a bush by where it stands (as forEachBushNear gave it), how hard it
   * sways (0..1, the caller lets it die away) and which way it was pushed.
   * @param {{x: number, z: number, energy: number, angle: number}[]} list  up to 16
   */
  setBushShake(list) {
    const u = this.#shared;
    const n = Math.min(MAX_SHAKES, list.length);
    for (let i = 0; i < n; i++) u.uVShake.value[i].set(list[i].x, list[i].z, list[i].energy, list[i].angle);
    u.uVShakeCount.value = n;
  }

  get grassMaterials() {
    return this.#grass.map((g) => g.material);
  }

  /** Tree materials: the lighter mesh, the full mesh and the billboards. */
  get treeMaterials() {
    return [...this.#treeMaterials, this.#billboardMaterial];
  }

  /**
   * The colour of what grows here, for the ground underneath and for ground
   * too far away to have its grass and trees drawn. With TerrainEngine:
   * `terrain.setCover(vegetation.getCoverShader())`. The meadow then keeps
   * its colour past the last blade of grass, and the forest past the last tree.
   * @returns {{ glsl: string, uniforms: object }} see TerrainEngine.setCover()
   */
  getCoverShader() {
    const u = this.#shared;
    const uniforms = {};
    for (const name of ['uVCam', 'uVColor', 'uVDryColor', 'uVDensity', 'uVRange', 'uVCover', 'uVCanopy']) uniforms[name] = u[name];
    return { glsl: COVER_GLSL, uniforms };
  }

  /** Every material of this engine, for applyTo-style helpers. */
  get materials() {
    return [...this.grassMaterials, ...this.treeMaterials];
  }

  /** The tree models in use: `{ species, seed, height, radius }` each. */
  get treeModels() {
    return this.#models.map(({ species, seed, height, radius }) => ({ species, seed, height, radius }));
  }

  update(deltaTime, camera) {
    if (this.disposed) return;
    const env = this.environment ?? (this.#fallbackEnv ??= new WorldEnvironment());
    const u = this.#shared;
    const p = this.params;
    if (deltaTime > 0) {
      this.#time += deltaTime;
      this.#now += deltaTime;
    }
    u.uVTime.value = this.#time % 3600;
    u.uVNow.value = this.#now;
    // Keeping plants out of the water only makes sense when we know the real
    // ground; the default flat ground is not a shoreline.
    u.uVWaterLevel.value = this.#ground ? env.waterLevel : -1e6;
    const strength = Math.min(env.windSpeed / 12, 1.3) * p.wind;
    u.uVWind.value.set(env.windVector.x, env.windVector.z).multiplyScalar(strength);

    camera.updateMatrixWorld();
    _p.setFromMatrixPosition(camera.matrixWorld);
    u.uVCam.value.copy(_p);

    if (this.#renderer) {
      if (this.#probe) {
        this.#probe.removeFromParent();
        this.#probe.material.dispose();
        this.#probe = null;
      }
      if (this.#atlasDirty && p.trees) this.#bakeBillboards(this.#renderer);
    }
    this.#updateTrees(env);
  }

  /**
   * Trunks near (x, z) for collision (added for the offroad-drive app).
   * Bushes are left out. Calls `visit(tx, ty, tz, trunkRadius)` for each tree
   * whose trunk lies within `range` metres.
   */
  /**
   * How likely a tree is to grow at (x, z), 0..1: the forest patches and the
   * climate, as #buildChunk decides them (without the slope). Works anywhere,
   * built or not, so an app can look for open ground (offroad-drive's start).
   */
  treeChanceAt(x, z) {
    const p = this.params;
    const s = this.#sampler(x, z, _sample);
    const patch = smoothField(x, z, 140, p.seed * 131 + 7 + 9);
    const climate = s.vegetation * smoothstep(1, 6, s.temperature) * (1 - smoothstep(27, 33, s.temperature));
    return climate * (0.1 + 0.9 * smoothstep(0.3, 0.65, s.moisture)) * smoothstep(0.3, 0.6, patch) * p.treeDensity;
  }

  /**
   * Every bush within `range` of (x, z): visit(x, y, z, radius). Only the
   * built chunks (near the camera). For things that brush through them.
   */
  forEachBushNear(x, z, range, visit) {
    const r0 = this.#models[FIRST.bush]?.radius ?? 1;
    const cx0 = Math.floor((x - range) / CHUNK), cx1 = Math.floor((x + range) / CHUNK);
    const cz0 = Math.floor((z - range) / CHUNK), cz1 = Math.floor((z + range) / CHUNK);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.#chunks.get(`${cx},${cz}`);
        if (!chunk || !chunk.count) continue;
        const d = chunk.data;
        for (let i = 0; i < d.length; i += RECORD) {
          if (d[i + 6] !== FIRST.bush) continue;
          const dx = d[i] - x, dz = d[i + 2] - z;
          if (dx * dx + dz * dz > range * range) continue;
          visit(d[i], d[i + 1], d[i + 2], r0 * d[i + 4]);
        }
      }
    }
  }

  forEachTrunkNear(x, z, range, visit) {
    const cx0 = Math.floor((x - range) / CHUNK), cx1 = Math.floor((x + range) / CHUNK);
    const cz0 = Math.floor((z - range) / CHUNK), cz1 = Math.floor((z + range) / CHUNK);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.#chunks.get(`${cx},${cz}`);
        if (!chunk || !chunk.count) continue;
        const d = chunk.data;
        for (let i = 0; i < d.length; i += RECORD) {
          const model = d[i + 6];
          if (model === FIRST.bush) continue;
          const dx = d[i] - x, dz = d[i + 2] - z;
          if (dx * dx + dz * dz > range * range) continue;
          const r = (TRUNK_RADIUS[this.#models[model]?.species] ?? 0.3) * d[i + 4];
          visit(d[i], d[i + 1], d[i + 2], Math.max(0.12, r));
        }
      }
    }
  }

  getStats() {
    let blades = 0;
    for (const g of this.#grass) if (g.mesh.visible) blades += g.geometry.instanceCount;
    return {
      'grass slots': blades,
      trees: this.#treeCount,
      'full trees': this.#nearCounts[1],
      'light trees': this.#nearCounts[0],
      chunks: this.#chunks.size,
      pending: this.#pending,
    };
  }

  // --- BaseEngine hooks ---------------------------------------------------

  _applyQuality(q) {
    this.#disposeGrass();
    const near = this.#createGrass(q.near[0], q.near[1], q.segments, 0);
    this.#grass.push(near);
    if (q.far) {
      const nearRadius = 0.5 * q.near[0] * q.near[1];
      this.#grass.push(this.#createGrass(q.far[0], q.far[1], Math.max(1, q.segments - 1), nearRadius));
    }
    for (const g of this.#grass) g.mesh.visible = this.params.grass;

    this.#clearChunks();
    this.#createNear();
    if (this.#atlas?.cell !== q.impostor) this.#atlasDirty = true;
  }

  _applyParameters(changed) {
    const p = this.params;
    const u = this.#shared;
    u.uVHeight.value = p.grassHeight;
    u.uVDensity.value = p.grassDensity;
    u.uVColor.value.set(p.grassColor);
    u.uVDryColor.value.set(p.dryGrassColor);
    u.uVCanopy.value.set(p.canopyColor);
    // Grass on / off, trees on / off times their density, and the seed of the forest patches.
    u.uVCover.value.set(p.grass ? 1 : 0, p.trees ? p.treeDensity : 0, p.seed * 131 + 7 + 9, 0);
    for (const g of this.#grass) {
      g.mesh.visible = p.grass;
      g.uniforms.uVWidth.value = p.grassWidth;
    }
    this.#treeGroup.visible = p.trees;
    if ('treeDensity' in changed || 'bushDensity' in changed || 'treeScale' in changed || 'seed' in changed) this.#clearChunks();
    if (this.#near.length && ('lodScale' in changed || 'castShadow' in changed)) this.#createNear();
  }

  _dispose() {
    this.#disposeGrass();
    this.#clearChunks();
    this.#disposeNear();
    for (const m of [...this.#treeMaterials, ...this.#treeDepthMaterials, this.#billboardMaterial]) m.dispose();
    this.#leafAtlas.dispose();
    this.#atlas?.albedo.dispose();
    this.#atlas?.normal.dispose();
    this.#atlas = null;
    this.#probe?.material.dispose();
    this.#renderer = null;
  }

  // --- grass --------------------------------------------------------------

  #createGrass(count, spacing, segments, innerRadius) {
    const geometry = new InstancedBufferGeometry();
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      positions.set([-1, t, 0, 1, t, 0], i * 6);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const cells = new Float32Array(count * count * 2);
    let k = 0;
    for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) { cells[k++] = i; cells[k++] = j; }
    geometry.setAttribute('aCell', new InstancedBufferAttribute(cells, 2));
    geometry.instanceCount = count * count;

    const radius = 0.5 * count * spacing;
    const own = {
      uVSpacing: { value: spacing },
      uVCount: { value: count },
      uVFade: { value: new Vector2(radius * 0.55, radius * 0.97) },
      uVInner: { value: innerRadius },
      uVWidth: { value: this.params.grassWidth },
    };
    const uniforms = UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]);
    Object.assign(uniforms, this.#shared, own, this.#ground?.uniforms);
    const groundGlsl = this.#ground ? this.#ground.glsl : FLAT_GROUND_GLSL;
    const material = new ShaderMaterial({
      name: 'VegetationEngine.grass',
      uniforms,
      vertexShader: GRASS_VERT.replace('PWV_NOISE_GLSL', NOISE_GLSL).replace('PWV_GROUND_GLSL', groundGlsl)
        .replace('PWV_LOGDEPTH_PARS', TREE_LOGDEPTH_PARS).replace('PWV_LOGDEPTH', TREE_LOGDEPTH),
      fragmentShader: GRASS_FRAG,
      lights: true,
      fog: true,
      side: DoubleSide,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = 'VegetationEngine.grass';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    this.object3d.add(mesh);
    return { mesh, material, geometry, uniforms: own };
  }

  #disposeGrass() {
    for (const g of this.#grass) {
      g.mesh.removeFromParent();
      g.geometry.dispose();
      g.material.dispose();
    }
    this.#grass.length = 0;
  }

  // --- trees: materials ----------------------------------------------------

  /** MeshLambertMaterial (or its depth-only twin for shadows) that places, sways and fades trees. */
  #createTreeMaterial(lod, depth) {
    const shared = this.#shared;
    const material = depth
      ? new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
      : new MeshLambertMaterial({ vertexColors: true, map: this.#leafAtlas, alphaTest: 0.45, side: DoubleSide, alphaToCoverage: true });
    material.name = `VegetationEngine.tree${lod === 2 ? 'Full' : 'Light'}${depth ? 'Depth' : ''}`;
    material.defines = { ...material.defines, PWV_LOD: lod };
    if (depth) material.defines.PWV_DEPTH = 1;
    material.onBeforeCompile = (shader) => {
      for (const name of ['uVCam', 'uVTime', 'uVNow', 'uVWind', 'uVLod', 'uVCut', 'uVCutSize', 'uVCutCount', 'uVShake', 'uVShakeCount']) shader.uniforms[name] = shared[name];
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TREE_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${TREE_NORMAL}`)
        .replace('#include <color_vertex>', `#include <color_vertex>\n${TREE_COLOR}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TREE_VERT}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${TREE_CULL}`)
        .replace('#include <logdepthbuf_vertex>', TREE_LOGDEPTH);
      // The depth is set per vertex (see TREE_LOGDEPTH), so the fragment shader leaves it alone.
      if (depth) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', '');
        return;
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TREE_FRAG_PARS}`)
        .replace('#include <logdepthbuf_fragment>', TREE_FRAG_DITHER)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${TREE_FRAG_SURFACE}`)
        .replace('#include <normal_fragment_begin>', TREE_FRAG_NORMAL)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${TREE_FRAG_LIGHT}`);
    };
    material.customProgramCacheKey = () => `pwe-tree-${lod}-${depth ? 'depth' : 'color'}`;
    return material;
  }

  #createBillboardMaterial() {
    const uniforms = UniformsUtils.merge([UniformsLib.lights, UniformsLib.fog]);
    Object.assign(uniforms, this.#shared, {
      uVAlbedo: { value: null },
      uVNormal: { value: null },
      // Half width, bottom, top and crown height of each model's billboard (m).
      uVModel: { value: this.#models.map((m) => new Vector4(m.radius * PAD, -0.4 - m.height * (PAD - 1), m.height * PAD, m.crownY)) },
    });
    return new ShaderMaterial({
      name: 'VegetationEngine.billboard',
      uniforms,
      defines: { PWV_MODELS: this.#models.length },
      vertexShader: BILLBOARD_VERT,
      fragmentShader: BILLBOARD_FRAG,
      lights: true,
      fog: true,
      side: DoubleSide,
    });
  }

  // --- trees: billboards ---------------------------------------------------

  /**
   * Draw every model from the side and from above into two atlases (colour
   * and normals), one column per model. The far trees are drawn from these.
   */
  #bakeBillboards(renderer) {
    const cell = this.qualitySettings.impostor;
    const count = this.#models.length;
    this.#atlas?.albedo.dispose();
    this.#atlas?.normal.dispose();
    const target = (srgb) => {
      const rt = new WebGLRenderTarget(cell * count, cell * 2, {
        samples: 4, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
      });
      if (srgb) rt.texture.colorSpace = SRGBColorSpace;
      rt.texture.anisotropy = 4;
      return rt;
    };
    const atlas = { albedo: target(true), normal: target(false), cell };

    const scene = new Scene();
    const materials = [];
    const geometries = [];
    const material = (uniforms, options) => {
      const m = new ShaderMaterial({
        uniforms: { map: { value: this.#leafAtlas }, uVMode: { value: 0 }, uVColor: { value: new Color() }, uVCell: { value: new Vector4() }, uVBox: { value: new Vector4() }, uVTop: { value: 0 }, ...uniforms },
        defines: { PWV_MODELS: count },
        vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, blending: NoBlending, side: DoubleSide, ...options,
      });
      materials.push(m);
      return m;
    };
    const backdropGeometry = new PlaneGeometry(2, 2);
    geometries.push(backdropGeometry);
    this.#models.forEach((model, i) => {
      // A backdrop in the colour of the foliage with zero alpha, so the edges
      // of the leaves do not darken when the atlas is filtered.
      const backdrop = new Mesh(backdropGeometry, material(
        { uVCell: { value: new Vector4(i, 0, 1, 2) }, uVColor: { value: new Color().fromArray(model.color) } },
        { depthTest: false, depthWrite: false },
      ));
      backdrop.userData.backdrop = true;
      backdrop.renderOrder = -1;
      backdrop.frustumCulled = false;
      scene.add(backdrop);
      const geometry = createTreeGeometry(model.near);
      geometries.push(geometry);
      const box = new Vector4(model.radius * PAD, -0.4 - model.height * (PAD - 1), model.height * PAD, 0);
      for (const top of [0, 1]) {
        const mesh = new Mesh(geometry, material({ uVCell: { value: new Vector4(i, top, 1, 1) }, uVBox: { value: box }, uVTop: { value: top } }));
        mesh.frustumCulled = false;
        scene.add(mesh);
      }
    });

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const previous = {
      target: renderer.getRenderTarget(),
      color: renderer.getClearColor(_color).getHex(),
      alpha: renderer.getClearAlpha(),
      autoClear: renderer.autoClear,
      xr: renderer.xr.enabled,
      shadows: renderer.shadowMap.autoUpdate,
    };
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    for (const [mode, rt] of [[0, atlas.albedo], [1, atlas.normal]]) {
      for (const child of scene.children) {
        const u = child.material.uniforms;
        if (child.userData.backdrop) {
          u.uVMode.value = 2;
          if (mode === 1) u.uVColor.value.setRGB(0.5, 0.5, 1);
        } else {
          u.uVMode.value = mode;
        }
      }
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.color, previous.alpha);
    renderer.autoClear = previous.autoClear;
    renderer.xr.enabled = previous.xr;
    renderer.shadowMap.autoUpdate = previous.shadows;
    for (const m of materials) m.dispose();
    for (const g of geometries) g.dispose();

    this.#atlas = atlas;
    this.#atlasDirty = false;
    const u = this.#billboardMaterial.uniforms;
    u.uVAlbedo.value = atlas.albedo.texture;
    u.uVNormal.value = atlas.normal.texture;
  }

  // --- trees: nearby meshes ------------------------------------------------

  /** Hand-over distances in metres: [full mesh, lighter mesh]. */
  #lodDistances() {
    const q = this.qualitySettings;
    const s = this.params.lodScale;
    const l1 = Math.min(q.treeLod[1] * s, q.treeRange * 0.6);
    return [Math.min(q.treeLod[0] * s, l1 * 0.7), l1];
  }

  #disposeNear() {
    for (const n of this.#near) {
      n.mesh.removeFromParent();
      n.geometry.dispose();
    }
    this.#near.length = 0;
    this.#nearCounts = [0, 0];
  }

  /** One mesh per model and level of detail, with room for every tree that can be in range. */
  #createNear() {
    this.#disposeNear();
    const q = this.qualitySettings;
    const [l0, l1] = this.#lodDistances();
    this.#shared.uVLod.value.set(l0 * (1 - FADE_BAND), l0, l1 * (1 - FADE_BAND), l1);
    this.#shared.uVRange.value.set(q.treeRange * 0.85, q.treeRange);
    const capacity = (radius) => Math.ceil((Math.PI * (radius + NEAR_STEP + q.treeSpacing) ** 2) / q.treeSpacing ** 2) + 32;
    this.#models.forEach((model, i) => {
      for (const lod of [1, 2]) {
        const geometry = createTreeGeometry(lod === 2 ? model.near : model.mid, InstancedBufferGeometry);
        const cap = capacity(lod === 2 ? l0 : l1);
        const a = new Float32Array(cap * 4), b = new Float32Array(cap * 4);
        const attrA = new InstancedBufferAttribute(a, 4).setUsage(DynamicDrawUsage);
        const attrB = new InstancedBufferAttribute(b, 4).setUsage(DynamicDrawUsage);
        geometry.setAttribute('aVA', attrA);
        geometry.setAttribute('aVB', attrB);
        // Bushes give way under a vehicle (setGrassCutouts); trees do not.
        const verts = geometry.attributes.position.count;
        geometry.setAttribute('aVBush', new BufferAttribute(new Float32Array(verts).fill(model.species === 'bush' ? 1 : 0), 1));
        geometry.instanceCount = 0;
        const mesh = new Mesh(geometry, this.#treeMaterials[lod - 1]);
        mesh.name = `VegetationEngine.${model.species}${lod === 2 ? 'Full' : 'Light'}`;
        mesh.customDepthMaterial = this.#treeDepthMaterials[lod - 1];
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        mesh.castShadow = this.params.castShadow && q.treeShadows >= (lod === 2 ? 1 : 2);
        mesh.visible = false;
        // Before everything else, nearest level first, for the same reason the trees are sorted.
        mesh.renderOrder = lod === 2 ? -3 : -2;
        this.#treeGroup.add(mesh);
        this.#near.push({ model: i, lod, mesh, geometry, a, b, attrA, attrB, capacity: cap, count: 0 });
      }
    });
    this.#nearDirty = true;
  }

  /** Sort the trees around the camera into the meshes that draw them. */
  #rebuildNear() {
    const [l0, l1] = this.#lodDistances();
    const full = (l0 + NEAR_STEP) ** 2;
    const lightFrom = Math.max(0, l0 * (1 - FADE_BAND) - NEAR_STEP) ** 2;
    const lightTo = (l1 + NEAR_STEP) ** 2;
    const near = this.#near;
    // Nearest first, so that a tree in front hides the pixels of those behind
    // it before they are shaded. A counting sort into rings of distance does
    // that without allocating: the first pass counts, the second one writes.
    const RINGS = 16;
    const slots = (this.#rings ??= new Uint32Array(near.length * RINGS));
    slots.fill(0);
    const perRing = [RINGS / (l1 + NEAR_STEP), RINGS / (l0 + NEAR_STEP)];
    const pass = (write) => {
      for (const chunk of this.#chunks.values()) {
        if (!chunk.count || Math.hypot(chunk.x - _p.x, chunk.z - _p.z) > l1 + NEAR_STEP + HALF_DIAGONAL) continue;
        const d = chunk.data;
        for (let o = 0; o < d.length; o += RECORD) {
          const dx = d[o] - _p.x, dy = d[o + 1] - _p.y, dz = d[o + 2] - _p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > lightTo) continue;
          const dist = Math.sqrt(d2);
          for (let lod = 0; lod < 2; lod++) {
            if (lod === 0 ? d2 <= lightFrom : d2 >= full) continue;
            const e = d[o + 6] * 2 + lod;
            const slot = e * RINGS + Math.min(RINGS - 1, Math.floor(dist * perRing[lod]));
            if (!write) { slots[slot]++; continue; }
            const n = near[e];
            const i = slots[slot]++;
            if (i >= n.capacity) continue;
            const k = i * 4;
            n.a[k] = d[o]; n.a[k + 1] = d[o + 1]; n.a[k + 2] = d[o + 2]; n.a[k + 3] = d[o + 3];
            n.b[k] = d[o + 4]; n.b[k + 1] = d[o + 5]; n.b[k + 2] = d[o + 8]; n.b[k + 3] = d[o + 7];
          }
        }
      }
    };
    pass(false);
    near.forEach((n, e) => {
      // Turn the counts into the position where each ring starts.
      let total = 0;
      for (let r = 0; r < RINGS; r++) {
        const count = slots[e * RINGS + r];
        slots[e * RINGS + r] = total;
        total += count;
      }
      n.count = Math.min(total, n.capacity);
    });
    pass(true);
    this.#nearCounts = [0, 0];
    for (const n of near) {
      n.geometry.instanceCount = n.count;
      n.mesh.visible = n.count > 0;
      this.#nearCounts[n.lod - 1] += n.count;
      if (!n.count) continue;
      for (const attr of [n.attrA, n.attrB]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n.count * 4);
        attr.needsUpdate = true;
      }
    }
    _last.copy(_p);
    this.#nearDirty = false;
  }

  // --- trees: placement ----------------------------------------------------

  #clearChunks() {
    for (const chunk of this.#chunks.values()) this.#removeChunk(chunk);
    this.#chunks.clear();
    this.#treeCount = 0;
    this.#nearDirty = true;
  }

  #removeChunk(chunk) {
    this.#treeCount -= chunk.count;
    if (!chunk.mesh) return;
    chunk.mesh.removeFromParent();
    chunk.mesh.geometry.dispose();
  }

  /** Keep the forest around the camera: drop far chunks, build one new one per frame. */
  #updateTrees(env) {
    if (!this.params.trees) return;
    const q = this.qualitySettings;
    const range = q.treeRange;
    const [, l1] = this.#lodDistances();
    const meshOnly = l1 * (1 - FADE_BAND);
    const cx0 = Math.floor((_p.x - range) / CHUNK), cx1 = Math.floor((_p.x + range) / CHUNK);
    const cz0 = Math.floor((_p.z - range) / CHUNK), cz1 = Math.floor((_p.z + range) / CHUNK);
    const limit = range + CHUNK * 0.75;

    for (const [key, chunk] of this.#chunks) {
      const d = Math.hypot(chunk.x - _p.x, chunk.z - _p.z);
      if (d > limit + CHUNK) {
        this.#removeChunk(chunk);
        this.#chunks.delete(key);
      } else if (chunk.mesh) {
        // No billboards to draw while every tree of the chunk is close enough to be a mesh.
        const farthest = Math.hypot(d + HALF_DIAGONAL, Math.max(Math.abs(_p.y - chunk.y0), Math.abs(_p.y - chunk.y1)));
        chunk.mesh.visible = !!this.#atlas && farthest > meshOnly;
      }
    }

    let best = null, bestD = Infinity, pending = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const x = (cx + 0.5) * CHUNK, z = (cz + 0.5) * CHUNK;
        const d = Math.hypot(x - _p.x, z - _p.z);
        if (d > limit || this.#chunks.has(`${cx},${cz}`)) continue;
        pending++;
        if (d < bestD) { bestD = d; best = [cx, cz]; }
      }
    }
    this.#pending = pending;
    if (best) {
      this.#buildChunk(best[0], best[1], env);
      if (bestD < l1 + NEAR_STEP + HALF_DIAGONAL) this.#nearDirty = true;
    }
    if (this.#nearDirty || _last.distanceToSquared(_p) > NEAR_STEP * NEAR_STEP) this.#rebuildNear();
  }

  /** Decide what grows on every candidate position of one chunk. */
  #buildChunk(cx, cz, env) {
    const p = this.params;
    const q = this.qualitySettings;
    const spacing = q.treeSpacing;
    const seed = p.seed * 131 + 7;
    const records = [];
    let y0 = Infinity, y1 = -Infinity;
    // A smooth random field, 0..1, with features `size` metres across.
    const field = smoothField;
    const g0x = Math.ceil((cx * CHUNK) / spacing), g1x = Math.ceil(((cx + 1) * CHUNK) / spacing);
    const g0z = Math.ceil((cz * CHUNK) / spacing), g1z = Math.ceil(((cz + 1) * CHUNK) / spacing);
    for (let gz = g0z; gz < g1z; gz++) {
      for (let gx = g0x; gx < g1x; gx++) {
        const h1 = hash2(gx, gz, seed);
        const h2 = hash2(gx, gz, seed + 1);
        const x = (gx + unit(h1) - 0.5) * spacing;
        const z = (gz + ((h1 >>> 8) & 0xffff) / 65536 - 0.5) * spacing;
        const s = this.#sampler(x, z, _sample);
        if (this.#hasSampler && s.height < env.waterLevel + 2.5) continue;

        // Forest comes in patches: a coarse random field decides where.
        const patch = field(x, z, 140, seed + 9);
        const climate = s.vegetation * smoothstep(1, 6, s.temperature) * (1 - smoothstep(27, 33, s.temperature));
        let chance = climate
          * (0.1 + 0.9 * smoothstep(0.3, 0.65, s.moisture))
          * smoothstep(0.3, 0.6, patch) * p.treeDensity;
        const mix = ((h2 >>> 4) & 0xff) / 255;
        const size = ((h2 >>> 12) & 0xff) / 255;
        const height = s.height, temperature = s.temperature, moisture = s.moisture, pointSlope = s.slope;
        if (unit(h2) <= chance) {
          // Not on steep ground. The slope is taken across the tree's own
          // footprint: the slope at a single point follows every small
          // wrinkle of the terrain, and the forest came out in stripes.
          const hx = this.#sampler(x + SLOPE_SPAN, z, _sample2).height;
          const hz = this.#sampler(x, z + SLOPE_SPAN, _sample2).height;
          const gx = (hx - height) / SLOPE_SPAN, gz = (hz - height) / SLOPE_SPAN;
          chance *= 1 - smoothstep(0.07, 0.17, 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz));
        }
        let model, scale;
        if (unit(h2) <= chance) {
          // Which tree: cold ground grows spruce, mild ground oak, dry ground
          // pine, with birch in between. A second field groups the same kind
          // into stands instead of mixing them evenly.
          const t = temperature + (mix - 0.5) * 6;
          const pick = 0.55 * field(x, z, 90, seed + 21) + 0.45 * mix;
          const dry = moisture < 0.42;
          let species;
          if (size > 0.985) species = 'snag';
          else if (t < 7) species = pick < 0.62 ? 'spruce' : 'birch';
          else if (t < 13) species = dry ? (pick < 0.55 ? 'pine' : 'birch') : (pick < 0.42 ? 'spruce' : pick < 0.58 ? 'pine' : 'birch');
          else if (t < 22) species = dry ? (pick < 0.5 ? 'pine' : 'oak') : (pick < 0.56 ? 'oak' : pick < 0.66 ? 'pine' : 'birch');
          else species = pick < 0.6 ? 'oak' : 'pine';
          model = FIRST[species] + (species === 'snag' ? 0 : (h2 >>> 20) & 1);
          scale = p.treeScale * (0.65 + 0.8 * size) * (0.8 + 0.4 * moisture);
        } else {
          // No tree here: perhaps a bush. They like the edges of the forest.
          const edge = smoothstep(0.15, 0.32, patch) * (1 - smoothstep(0.5, 0.65, patch));
          const bush = climate * (1 - smoothstep(0.15, 0.3, pointSlope)) * (0.035 + 0.3 * edge) * p.bushDensity;
          if (unit(hash2(gx, gz, seed + 2)) > bush) continue;
          model = FIRST.bush;
          scale = p.treeScale * (0.55 + 0.7 * size);
        }
        const y = height - 0.1;
        records.push(x, y, z, unit(h1) * 40, scale, scale * (0.9 + 0.3 * mix), model, ((h2 >>> 8) & 0xffff) / 65536, this.#now);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + this.#models[model].height * scale * 1.2);
      }
    }

    const count = records.length / RECORD;
    const chunk = { x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, count, data: new Float32Array(records), mesh: null, y0, y1 };
    this.#chunks.set(`${cx},${cz}`, chunk);
    if (!count) return;
    this.#treeCount += count;

    // The chunk's billboards: one instanced mesh for all its trees.
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(CARD_POSITIONS), 3));
    geometry.setIndex(CARD_INDEX);
    const a = new Float32Array(count * 4), b = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const o = i * RECORD, k = i * 4;
      a[k] = records[o]; a[k + 1] = records[o + 1]; a[k + 2] = records[o + 2]; a[k + 3] = records[o + 6];
      b[k] = records[o + 4]; b[k + 1] = records[o + 5]; b[k + 2] = records[o + 8]; b[k + 3] = records[o + 7];
    }
    geometry.setAttribute('aVA', new InstancedBufferAttribute(a, 4));
    geometry.setAttribute('aVB', new InstancedBufferAttribute(b, 4));
    geometry.instanceCount = count;
    geometry.boundingSphere = new Sphere(
      new Vector3(chunk.x, (y0 + y1) / 2, chunk.z),
      Math.hypot(HALF_DIAGONAL + 20 * p.treeScale, (y1 - y0) / 2),
    );
    const mesh = new Mesh(geometry, this.#billboardMaterial);
    mesh.name = 'VegetationEngine.billboards';
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.renderOrder = -1;
    this.#treeGroup.add(mesh);
    chunk.mesh = mesh;
  }
}
