import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  Vector3,
} from 'three';
import { BaseEngine } from '../core/BaseEngine.js';
import { NOISE_GLSL } from '../core/shaders/noise.glsl.js';
import { TerrainHeightField } from './TerrainHeightField.js';
import {
  HEIGHT_GLSL,
  BIOME_GLSL,
  VERTEX_PARS_GLSL,
  VERTEX_NORMAL_GLSL,
  VERTEX_BEGIN_GLSL,
  VERTEX_BEGIN_DEPTH_GLSL,
  FRAGMENT_PARS_GLSL,
  FRAGMENT_COLOR_GLSL,
  FRAGMENT_ROUGHNESS_GLSL,
  FRAGMENT_NORMAL_GLSL,
} from './shaders/terrain.glsl.js';

const MAX_LEVELS = 12;
const DEBUG_VIEWS = ['none', 'lod', 'normals', 'slope', 'biome', 'climate'];
const HEIGHT_KEYS = [
  'seed', 'featureScale', 'heightScale', 'baseHeight', 'octaves',
  'lacunarity', 'gain', 'erosion', 'ridge', 'ridgeDetail', 'warp', 'continent',
];
const COLOR_UNIFORMS = {
  sandColor: 'uTColSand',
  grassColor: 'uTColGrass',
  dryGrassColor: 'uTColDryGrass',
  rockColor: 'uTColRock',
  snowColor: 'uTColSnow',
};

const _frustum = new Frustum();
const _matrix = new Matrix4();
const _cam = new Vector3();
const _v = new Vector3();
const _sample = new Float64Array(3);

/**
 * Infinite procedural terrain.
 *
 * Geometry: CDLOD. One flat grid patch is drawn instanced, once per selected
 * quadtree node; the vertex shader morphs between LOD levels and evaluates the
 * height function. The CPU only selects nodes (a few hundred box tests per
 * frame) and never touches vertices.
 *
 * Shading: a patched MeshStandardMaterial, so three's lights, shadows, fog and
 * tone mapping apply as usual.
 */
export class TerrainEngine extends BaseEngine {
  static engineName = 'TerrainEngine';

