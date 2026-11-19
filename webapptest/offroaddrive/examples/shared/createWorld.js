// Puts every engine together the way they are meant to be used together.
// The showcase and the lightweight demo are both this function with
// different options; it is also the shortest complete example of the wiring.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import {
  World,
  WorldEnvironment,
  TerrainEngine,
  AtmosphereEngine,
  OceanEngine,
  UnderwaterEngine,
  VegetationEngine,
  VolumetricEngine,
  PostProcessEngine,
  AudioEngine,
  PerformanceMonitor,
  QUALITY_ORDER,
  detectQuality,
  applyRendererQuality,
} from '../../src/index.js';
import { FlyControls } from './FlyControls.js';

/**
 * @param {object} [options]
 * @param {string} [options.quality]        'ultra' | 'high' | 'medium' | 'low'; default: picked for the device
 * @param {number} [options.pixelRatioMax]  cap on the pixel ratio, below what the preset allows
 * @param {object} [options.environment]    WorldEnvironment values (timeOfDay, weather, windSpeed, ...)
 * @param {object} [options.start]          { x, z, y, yaw, pitch }; y defaults to eye height above the ground
 * @param {object} [options.params]         parameters per engine: { terrain, atmosphere, ocean, underwater,
 *                                          vegetation, volumetric, post, audio }
 * @param {boolean} [options.volumetric]    false leaves the fog engine out
 * @param {boolean} [options.post]          false renders straight to the screen
 * @param {boolean} [options.audio]         false leaves the sound out
 * @param {boolean} [options.hud]           show the performance overlay
 * @param {function} [options.onFrame]      called every frame with (deltaTime, world handles)
 * @returns the renderer, scene, camera, every engine, and setQuality(preset)
 */
export async function createWorld(options = {}) {
  const params = options.params ?? {};
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    // A view of tens of kilometres needs more depth precision than a normal
    // depth buffer has; without this the waterline flickers in the distance.
    logarithmicDepthBuffer: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.42;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  let quality = options.quality ?? detectQuality(renderer);
  if (!QUALITY_ORDER.includes(quality)) quality = 'high';
  const applyRenderer = (q) => {
    applyRendererQuality(renderer, q);
    if (options.pixelRatioMax) renderer.setPixelRatio(Math.min(renderer.getPixelRatio(), options.pixelRatioMax));
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  applyRenderer(quality);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 100000);
  const rig = new THREE.Group(); // moves through the world; holds the camera (and the XR origin)
  rig.add(camera);
  scene.add(rig);

  const environment = new WorldEnvironment(options.environment ?? {});
  const world = new World({ renderer, scene, camera, environment, quality });

  // Order of creation is the order of update(). Order of applyTo() on a
  // shared material is atmosphere, then fog, then water.
  const terrain = await world.add(new TerrainEngine({ params: params.terrain }));
  const atmosphere = await world.add(new AtmosphereEngine({ params: params.atmosphere }));
  const ocean = await world.add(new OceanEngine({
    seabed: terrain.getHeightShader({ functionName: 'pwoSeabedHeight', octaves: 8 }),
    params: params.ocean,
  }));
  let underwater = null;
  const volumetric = options.volumetric === false ? null : await world.add(new VolumetricEngine({
    light: atmosphere.sunLight,
    submerged: () => underwater?.submerged ?? false,
    params: params.volumetric,
  }));
  underwater = await world.add(new UnderwaterEngine({
    waterHeight: (x, z) => ocean.getHeightAt(x, z),
    params: params.underwater,
  }));
  const vegetation = await world.add(new VegetationEngine({
    ground: terrain.getGroundShader(),
    sample: (x, z, out) => terrain.getBiomeAt(x, z, out),
    params: params.vegetation,
  }));
  terrain.setCover(vegetation.getCoverShader());

  const inWorld = (material, surface = false) => {
    atmosphere.applyTo(material);
    volumetric?.applyTo(material);
    underwater.applyTo(material, { surface });
  };
  inWorld(terrain.mesh.material);
  inWorld(ocean.material, true);
  for (const material of vegetation.materials) inWorld(material);

  const post = options.post === false ? null : await world.add(new PostProcessEngine({
    waterDepth: () => underwater.depth,
    params: { waterColor: underwater.params.waterColor, ...params.post },
  }));

  let audio = null;
  if (options.audio !== false) {
    audio = await world.add(new AudioEngine({
      waterHeight: (x, z) => ocean.getHeightAt(x, z),
      groundHeight: (x, z) => terrain.getHeightAt(x, z),
      params: params.audio,
    }));
    // Browsers only start audio after a click, key or touch.
    const startAudio = () => audio.start().catch((e) => console.warn(e.message));
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, startAudio, { once: true });
  }

  // --- camera -------------------------------------------------------------
  const start = options.start ?? {};
  // options.controls === false: the app moves rig and camera itself (offroad-drive).
  const controls = options.controls === false ? { yaw: 0, pitch: 0, update() {} } : new FlyControls(rig, camera, renderer);
  controls.yaw = start.yaw ?? 0.6;
  controls.pitch = start.pitch ?? -0.12;
  const x0 = start.x ?? -5300, z0 = start.z ?? 7800;
  const ground0 = Math.max(terrain.getHeightAt(x0, z0), environment.waterLevel);
  rig.position.set(x0, start.y ?? ground0 + 2.2, z0);

  const perf = new PerformanceMonitor(renderer);
  perf.setVisible(options.hud !== false);
  if (post) perf.addSource('post', () => post.getStats());

  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (ok) document.body.appendChild(VRButton.createButton(renderer));
    }).catch(() => {});
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const handles = {
    THREE, renderer, scene, camera, rig, world, environment, controls, perf,
    terrain, atmosphere, ocean, underwater, vegetation, volumetric, post, audio,
    get quality() { return world.quality; },
    setQuality(q) {
      world.setQuality(q);
      applyRenderer(q);
    },
  };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    perf.begin();
    controls.update(dt);
    options.onFrame?.(dt, handles);

    // Keep the camera out of the ground (a CPU height query against the GPU terrain).
    const p = rig.position;
    const presenting = renderer.xr.isPresenting;
    p.y = Math.max(p.y, terrain.getHeightAt(p.x, p.z) + (presenting ? 0 : 1.2));
    camera.far = terrain.viewDistance * 1.05;
    camera.updateProjectionMatrix();

    world.update(dt);
    if (post) post.render(scene, camera);
    else renderer.render(scene, camera);
    perf.end();
  });

  return handles;
}
