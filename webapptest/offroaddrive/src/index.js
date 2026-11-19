// Procedural World Engine: public entry point.
// Each engine can also be imported on its own, e.g. './terrain/TerrainEngine.js'.

export { Emitter } from './core/Emitter.js';
export { BaseEngine } from './core/BaseEngine.js';
export { World } from './core/World.js';
export { WorldEnvironment, Weather } from './core/WorldEnvironment.js';
export {
  QualityPreset,
  QUALITY_ORDER,
  RENDER_PRESETS,
  normalizeQuality,
  detectDevice,
  detectQuality,
  applyRendererQuality,
} from './core/Quality.js';
export { PerformanceMonitor } from './core/PerformanceMonitor.js';
export { hash2, noised, noiseH } from './core/noise.js';
export { NOISE_GLSL } from './core/shaders/noise.glsl.js';

export { TerrainEngine } from './terrain/TerrainEngine.js';
export { TerrainHeightField } from './terrain/TerrainHeightField.js';

export { AtmosphereEngine } from './atmosphere/AtmosphereEngine.js';
export { AtmosphereModel, generateCloudNoise } from './atmosphere/AtmosphereModel.js';

export { OceanEngine } from './ocean/OceanEngine.js';

export { UnderwaterEngine } from './underwater/UnderwaterEngine.js';

export { VegetationEngine } from './vegetation/VegetationEngine.js';
export { TREE_SPECIES, createTree, createTreeMaterial, buildTreeModel, createTreeGeometry } from './vegetation/treeGeometry.js';
export { createLeafAtlas, leafCellUV, LEAF_CELLS } from './vegetation/leafAtlas.js';
export { VolumetricEngine, createFogNoise } from './volumetric/VolumetricEngine.js';
export { PostProcessEngine } from './postprocess/PostProcessEngine.js';
export { AudioEngine } from './audio/AudioEngine.js';

export { buildEngineGUI, buildEnvironmentGUI } from './tools/gui.js';

export const VERSION = '0.9.0';