  static parameterSchema = {
    // --- shape ---
    seed: { type: 'int', default: 1337, min: 0, max: 99999, step: 1, group: 'Shape' },
    featureScale: { type: 'number', default: 3200, min: 300, max: 10000, step: 10, group: 'Shape', label: 'feature scale (m)' },
    heightScale: { type: 'number', default: 1300, min: 0, max: 4000, step: 5, group: 'Shape', label: 'height scale (m)' },
    baseHeight: { type: 'number', default: 80, min: -500, max: 500, step: 1, group: 'Shape', label: 'base height (m)' },
    octaves: { type: 'int', default: 11, min: 1, max: 13, step: 1, group: 'Shape' },
    lacunarity: { type: 'number', default: 2.0, min: 1.7, max: 2.4, step: 0.01, group: 'Shape' },
    gain: { type: 'number', default: 0.5, min: 0.3, max: 0.62, step: 0.005, group: 'Shape' },
    ridge: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, group: 'Shape' },
    ridgeDetail: { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, group: 'Shape', label: 'ridge detail' },
    erosion: { type: 'number', default: 0.5, min: 0, max: 4, step: 0.05, group: 'Shape' },
    warp: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, group: 'Shape' },
    continent: { type: 'number', default: 0.7, min: 0, max: 2, step: 0.01, group: 'Shape' },
    // --- biomes ---
    rockSlope: { type: 'number', default: 36, min: 10, max: 80, step: 1, group: 'Biome', label: 'rock slope (deg)' },
    snowTemperature: { type: 'number', default: 0, min: -15, max: 15, step: 0.5, group: 'Biome', label: 'snow below (°C)' },
    lapseRate: { type: 'number', default: 6.5, min: 0, max: 30, step: 0.1, group: 'Biome', label: 'lapse rate (°C/km)' },
    beachHeight: { type: 'number', default: 3, min: 0.2, max: 20, step: 0.1, group: 'Biome', label: 'beach height (m)' },
    sandColor: { type: 'color', default: '#c9b790', group: 'Biome' },
    grassColor: { type: 'color', default: '#4d6b2a', group: 'Biome' },
    dryGrassColor: { type: 'color', default: '#8f8650', group: 'Biome' },
    rockColor: { type: 'color', default: '#7d7770', group: 'Biome' },
    snowColor: { type: 'color', default: '#eef1f6', group: 'Biome' },
    // --- rendering ---
    castShadow: { type: 'boolean', default: true, group: 'Render' },
    receiveShadow: { type: 'boolean', default: true, group: 'Render' },
    frustumCulling: { type: 'boolean', default: true, group: 'Render' },
    wireframe: { type: 'boolean', default: false, group: 'Render' },
    debugView: { type: 'select', default: 'none', options: DEBUG_VIEWS, group: 'Render' },
  };

  /**
   * patchResolution  quads per patch side (even)
   * leafSize         metres covered by a finest-level patch
   * lodLevels        number of LOD levels; view distance = leafSize * 2^(lodLevels-1) * lodFactor
   * lodFactor        LOD range in node sizes; must be >= 3 or neighbours can differ by two levels
   * fragmentNormals  evaluate the height function per pixel for the shading normal
   * detailOctaves    extra shading-only octaves (with fragmentNormals)
   * detailBump       cheap micro bump from two noise taps
   */
  static qualityPresets = {
    ultra: { patchResolution: 64, leafSize: 32, lodLevels: 10, lodFactor: 4.0, fragmentNormals: true, detailOctaves: 3, detailBump: true },
    high: { patchResolution: 48, leafSize: 32, lodLevels: 10, lodFactor: 3.5, fragmentNormals: true, detailOctaves: 2, detailBump: true },
    medium: { patchResolution: 32, leafSize: 32, lodLevels: 9, lodFactor: 3.0, fragmentNormals: false, detailOctaves: 0, detailBump: true },
    low: { patchResolution: 16, leafSize: 32, lodLevels: 8, lodFactor: 3.0, fragmentNormals: false, detailOctaves: 0, detailBump: false },
  };

  /** CPU copy of the height function. Safe to read directly. */
  heightField = new TerrainHeightField();

  #uniforms;
  #cover = null;
  #coverVersion = 0;
  #material;
  #depthMaterial;
  #geometry = null;
  #mesh;
  #ranges = new Float32Array(MAX_LEVELS);
  #levels = 0;
  #leafSize = 32;
  #patchRes = 32;
  #minH = 0;
  #maxH = 0;
  #nodes = new Float32Array(0);
  #nodeCount = 0;
  #capacity = 0;
  #overflow = false;
  #envVersion = -1;
  #cull = null;
  #camX = 0;
  #camY = 0;
  #camZ = 0;

  constructor(options = {}) {
    super(options);

    this.#uniforms = {
      uTSeed: { value: 0 },
      uTFeatureScale: { value: 1 },
      uTHeightScale: { value: 1 },
      uTBaseHeight: { value: 0 },
      uTLacunarity: { value: 2 },
      uTGain: { value: 0.5 },
      uTErosion: { value: 0 },
      uTRidge: { value: 0 },
      uTRidgeDetail: { value: 0.7 },
      uTWarp: { value: 0 },
      uTContinent: { value: 0 },
      uTOctaves: { value: 8 },
      uTDetailOctaves: { value: 0 },
      uTCamPos: { value: new Vector3() },
      uTHeightRange: { value: new Float32Array(2) },
      uTRanges: { value: this.#ranges },
      uTPatchRes: { value: 32 },
      uTLeafSpacing: { value: 1 },
      uTMorphStart: { value: 0.55 },
      uTWaterLevel: { value: 0 },
      uTTemperature: { value: 18 },
      uTHumidity: { value: 55 },
      uTLapseRate: { value: 6.5 },
      uTRockSlope: { value: 0.2 },
      uTSnowTemperature: { value: 0 },
      uTBeachHeight: { value: 3 },
      uTSnowfall: { value: 0 },
      uTWetness: { value: 0 },
      uTDebug: { value: 0 },
      uTColSand: { value: new Color() },
      uTColGrass: { value: new Color() },
      uTColDryGrass: { value: new Color() },
      uTColRock: { value: new Color() },
      uTColSnow: { value: new Color() },
    };

    this.#material = this.#createMaterial();
    this.#depthMaterial = this.#createDepthMaterial();

    this.#mesh = new Mesh(undefined, this.#material);
    this.#mesh.name = 'TerrainEngine.mesh';
    this.#mesh.frustumCulled = false; // nodes are culled individually in #select
    this.#mesh.customDepthMaterial = this.#depthMaterial;
    this.#mesh.matrixAutoUpdate = false;
    this.object3d.add(this.#mesh);

    this._applyParameters(this.params);
    this._applyQuality(this.qualitySettings);
    this.#syncEnvironment(true);
  }

  // --- public queries -----------------------------------------------------

  /** Distance at which the terrain ends (metres). Set camera.far at least this large. */
  get viewDistance() {
    return this.#ranges[this.#levels - 1];
  }

  /** Conservative [min, max] world height for the current parameters. */
  get heightRange() {
    return [this.#minH, this.#maxH];
  }

  /** The Mesh that draws the terrain (for layers, renderOrder, etc.). */
  get mesh() {
    return this.#mesh;
  }

  /** Terrain height at (x, z), full detail. Matches the GPU surface. */
  getHeightAt(x, z) {
    return this.heightField.heightAt(x, z);
  }

  /**
   * Height of the mesh that is actually drawn at (x, z) for the camera used in
   * the last update(): far away the mesh carries fewer octaves than
   * getHeightAt(). Use it for things that must sit exactly on the visible
   * surface. Triangle interpolation between vertices is not included.
   */
  getRenderedHeightAt(x, z) {
    const dx = x - this.#camX;
    const dz = z - this.#camZ;
    const dy = Math.max(0, this.#minH - this.#camY, this.#camY - this.#maxH);
    const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
    return this.heightField.heightAt(x, z, this.#geometryOctaves(dist));
  }

  /** Unit surface normal at (x, z). */
  getNormalAt(x, z, target = new Vector3()) {
    const s = this.heightField.sample(x, z, _sample);
    return target.set(-s[1], 1, -s[2]).normalize();
  }

  /** Slope in degrees at (x, z): 0 is flat, 90 is vertical. */
  getSlopeAt(x, z) {
    const s = this.heightField.sample(x, z, _sample);
    return (Math.atan(Math.hypot(s[1], s[2])) * 180) / Math.PI;
  }

  /** Biome weights and climate at (x, z). See TerrainHeightField.biomeAt. */
  getBiomeAt(x, z, target = {}) {
    return this.heightField.biomeAt(x, z, target);
  }

  /**
   * The height function as GLSL, for other shaders that need the terrain
   * height per pixel (the ocean uses it for water depth). The returned
   * uniforms are the live ones, so parameter changes carry over.
   * @returns {{ glsl: string, uniforms: object }} `glsl` defines
   *   `float <functionName>(vec2 xz)` returning the world height in metres
   */
  getHeightShader({ functionName = 'pweTerrainHeight', octaves = 7 } = {}) {
    const u = this.#uniforms;
    const uniforms = {};
    for (const name of [
      'uTSeed', 'uTFeatureScale', 'uTHeightScale', 'uTBaseHeight', 'uTLacunarity', 'uTGain',
      'uTErosion', 'uTRidge', 'uTRidgeDetail', 'uTWarp', 'uTContinent',
    ]) uniforms[name] = u[name];
    const glsl = `${NOISE_GLSL}\n#ifndef PWE_TERRAIN_HEIGHT\n#define PWE_TERRAIN_HEIGHT\n${HEIGHT_GLSL}\n#endif\n` +
      `float ${functionName}(vec2 xz) { return terrainHeight(xz, ${Number(octaves).toFixed(1)}).x; }\n`;
    return { glsl, uniforms };
  }

  /**
   * Height and biome as GLSL for shaders that place things on the ground
   * (VegetationEngine's grass). `glsl` defines
   *   vec3 <prefix>GroundHeight(vec2 xz)            height, dHeight/dx, dHeight/dz
   *   vec2 <prefix>GroundInfo(vec3 pos, vec3 normal) x: how much vegetation grows here (0..1)
   *                                                  y: dryness (0 lush .. 1 dry)
   * @returns {{ glsl: string, uniforms: object }}
   */
  getGroundShader({ prefix = 'pwv', octaves = 8 } = {}) {
    const glsl = `${NOISE_GLSL}
#ifndef PWE_TERRAIN_HEIGHT
#define PWE_TERRAIN_HEIGHT
${HEIGHT_GLSL}
#endif
#ifndef PWE_TERRAIN_BIOME
#define PWE_TERRAIN_BIOME
${BIOME_GLSL}
#endif
vec3 ${prefix}GroundHeight(vec2 xz) { return terrainHeight(xz, ${Number(octaves).toFixed(1)}); }
vec2 ${prefix}GroundInfo(vec3 pos, vec3 normal) {
  TerrainBiome bi = terrainBiome(pos, normal, 0.0);
  float arid = (1.0 - smoothstep(0.18, 0.42, bi.moisture)) * smoothstep(16.0, 26.0, bi.temperature);
  float cold = 1.0 - smoothstep(0.0, 7.0, bi.temperature - uTSnowTemperature);
  float dry = clamp(1.0 - smoothstep(0.25, 0.7, bi.moisture) + 0.6 * cold, 0.0, 1.0);
  return vec2(bi.vegetation * (1.0 - arid) * (1.0 - 0.7 * cold), dry);
}
`;
    return { glsl, uniforms: this.#uniforms };
  }

  /**
   * Tell the terrain what grows on it, so that ground too far away to have
   * its grass and trees drawn still has their colour (and ground close by
   * has the colour of what stands on it). With VegetationEngine:
   * `terrain.setCover(vegetation.getCoverShader())`. Pass null to remove it.
   *
   * @param {{ glsl: string, uniforms: object }|null} cover `glsl` defines
   *   `vec3 pweCover(vec3 albedo, vec3 worldPos, vec4 ground, vec2 climate)`
   *   and returns the new colour of vegetated ground. `ground` is (how well
   *   plants grow 0..1, dryness 0..1, slope = 1 - normal.y, share of the
   *   pixel that is vegetated), `climate` is (temperature in deg C, moisture
   *   0..1). It may use pwHash and the other functions of NOISE_GLSL.
   */
  setCover(cover) {
    this.#cover = cover ?? null;
    this.#coverVersion++;
    const defines = { ...this.#material.defines };
    if (this.#cover) defines.PWE_COVER = 1;
    else delete defines.PWE_COVER;
    this.#material.defines = defines;
    this.#material.needsUpdate = true;
    return this;
  }

  /**
   * Intersect a ray with the terrain.
   * @returns {Vector3|null} hit point, or null if nothing within maxDistance
   */
  raycast(origin, direction, maxDistance = this.viewDistance, target = new Vector3()) {
    const hf = this.heightField;
    const dir = _v.copy(direction).normalize();
    const dx = dir.x, dy = dir.y, dz = dir.z;
    let t = 0;
    let prevT = 0;
    let above = origin.y - hf.heightAt(origin.x, origin.z);
    if (above < 0) return null; // starts underground
    // Step proportional to the clearance, then refine by bisection.
    for (let i = 0; i < 512 && t < maxDistance; i++) {
      prevT = t;
      t += Math.max(0.5, above * 0.4);
      const y = origin.y + dy * t;
      if (dy > 0 && y > this.#maxH) return null;
      above = y - hf.heightAt(origin.x + dx * t, origin.z + dz * t);
      if (above < 0) {
        let lo = prevT;
        let hi = t;
        for (let j = 0; j < 24; j++) {
          const mid = 0.5 * (lo + hi);
          if (origin.y + dy * mid - hf.heightAt(origin.x + dx * mid, origin.z + dz * mid) < 0) hi = mid;
          else lo = mid;
        }
        return target.set(origin.x + dx * hi, origin.y + dy * hi, origin.z + dz * hi);
      }
    }
    return null;
  }

  // --- frame --------------------------------------------------------------

  update(_deltaTime, camera) {
    if (this.disposed) return;
    this.#syncEnvironment(false);

    camera.updateMatrixWorld();
    _cam.setFromMatrixPosition(camera.matrixWorld);
    this.#camX = _cam.x;
    this.#camY = _cam.y;
    this.#camZ = _cam.z;
    this.#uniforms.uTCamPos.value.copy(_cam);

    if (this.params.frustumCulling) {
      _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_matrix);
      this.#cull = _frustum.planes;
    } else {
      this.#cull = null;
    }
    this.#select();
  }

  getStats() {
    const tris = this.#nodeCount * this.#patchRes * this.#patchRes * 2;
    const stats = {
      nodes: this.#nodeCount,
      triangles: tris,
      'view km': this.viewDistance / 1000,
      'vtx m': this.#leafSize / this.#patchRes,
    };
    if (this.#overflow) stats.overflow = 'yes';
    return stats;
  }

  // --- BaseEngine hooks ---------------------------------------------------

  _applyQuality(q) {
    this.#patchRes = q.patchResolution;
    this.#leafSize = q.leafSize;
    this.#levels = Math.min(MAX_LEVELS, q.lodLevels);
    this.#ranges.fill(0);
    for (let l = 0; l < MAX_LEVELS; l++) {
      // Levels past the last one keep growing so the shader never divides by zero.
      this.#ranges[l] = q.leafSize * 2 ** l * Math.max(3, q.lodFactor);
    }

    const u = this.#uniforms;
    u.uTPatchRes.value = q.patchResolution;
    u.uTLeafSpacing.value = q.leafSize / q.patchResolution;
    u.uTDetailOctaves.value = q.fragmentNormals ? q.detailOctaves : 0;

    const defines = { PWE_MAX_LEVELS: MAX_LEVELS };
    if (q.fragmentNormals) defines.PWE_FRAGMENT_NORMALS = 1;
    if (q.detailBump) defines.PWE_DETAIL_BUMP = 1;
    if (this.#cover) defines.PWE_COVER = 1;
    this.#material.defines = defines;
    this.#material.needsUpdate = true;

    this.#buildGeometry(q.patchResolution);
  }

  _applyParameters(changed) {
    const p = this.params;
    const u = this.#uniforms;
    const hf = this.heightField;

    if (HEIGHT_KEYS.some((k) => k in changed)) {
      for (const k of HEIGHT_KEYS) hf[k] = p[k];
      u.uTSeed.value = p.seed;
      u.uTFeatureScale.value = p.featureScale;
      u.uTHeightScale.value = p.heightScale;
      u.uTBaseHeight.value = p.baseHeight;
      u.uTOctaves.value = p.octaves;
      u.uTLacunarity.value = p.lacunarity;
      u.uTGain.value = p.gain;
      u.uTErosion.value = p.erosion;
      u.uTRidge.value = p.ridge;
      u.uTRidgeDetail.value = p.ridgeDetail;
      u.uTWarp.value = p.warp;
      u.uTContinent.value = p.continent;
      [this.#minH, this.#maxH] = hf.heightBounds();
      u.uTHeightRange.value[0] = this.#minH;
      u.uTHeightRange.value[1] = this.#maxH;
    }

    hf.rockSlope = u.uTRockSlope.value = 1 - Math.cos((p.rockSlope * Math.PI) / 180);
    hf.snowTemperature = u.uTSnowTemperature.value = p.snowTemperature;
    hf.lapseRate = u.uTLapseRate.value = p.lapseRate;
    hf.beachHeight = u.uTBeachHeight.value = p.beachHeight;
    for (const key in COLOR_UNIFORMS) {
      if (key in changed) u[COLOR_UNIFORMS[key]].value.set(p[key]);
    }

    u.uTDebug.value = DEBUG_VIEWS.indexOf(p.debugView);
    if (this.#material) {
      this.#material.wireframe = p.wireframe;
      this.#mesh.castShadow = p.castShadow;
      this.#mesh.receiveShadow = p.receiveShadow;
    }
  }

  _dispose() {
    this.#geometry?.dispose();
    this.#material.dispose();
    this.#depthMaterial.dispose();
    this.#geometry = null;
  }

  // --- internals ----------------------------------------------------------

  /** Copy the shared environment into uniforms when it changed. */
  #syncEnvironment(force) {
    const env = this.environment;
    if (!env) return;
    if (!force && env.version === this.#envVersion) return;
    this.#envVersion = env.version;
    const u = this.#uniforms;
    const hf = this.heightField;
    hf.waterLevel = u.uTWaterLevel.value = env.waterLevel;
    hf.temperature = u.uTTemperature.value = env.temperature;
    hf.humidity = u.uTHumidity.value = env.humidity;
    hf.snowfall = u.uTSnowfall.value = env.snowfall;
    u.uTWetness.value = env.wetness;
  }

  /** Same formula as pweGeomOctaves() in the vertex shader. */
  #geometryOctaves(dist) {
    const p = this.params;
    const spacing = (this.#leafSize / this.#patchRes) * Math.max(1, (2 * dist) / this.#ranges[0]);
    const o = Math.log2(p.featureScale / (2.5 * spacing)) / Math.log2(p.lacunarity) + 1;
    return Math.min(p.octaves, Math.max(1, o));
  }

  #buildGeometry(n) {
    this.#geometry?.dispose();
    const side = n + 1;
    const positions = new Float32Array(side * side * 3);
    let k = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        positions[k++] = i;
        positions[k++] = 0;
        positions[k++] = j;
      }
    }
    const indices = new Uint16Array(n * n * 6);
    k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * side + i;
        const b = a + side;
        const c = a + 1;
        const d = b + 1;
        indices[k++] = a; indices[k++] = b; indices[k++] = c;
        indices[k++] = b; indices[k++] = d; indices[k++] = c;
      }
    }
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.instanceCount = 0;
    this.#geometry = geometry;
    this.#capacity = 0;
    this.#ensureCapacity(512);
    this.#mesh.geometry = geometry;
  }

  #ensureCapacity(count) {
    if (count <= this.#capacity) return;
    const capacity = Math.max(count, this.#capacity * 2);
    const data = new Float32Array(capacity * 4);
    data.set(this.#nodes.subarray(0, Math.min(this.#nodes.length, this.#nodeCount * 4)));
    this.#nodes = data;
    this.#capacity = capacity;
    const attr = new InstancedBufferAttribute(data, 4);
    attr.setUsage(DynamicDrawUsage);
    // Replacing an attribute needs a fresh geometry binding; dispose drops the old VAO.
    if (this.#geometry.getAttribute('aNode')) this.#geometry.dispose();
    this.#geometry.setAttribute('aNode', attr);
  }

  /** Quadtree selection for the current camera. */
  #select() {
    const size = this.#leafSize * 2 ** (this.#levels - 1);
    const reach = this.#ranges[this.#levels - 1];
    const x0 = Math.floor((this.#camX - reach) / size);
    const x1 = Math.floor((this.#camX + reach) / size);
    const z0 = Math.floor((this.#camZ - reach) / size);
    const z1 = Math.floor((this.#camZ + reach) / size);

    this.#nodeCount = 0;
    this.#overflow = false;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        this.#selectNode(ix * size, iz * size, size, this.#levels - 1);
      }
    }

    const attr = this.#geometry.getAttribute('aNode');
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, this.#nodeCount * 4);
    attr.needsUpdate = true;
    this.#geometry.instanceCount = this.#nodeCount;
  }

  /** Squared distance from the camera to the node's box (full height range). */
  #boxDistSq(x, z, size) {
    const dx = Math.max(0, x - this.#camX, this.#camX - (x + size));
    const dz = Math.max(0, z - this.#camZ, this.#camZ - (z + size));
    const dy = Math.max(0, this.#minH - this.#camY, this.#camY - this.#maxH);
    return dx * dx + dy * dy + dz * dz;
  }

  #visible(x, z, size) {
    const planes = this.#cull;
    if (!planes) return true;
    const minY = this.#minH;
    const maxY = this.#maxH;
    for (let i = 0; i < 6; i++) {
      const pl = planes[i];
      const n = pl.normal;
      // Farthest box corner along the plane normal.
      const px = n.x > 0 ? x + size : x;
      const py = n.y > 0 ? maxY : minY;
      const pz = n.z > 0 ? z + size : z;
      if (n.x * px + n.y * py + n.z * pz + pl.constant < 0) return false;
    }
    return true;
  }

  /** @returns {boolean} true if this node's area is handled (drawn, culled or subdivided) */
  #selectNode(x, z, size, level) {
    const r = this.#ranges[level];
    const d2 = this.#boxDistSq(x, z, size);
    if (d2 > r * r) return false;
    if (!this.#visible(x, z, size)) return true;

    if (level === 0) {
      this.#push(x, z, size, 0);
      return true;
    }
    const rc = this.#ranges[level - 1];
    if (d2 > rc * rc) {
      this.#push(x, z, size, level);
      return true;
    }
    // Children outside the finer range are drawn at their own grid density and
    // morph completely into this level's shape, which keeps borders watertight.
    const half = size * 0.5;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const cx = x + i * half;
        const cz = z + j * half;
        if (!this.#selectNode(cx, cz, half, level - 1) && this.#visible(cx, cz, half)) {
          this.#push(cx, cz, half, level - 1);
        }
      }
    }
    return true;
  }

  #push(x, z, size, level) {
    if (this.#nodeCount >= 4096) {
      this.#overflow = true;
      return;
    }
    this.#ensureCapacity(this.#nodeCount + 1);
    const o = this.#nodeCount * 4;
    const data = this.#nodes;
    data[o] = x;
    data[o + 1] = z;
    data[o + 2] = size;
    data[o + 3] = level;
    this.#nodeCount++;
  }

  #patchVertex(shader, begin) {
    Object.assign(shader.uniforms, this.#uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${HEIGHT_GLSL}\n${VERTEX_PARS_GLSL}`)
      .replace('#include <begin_vertex>', begin);
  }

  #createMaterial() {
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    material.name = 'TerrainEngine.material';
    material.onBeforeCompile = (shader) => {
      this.#patchVertex(shader, VERTEX_BEGIN_GLSL);
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', VERTEX_NORMAL_GLSL);
      if (this.#cover) Object.assign(shader.uniforms, this.#cover.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${HEIGHT_GLSL}\n${BIOME_GLSL}\n${FRAGMENT_PARS_GLSL}\n${this.#cover?.glsl ?? ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR_GLSL}`)
        .replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS_GLSL)
        .replace('#include <normal_fragment_begin>', FRAGMENT_NORMAL_GLSL);
    };
    material.customProgramCacheKey = () =>
      `pwe-terrain:${Object.keys(material.defines ?? {}).join(',')}:${this.#coverVersion}`;
    return material;
  }

  #createDepthMaterial() {
    const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    material.name = 'TerrainEngine.depth';
    material.defines = { PWE_MAX_LEVELS: MAX_LEVELS };
    material.onBeforeCompile = (shader) => this.#patchVertex(shader, VERTEX_BEGIN_DEPTH_GLSL);
    material.customProgramCacheKey = () => 'pwe-terrain-depth';
    return material;
  }
}
