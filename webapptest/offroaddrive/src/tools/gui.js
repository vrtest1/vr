import { Weather } from '../core/WorldEnvironment.js';
import { QUALITY_ORDER } from '../core/Quality.js';

/**
 * GUI builders. They only use the lil-gui API of the `gui` object you pass in
 * (add / addColor / addFolder / onChange / listen), so the library itself does
 * not import a GUI package.
 */

/**
 * Build controls for every parameter in the engine's parameterSchema, grouped
 * into folders, plus a quality selector.
 * @returns the folder that was created
 */
export function buildEngineGUI(gui, engine, { title, quality = true, closed = false } = {}) {
  const ctor = engine.constructor;
  const folder = gui.addFolder(title ?? ctor.engineName);
  const proxy = engine.getParameters();
  const controllers = {};

  if (quality) {
    const q = { quality: engine.quality };
    const c = folder.add(q, 'quality', [...QUALITY_ORDER].reverse()).onChange((v) => engine.setQuality(v));
    engine.on('quality', (v) => {
      q.quality = v;
      c.updateDisplay();
    });
  }

  const groups = new Map();
  for (const [name, def] of Object.entries(ctor.parameterSchema)) {
    const groupName = def.group ?? 'Parameters';
    let group = groups.get(groupName);
    if (!group) {
      group = folder.addFolder(groupName);
      groups.set(groupName, group);
    }
    let c;
    if (def.type === 'color') c = group.addColor(proxy, name);
    else if (def.type === 'select') c = group.add(proxy, name, def.options);
    else if (def.type === 'boolean') c = group.add(proxy, name);
    else c = group.add(proxy, name, def.min, def.max, def.step ?? (def.type === 'int' ? 1 : undefined));
    if (def.label) c.name(def.label);
    c.onChange((v) => engine.setParameters({ [name]: v }));
    controllers[name] = c;
  }

  // Keep the GUI in sync when parameters are changed from code.
  engine.on('change', ({ changed }) => {
    for (const key in changed) {
      proxy[key] = changed[key];
      controllers[key]?.updateDisplay();
    }
  });

  if (closed) folder.close();
  return folder;
}

/** Build controls for a WorldEnvironment. */
export function buildEnvironmentGUI(gui, environment, { title = 'Environment', closed = false } = {}) {
  const folder = gui.addFolder(title);
  const proxy = environment.toJSON();
  const add = (key, ...args) =>
    folder.add(proxy, key, ...args).onChange((v) => environment.set({ [key]: v }));

  const controllers = {
    timeOfDay: add('timeOfDay', 0, 24, 0.01).name('time (h)'),
    timeScale: add('timeScale', 0, 7200, 1).name('time scale (x)'),
    dayOfYear: add('dayOfYear', 1, 365, 1).name('day of year'),
    latitude: add('latitude', -90, 90, 0.5).name('latitude (°)'),
    weather: add('weather', Object.values(Weather)),
    cloudCover: add('cloudCover', 0, 1, 0.01).name('cloud cover'),
    precipitation: add('precipitation', 0, 1, 0.01),
    temperature: add('temperature', -40, 45, 0.5).name('temperature (°C)'),
    humidity: add('humidity', 0, 100, 1).name('humidity (%)'),
    visibility: add('visibility', 50, 80000, 50).name('visibility (m)'),
    windDirection: add('windDirection', 0, 360, 1).name('wind from (°)'),
    windSpeed: add('windSpeed', 0, 40, 0.1).name('wind (m/s)'),
    waterLevel: add('waterLevel', -200, 400, 0.5).name('water level (m)'),
  };

  environment.on('change', ({ keys }) => {
    const state = environment.toJSON();
    for (const key of keys) {
      if (key in controllers) {
        proxy[key] = state[key];
        controllers[key].updateDisplay();
      }
    }
  });

  if (closed) folder.close();
  return folder;
}
