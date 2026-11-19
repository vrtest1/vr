import { WorldEnvironment } from './WorldEnvironment.js';
import { normalizeQuality } from './Quality.js';

/**
 * Optional orchestrator: owns one WorldEnvironment and a list of engines and
 * drives them in order. Engines also work on their own without it.
 *
 *   const world = new World({ renderer, scene, camera });
 *   const terrain = await world.add(new TerrainEngine());
 *   renderer.setAnimationLoop(() => { world.update(clock.getDelta()); renderer.render(scene, camera); });
 */
export class World {
  engines = [];

  constructor({ renderer, scene, camera, environment, quality = 'high' } = {}) {
    if (!renderer || !scene || !camera) throw new Error('World: renderer, scene and camera are required');
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.environment = environment ?? new WorldEnvironment();
    this.quality = normalizeQuality(quality);
  }

  /**
   * Register an engine: shares the environment and quality, runs its async
   * init and adds it to the scene. Resolves to the engine.
   */
  async add(engine) {
    if (!engine.environment) engine.environment = this.environment;
    engine.setQuality(this.quality);
    await engine.init(this.renderer);
    engine.addTo(this.scene);
    this.engines.push(engine);
    return engine;
  }

  remove(engine, { dispose = true } = {}) {
    const i = this.engines.indexOf(engine);
    if (i < 0) return;
    this.engines.splice(i, 1);
    if (dispose) engine.dispose();
    else engine.removeFromScene();
  }

  get(EngineClass) {
    return this.engines.find((e) => e instanceof EngineClass) ?? null;
  }

  /** The camera that is really rendering: the XR camera while in a session. */
  get activeCamera() {
    const xr = this.renderer.xr;
    return xr?.isPresenting ? xr.getCamera() : this.camera;
  }

  update(deltaTime) {
    this.environment.update(deltaTime);
    const camera = this.activeCamera;
    for (const engine of this.engines) engine.update(deltaTime, camera);
  }

  setQuality(preset) {
    this.quality = normalizeQuality(preset);
    for (const engine of this.engines) engine.setQuality(this.quality);
    return this;
  }

  dispose() {
    for (const engine of this.engines) engine.dispose();
    this.engines.length = 0;
    this.environment.clearListeners();
  }
}
