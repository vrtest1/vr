// Offroad drive: a 4WD pickup in the Procedural World.
import * as THREE from 'three';
import { createWorld } from '../examples/shared/createWorld.js';
import { Vehicle } from './vehicle.js';
import { makeGround } from './ground.js';
import { loadTruck, poseWheels, setLamps, rearLampPoint, setSteeringWheelAngle } from './truckModel.js';
import { TruckSound } from './truckSound.js';
import { Dust, SkyReflection, makeContactShadow, TireTracks, LampGlow } from './effects.js';
import { Cannonball } from './cannonball.js';
import { MetalBGM } from './music/metal.js';
import { Moon } from './moon.js';
import { Multiplayer } from './net/multiplayer.js';
import { RemoteTrucks, packState, vehicleLamps } from './net/remotes.js';
import { createLobby } from './net/lobby.js';
import { createChat } from './net/chat.js';
import { StarDrops, haloTexture } from './stars.js';
import { Games } from './net/games.js';
import { Minimap } from './minimap.js';
import { makeDirty, mudAt } from './dirt.js';
import { RainStreaks, makeWindscreenRain } from './rain.js';
import { t, EN, LANG, setLang, placeName } from './i18n.js';
import { HOME_SEED, HOME_START, vegetationSeed, findStart } from './world.js';

const query = new URLSearchParams(location.search);
const num = (k, d) => (query.has(k) ? Number(query.get(k)) : d);
const $ = (id) => document.getElementById(id);

const SCENES = {
  morning: { environment: { timeOfDay: 6.9, weather: 'partlyCloudy', humidity: 75, windSpeed: 2 }, volumetric: { visibility: 500, falloff: 30 }, post: { temperature: -0.03, saturation: 1.0, contrast: 1.03, bloomIntensity: 0.3 } },
  noon: { environment: { timeOfDay: 12.5, weather: 'clear', humidity: 45, windSpeed: 5 }, volumetric: { visibility: 9000, falloff: 60 }, post: { temperature: 0, saturation: 1.06, contrast: 1.04, bloomIntensity: 0.22 } },
  golden: { environment: { timeOfDay: 17.3, weather: 'partlyCloudy', humidity: 55, windSpeed: 4 }, volumetric: { visibility: 2600, falloff: 40 }, post: { temperature: 0.08, saturation: 1.08, contrast: 1.05, bloomIntensity: 0.32 } },
  rain: { environment: { timeOfDay: 14, weather: 'rain', humidity: 92, windSpeed: 9 }, volumetric: { visibility: 900, falloff: 80 }, post: { temperature: -0.05, saturation: 0.9, contrast: 1.02, bloomIntensity: 0.15 } },
  night: { environment: { timeOfDay: 21.5, weather: 'clear', humidity: 60, windSpeed: 2 }, volumetric: { visibility: 3000, falloff: 50 }, post: { temperature: -0.04, saturation: 1.0, contrast: 1.04, bloomIntensity: 0.4 } },
};
const firstScene = SCENES[query.get('scene')] ? query.get('scene') : 'noon';
// Steering-wheel controllers (by their gamepad id) and their rotation, lock to
// lock in degrees (?wheel=1080 etc. if yours is set differently).
const WHEEL_ID = /wheel|G2[5579]\b|G9[02][03]|driving force|T300|T150|T248|TMX|thrustmaster|fanatec|moza|simagic/i;
const WHEEL_RANGE = num('wheel', 900);
// Which world: ?seed= (0..99999, the engine's range), else the usual one.
// ?x= & ?z= put the truck somewhere by hand; otherwise each world finds its own start.
const SEED_MAX = 99999;
const seedOf = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= SEED_MAX ? n : null;
};
const firstSeed = seedOf(query.get('seed')) ?? HOME_SEED;
const handStart = query.has('x') && query.has('z');
let START = handStart || firstSeed === HOME_SEED
  ? { x: num('x', HOME_START.x), z: num('z', HOME_START.z), heading: num('heading', HOME_START.heading) }
  : null; // found once the terrain is up (below)

function fail(err) {
  console.error(err);
  const el = $('error');
  el.textContent = `${t('起動に失敗しました', 'Could not start')}:\n${err?.message ?? err}`;
  el.style.display = 'grid';
}

try {
  await main();
} catch (err) {
  fail(err);
}

async function main() {
  // The page's own words, in English if that is the language.
  if (EN) {
    document.documentElement.lang = 'en';
    document.title = 'Offroad Drive';
    $('help').innerHTML = `<b>W / ↑</b> throttle　<b>S / ↓</b> brake, reverse　<b>A D / ← →</b> steer<br>
  <b>Space</b> handbrake　<b>L</b> 4H / 4L　<b>C</b> view　<b>R</b> reset　<b>drag</b> look around<br>
  <b>B</b> music　<b>N</b> next song　<b>G</b> Cannonball　<b>H</b> hide this　<b>M</b> sound　<b>Enter</b> chat (multiplayer)<br>PS4: R2 throttle, L2 brake, left stick steer, × / ○ handbrake, R1 view, L1 4L, SHARE reset　Xbox: RT / LT, A / B handbrake, RB view, LB 4L, View reset`;
    for (const [k, text] of [['brake', 'Brake'], ['gas', 'Gas'], ['hand', 'Hand']]) {
      const b = document.querySelector(`#touch button[data-k="${k}"]`);
      if (b) b.textContent = text;
    }
  }
  // --- the truck's model and its settings
  let config = null;
  if (query.get('model') !== '0') {
    try {
      const r = await fetch('models/truck.json', { cache: 'no-cache' });
      if (r.ok) config = await r.json();
    } catch { /* stand-in */ }
  }

  let vehicle = null, truck = null, ground = null, sound = new TruckSound();
  let remotes = null; // other players' trucks (multiplayer)
  const w = await createWorld({
    quality: query.get('quality') ?? undefined,
    controls: false,
    hud: false,
    environment: SCENES[firstScene].environment,
    start: START ? { x: START.x, z: START.z } : { x: 0, z: 0 },
    params: {
      terrain: { seed: firstSeed },
      vegetation: { seed: vegetationSeed(firstSeed) },
      atmosphere: { shadowRange: 260 },
      volumetric: SCENES[firstScene].volumetric,
      post: { vignette: 0.2, ...SCENES[firstScene].post },
    },
    onFrame: (dt, h) => frame(dt, h),
  });
  window.pwe = w;
  const { scene, camera, rig, renderer, terrain, ocean, vegetation, atmosphere, volumetric, underwater, environment } = w;

  ground = makeGround({
    heightField: terrain.heightField,
    water: (x, z) => ocean.getHeightAt(x, z),
    trees: (x, z, r, visit) => { vegetation.forEachTrunkNear(x, z, r, visit); remotes?.obstacles(x, z, r, visit); },
    wetness: () => Math.min(1, environment.precipitation * 1.5),
  });

  const treeChance = (x, z) => vegetation.treeChanceAt(x, z);
  START ??= findStart(ground, firstSeed, THREE.Vector3, treeChance);

  // Model first (its wheel positions set the suspension geometry).
  const baseSpec = { ...(await import('./vehicle.js')).DEFAULT_SPEC };
  try {
    truck = await loadTruck(baseSpec, config);
  } catch (e) {
    console.warn('model failed, using the stand-in:', e);
    truck = await loadTruck(baseSpec, null);
  }
  const spec = { ...(config?.physics ?? {}) };
  if (truck.fit) {
    const f = truck.fit;
    Object.assign(spec, {
      wheelbase: f.wheelbase, track: f.track, wheelRadius: f.wheelRadius, wheelWidth: f.wheelWidth ?? baseSpec.wheelWidth,
      frontOffset: -f.comAhead, // axles sit behind/ahead of the centre of mass by this much
      size: [f.size[0], Math.min(f.size[1], 2.2), f.size[2]],
      bodyTop: f.bodyTopAboveAxle - f.comAboveAxle - 0.05,
      bodyBottom: Math.max(f.bodyBottomAboveAxle - f.comAboveAxle + 0.05, -0.45),
      ...(config?.physics ?? {}),
    });
    // The wheel centre at static ride must sit where the model's wheels are:
    // hardpoint - (restLength - staticCompression) = -comAboveAxle.
    const sp = { ...baseSpec, ...spec };
    const k = (2 * Math.PI * sp.frequency) ** 2 * (sp.mass / 4);
    const staticComp = (sp.mass * 9.81 / 4) / k;
    spec.hardpointY = -f.comAboveAxle + sp.restLength - staticComp;
  }
  vehicle = new Vehicle(spec);
  scene.add(truck.root);
  // Make the truck part of the world: sky light, haze, fog, under water (in this order).
  atmosphere.applyToObject(truck.root);
  volumetric?.applyToObject(truck.root);
  underwater.applyToObject(truck.root);
  // Mud, dust, snow and water on the body (dirt.js). The body's extent in its
  // own space, measured while the model still sits at the origin.
  const bodyBox = new THREE.Box3().setFromObject(truck.root);
  const dirt = makeDirty(truck.root, bodyBox);
  const remoteDirt = new WeakMap(); // root -> its dirt
  // Rain: streaks round the camera (fewer at lower quality) and drops on our windscreen.
  const RAIN_COUNT = { high: 9000, medium: 5000, low: 2000 };
  const rainFx = new RainStreaks(RAIN_COUNT.high);
  rainFx.setCount(RAIN_COUNT[w.quality] ?? RAIN_COUNT.medium);
  rainFx.setTruckBox(bodyBox);
  scene.add(rainFx.mesh);
  const screenRain = makeWindscreenRain(truck.root);
  if (screenRain) screenRain.onStroke = (dur) => sound.wiperStroke(dur, camMode >= 2);
  const truckMaterials = new Set();
  truck.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial) truckMaterials.add(m); });

  const reflection = new SkyReflection(renderer);
  const contactShadow = makeContactShadow(vehicle.spec.size[0], vehicle.spec.size[2]);
  scene.add(contactShadow);
  const moon = new Moon(scene);
  const tracks = new TireTracks();
  scene.add(tracks.mesh);
  // Sun shadow sharp enough for a truck (the engine's default bias suits mountains).
  if (atmosphere.sunLight) { atmosphere.sunLight.shadow.bias = -0.00003; atmosphere.sunLight.shadow.normalBias = 0.25; }
  const dust = new Dust();
  scene.add(dust.points);

  const lamp = { brake: 0, reverse: 0, tail: 0 };
  const engineWas = { on: true, warned: false };
  // Light from the rear lamps on the ground and grass behind (not a three.js light: see LampGlow).
  const LAMP_CD = { brake: 12, tail: 1.5, reverse: 35 }; // candela (toned down from real lamps: reads better on screen)
  const rearLamp = rearLampPoint(truck.root) ?? new THREE.Vector3(0, 0.1, vehicle.spec.size[2] / 2);
  const glow = new LampGlow();
  scene.add(glow.mesh);
  const remoteGlows = new Map();
  const glowColor = new THREE.Color(), glowAt = new THREE.Vector3(), glowBack = new THREE.Vector3();
  const lampLight = (out, brake, reverse, tail, dark) => out.setRGB(1, 0.02, 0.01)
    .multiplyScalar(LAMP_CD.brake * brake + LAMP_CD.tail * tail)
    .add(revColor.setRGB(1, 0.95, 0.85).multiplyScalar(LAMP_CD.reverse * reverse))
    .multiplyScalar(dark); // by day the lamps make no visible light on the ground
  const revColor = new THREE.Color();
  const placeGlow = (g, pos, quat, l, dark) => {
    glowAt.copy(rearLamp).applyQuaternion(quat).add(pos);
    glowBack.set(0, 0, 1).applyQuaternion(quat);
    lampLight(glowColor, l.brake, l.reverse, l.tail, dark);
    g.update(glowAt, glowBack, glowColor, ground);
  };

  // Headlights.
  const lights = [];
  for (const x of [-0.6, 0.6]) {
    const l = new THREE.SpotLight(0xfff1d6, 0, 140, 0.46, 0.5, 2);
    const front = -(vehicle.spec.size[2] / 2) + 0.2;
    l.position.set(x, -0.05, front);
    l.target.position.set(x * 1.2, -1.6, front - 20);
    truck.root.add(l, l.target);
    lights.push(l);
  }

  vehicle.place(START.x, START.z, START.heading, ground);
  let lastSafe = { x: START.x, z: START.z, heading: START.heading }, safeTimer = 0;

  // --- input
  const keys = new Set();
  const touch = { left: false, right: false, gas: false, brake: false, hand: false };
  const input = { steer: 0, throttle: 0, brake: 0 };
  let camMode = query.has('cam') ? Number(query.get('cam')) : 0;
  const CAMS = EN ? ['Chase', 'Far', 'Driver', 'Bonnet'] : ['追従', '遠め', '運転席', 'ボンネット'];
  const orbit = { yaw: 0, pitch: 0, idle: 0, dragging: false, x: 0, y: 0, zoom: 1 };
  // Inside views: how much of the body's pitch and roll the driver's head takes (see updateCamera).
  const HEAD_PITCH = num('headPitch', 0.6), HEAD_ROLL = num('headRoll', 0.3);
  const head = new THREE.Quaternion(), headTarget = new THREE.Quaternion(), headEul = new THREE.Euler(), bodyEul = new THREE.Euler();
  let headReady = false;

  const resetTruck = () => {
    const p = vehicle.position;
    if (vehicle.submerged > 0.3 || ground.height(p.x, p.z) < ground.water(p.x, p.z) - 0.6) {
      vehicle.place(lastSafe.x, lastSafe.z, lastSafe.heading, ground);
    } else vehicle.place(p.x, p.z, vehicle.heading, ground);
  };
  const toggleLow = () => {
    if (Math.abs(vehicle.speed) < 6) vehicle.low = !vehicle.low;
  };
  const nextCam = () => { camMode = (camMode + 1) % CAMS.length; orbit.yaw = orbit.pitch = 0; updateCamButton(); };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyR') resetTruck();
      if (e.code === 'KeyL') toggleLow();
      if (e.code === 'KeyC') nextCam();
      if (e.code === 'KeyH') toggleHelp();
      if (e.code === 'KeyM') toggleSound();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const dom = renderer.domElement;
  dom.style.touchAction = 'none';
  // One finger (or the mouse) looks around; two fingers pinch to zoom.
  const fingers = new Map(); // pointerId -> {x, y}
  let pinch = 0;
  const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    orbit.dragging = true; orbit.x = e.clientX; orbit.y = e.clientY;
    if (fingers.size === 2) pinch = spread();
  });
  dom.addEventListener('pointermove', (e) => {
    if (!orbit.dragging || !fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size >= 2) {
      const d = spread();
      if (pinch > 0 && d > 0) orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * (pinch / d), 0.5, 3); // spread apart = closer
      pinch = d;
      orbit.idle = 0;
      return;
    }
    orbit.yaw -= (e.clientX - orbit.x) * 0.006;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + (e.clientY - orbit.y) * 0.004, -0.5, 1.0); // up/down inverted (user's preference)
    orbit.x = e.clientX; orbit.y = e.clientY; orbit.idle = 0;
  });
  const endDrag = (e) => {
    fingers.delete(e.pointerId);
    pinch = 0;
    if (fingers.size === 1) { const [f] = fingers.values(); orbit.x = f.x; orbit.y = f.y; } // carry on with the other finger
    else if (!fingers.size) orbit.dragging = false;
  };
  dom.addEventListener('pointerup', endDrag);
  dom.addEventListener('pointercancel', endDrag);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * Math.exp(e.deltaY * 0.001), 0.5, 3);
  }, { passive: false });

  // The 4H / 4L badge on the meter switches the range (tap or click).
  $('range').addEventListener('click', (e) => { e.stopPropagation(); toggleLow(); });
  $('range').title = t('4H / 4L 切替（L）。止まっているか、ゆっくりのときだけ', '4H / 4L (L). Only when stopped or slow');

  // Touch buttons (shown on touch devices).
  if (matchMedia('(pointer: coarse)').matches) {
    $('touch').hidden = false;
    for (const b of document.querySelectorAll('#touch button')) {
      const k = b.dataset.k;
      const set = (on) => (e) => { e.preventDefault(); touch[k] = on; b.classList.toggle('on', on); if (on) startSound(); };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
    }
  }

  // Sound starts on the first gesture (browser rule).
  let soundOn = query.get('audio') !== '0';
  const startSound = () => {
    if (!soundOn) return;
    sound.start().catch((e) => console.warn(e.message));
  };
  const toggleSound = () => {
    soundOn = !soundOn;
    if (soundOn) { startSound(); sound.ctx?.resume(); w.audio?.start().catch(() => {}); } else { sound.ctx?.suspend(); w.audio?.stop(); }
    soundButton?.setAttribute('aria-pressed', String(soundOn));
  };
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, startSound, { once: true });

  // Gamepad. Browsers report a PS4 / PS5 controller (and others) either with the
  // "standard" layout or raw, where the triggers are axes and the face buttons
  // are numbered differently; both are handled. The page only sees a pad after
  // a button is pressed while it has focus.
  const pad = { prev: {}, seen: new Map(), shown: '' };
  const padToast = (text, ms = 4000) => {
    const el = $('padToast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(pad.toastTimer);
    pad.toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  };
  window.addEventListener('gamepadconnected', (e) => {
    const g = e.gamepad;
    padToast(`🎮 ${t('コントローラーを認識しました', 'Controller found')}: ${g.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'gamepad'} (${g.mapping || t('独自配置', 'own layout')})`);
  });
  window.addEventListener('gamepaddisconnected', () => padToast(t('🎮 コントローラーが外れました', '🎮 Controller disconnected')));
  const RAW_DS = { cross: 1, circle: 2, square: 0, triangle: 3, l1: 4, r1: 5, share: 8, options: 9 }; // DualShock raw (macOS)
  const STD = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, share: 8, options: 9 };
  // Every connected pad is read and their inputs combined (this Mac, for one,
  // has a USB pad and a DualShock 4 at the same time); each keeps its own
  // button history so a press on one is never lost to the other.
  const readOne = (gp) => {
    const standard = gp.mapping === 'standard';
    const sony = /054c|sony|wireless controller|dualshock|dualsense/i.test(gp.id);
    // A steering-wheel controller: its wheel is axis 0, read without the pad's
    // dead zone. Its pedals and other axes differ per model, so they are not
    // guessed at (no stray camera turning from a pedal on axis 2 or 3).
    const wheel = WHEEL_ID.test(gp.id);
    const M = standard || !sony ? STD : RAW_DS;
    const prev = pad.prev[gp.index] ?? [];
    const seen = pad.seen.get(gp.index) ?? new Set();
    pad.seen.set(gp.index, seen);
    const btn = (i) => gp.buttons[i]?.value ?? 0;
    const pressed = (i) => (gp.buttons[i]?.pressed ?? false) && !prev[i];
    // Triggers: standard pads put them on buttons 6 / 7; raw pads on axes 3 / 4
    // (-1 released .. 1 pressed), which some read as 0 until first touched, so
    // an axis only counts once it has been seen at rest.
    const axisTrigger = (i) => {
      const v = gp.axes[i];
      if (v === undefined) return 0;
      if (v < -0.9) seen.add(i);
      return seen.has(i) ? Math.max(0, (v + 1) / 2) : 0;
    };
    let throttle = btn(7), brake = btn(6);
    if (!standard && gp.axes.length >= 5) { throttle = Math.max(throttle, axisTrigger(4)); brake = Math.max(brake, axisTrigger(3)); }
    const actions = {
      cam: pressed(M.triangle) || pressed(M.r1),
      low: pressed(M.square) || pressed(M.l1),
      reset: pressed(M.share),
      help: pressed(M.options),
    };
    pad.prev[gp.index] = gp.buttons.map((x) => x.pressed);
    const rx = wheel ? 0 : gp.axes[2] ?? 0, ry = wheel ? 0 : (standard || !sony ? gp.axes[3] : gp.axes[5]) ?? 0;
    if (wheel && !standard) { throttle = btn(7); brake = btn(6); }
    return { steer: gp.axes[0] ?? 0, throttle, brake, handbrake: btn(M.cross) > 0.5 || btn(M.circle) > 0.5, rx, ry, actions, wheel };
  };
  const readPad = () => {
    if (query.get('pad') === '0') return null; // tests: ignore real controllers
    const list = [...(navigator.getGamepads?.() ?? [])].filter((g) => g && g.connected);
    if (!list.length) return null;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const out = { steer: 0, throttle: 0, brake: 0, handbrake: false, wheel: false };
    let rx = 0, ry = 0;
    for (const gp of list) {
      const r = readOne(gp);
      const st = r.wheel ? (Math.abs(r.steer) < 0.01 ? 0 : r.steer) : dz(r.steer);
      if (Math.abs(st) > Math.abs(out.steer) || (r.wheel && st === out.steer)) { out.steer = st; out.wheel = r.wheel; }
      out.throttle = Math.max(out.throttle, r.throttle);
      out.brake = Math.max(out.brake, r.brake);
      out.handbrake ||= r.handbrake;
      if (Math.abs(r.rx) > Math.abs(rx)) rx = r.rx;
      if (Math.abs(r.ry) > Math.abs(ry)) ry = r.ry;
      if (r.actions.cam) nextCam();
      if (r.actions.low) toggleLow();
      if (r.actions.reset) resetTruck();
      if (r.actions.help) toggleHelp();
    }
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) {
      orbit.yaw -= dz(rx) * 0.05; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dz(ry) * 0.03, -0.5, 1); orbit.idle = 0; // up/down inverted (user's preference)
    }
    if (query.get('pad') === '1') {
      const t = list.map((gp) => `[${gp.index}] ${gp.id} | ${gp.mapping || 'raw'} | axes ${gp.axes.map((a) => a.toFixed(2)).join(' ')} | buttons ${gp.buttons.map((b, i) => (b.pressed || b.value > 0.05 ? i : null)).filter((x) => x !== null).join(',')}`).join('\n');
      if (t !== pad.shown) { pad.shown = t; padToast(t, 600000); }
    }
    return out;
  };

  // --- top bar
  const bar = $('bar');
  // Phones and tablets: the bar folds away behind ☰ (起こす and チャット stay).
  const coarse = matchMedia('(pointer: coarse)').matches;
  // The model's credit (CC BY 4.0) goes with the help panel (H, or OPTIONS on
  // a pad); on phones, where there is no help panel, with the bar (☰). It is
  // always one key or tap away, and in the README and CREDITS.txt.
  function showCredit() {
    $('credit').hidden = coarse ? bar.classList.contains('collapsed') : $('help').hidden;
  }
  function toggleHelp() {
    $('help').hidden = !$('help').hidden;
    showCredit();
  }
  if (coarse) {
    const MENU_KEY = 'offroad-drive.menu.v1';
    const menu = document.createElement('button');
    menu.className = 'keep menu';
    menu.setAttribute('aria-label', t('メニュー', 'Menu'));
    const setMenu = (open) => {
      bar.classList.toggle('collapsed', !open);
      showCredit();
      menu.textContent = open ? '✕' : '☰';
      try { localStorage.setItem(MENU_KEY, open ? '1' : '0'); } catch { /* private mode */ }
    };
    menu.addEventListener('click', (e) => { e.stopPropagation(); setMenu(bar.classList.contains('collapsed')); });
    bar.appendChild(menu);
    let open = false;
    try { open = localStorage.getItem(MENU_KEY) === '1'; } catch { /* private mode */ }
    setMenu(open);
  }
  // No zooming the page by double tap or pinch (iOS ignores user-scalable=no).
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  const buttons = (names, current, onPick) => {
    const made = names.map(([id, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => pick(id));
      bar.appendChild(b);
      return [id, b];
    });
    const pick = (id) => { for (const [o, b] of made) b.setAttribute('aria-pressed', String(o === id)); onPick(id); };
    for (const [id, b] of made) b.setAttribute('aria-pressed', String(id === current));
    const gap = document.createElement('span'); gap.className = 'gap'; bar.appendChild(gap);
    return { pick, els: made.map(([, b]) => b), set: (id) => { for (const [o, b] of made) b.setAttribute('aria-pressed', String(o === id)); } };
  };
  let currentScene = firstScene;
  const setScene = (name, fromHost = false) => {
    const s = SCENES[name];
    if (!s) return;
    currentScene = name;
    sceneButtons?.set(name);
    if (name === 'night' && !fromHost) { moon.randomize(); updateMoonButton(); }
    environment.set(s.environment);
    volumetric?.setParameters(s.volumetric);
    w.post?.setParameters(s.post);
    reflection.update(0, atmosphere, environment, true);
    if (!fromHost) shareEnv();
  };
  let sceneButtons = null;
  sceneButtons = buttons([['morning', t('朝', 'Morning')], ['noon', t('昼', 'Noon')], ['golden', t('夕方', 'Evening')], ['rain', t('雨', 'Rain')], ['night', t('夜', 'Night')]], firstScene, (n) => setScene(n));
  buttons([['high', 'high'], ['medium', 'medium'], ['low', 'low']], w.quality, (q) => { w.setQuality(q); rainFx.setCount(RAIN_COUNT[q] ?? RAIN_COUNT.medium); });
  // Tonight's moon (random; a new moon is as dark as no moon at all). Click for another.
  const moonButton = document.createElement('button');
  const updateMoonButton = () => { moonButton.textContent = `${moon.phase.icon} ${t(moon.phase.name, moon.phase.en)}`; };
  moonButton.title = t('月を変える', 'Another moon');
  moonButton.addEventListener('click', (e) => { e.stopPropagation(); moon.randomize(); updateMoonButton(); shareEnv(); });
  updateMoonButton();
  bar.appendChild(moonButton);
  const camButton = document.createElement('button');
  const updateCamButton = () => { camButton.textContent = `${t('視点', 'View')}: ${CAMS[camMode]}`; };
  camButton.addEventListener('click', nextCam);
  updateCamButton();
  bar.appendChild(camButton);
  const soundButton = document.createElement('button');
  soundButton.textContent = t('音', 'Sound');
  soundButton.setAttribute('aria-pressed', String(soundOn));
  soundButton.addEventListener('click', (e) => { e.stopPropagation(); toggleSound(); });
  bar.appendChild(soundButton);
  // BGM: original heavy metal, synthesised (music/).
  const bgm = new MetalBGM();
  bgm.volume = 0.45;
  const bgmButton = document.createElement('button');
  const nextButton = document.createElement('button');
  nextButton.textContent = '⏭';
  nextButton.title = t('次の曲 (N)', 'Next song (N)');
  nextButton.hidden = true;
  bgm.onchange = (song) => {
    bgmButton.textContent = song ? `♪ ${EN ? song.en ?? song.title : song.title}` : t('BGM', 'Music');
    bgmButton.setAttribute('aria-pressed', String(!!song));
    nextButton.hidden = !song;
  };
  bgm.onchange(null);
  const toggleBgm = () => (bgm.playing ? bgm.stop() : bgm.play().catch((e) => console.warn(e)));
  bgmButton.addEventListener('click', (e) => { e.stopPropagation(); toggleBgm(); });
  nextButton.addEventListener('click', (e) => { e.stopPropagation(); bgm.next(); });
  bar.appendChild(bgmButton);
  bar.appendChild(nextButton);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyB') toggleBgm();
    if (e.code === 'KeyN' && bgm.playing) bgm.next();
  });
  const resetButton = document.createElement('button');
  resetButton.textContent = coarse ? t('起こす', 'Reset') : t('起こす (R)', 'Reset (R)');
  resetButton.classList.add('keep');
  resetButton.addEventListener('click', resetTruck);
  bar.appendChild(resetButton);

  const cannonball = new Cannonball({
    ground, vehicle, scene, camera, sound, bar,
    items: () => stars?.markers() ?? [],
    brightness: () => atmosphere.skyLight?.intensity ?? 1,
    place: (x, z, heading) => { vehicle.place(x, z, heading, ground); camHeading = heading; camReady = false; orbit.yaw = orbit.pitch = 0; },
  });
  // お助けアイテム: stars fall while this is on (each player's own choice).
  const stars = new StarDrops({
    scene, ground, vehicle, sound, cannonball,
    brightness: () => atmosphere.skyLight?.intensity ?? 1,
    onSharedTouch: (id) => games?.take(id), // a mini-game star
    place: (x, z, heading) => { vehicle.place(x, z, heading, ground); camHeading = heading; camReady = false; orbit.yaw = orbit.pitch = 0; },
    toast: (text) => padToast(text, 3500),
    onLand: (at) => {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        dust.emit(tmp.set(at.x + Math.sin(a) * 1.5, at.y + 0.3, at.z + Math.cos(a) * 1.5), tmp2.set(Math.sin(a) * 3, 1.5 + Math.random() * 2, Math.cos(a) * 3), 1.2 + Math.random(), 1.4, 0.75, 0.68, 0.55);
      }
    },
  });
  // Super armour: rainbow bands race over the truck's body and a halo of light
  // wraps it. Works for any truck root (ours, or another player's when their
  // state bit 4 is set). The body shader gets an extra emissive term, added on
  // top of whatever onBeforeCompile it already has (sky, fog, under water).
  const rainbowState = new WeakMap();
  let rainbowHalo = null;
  const RAINBOW_GLSL = /* glsl */ `
    vec3 pwsRainbowHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`;
  const patchRainbow = (m) => {
    const u = { uRbAmt: { value: 0 }, uRbTime: { value: 0 }, uRbTint: { value: 0 } };
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prev?.call(m, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRbPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvRbPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vRbPos;\nuniform float uRbAmt;\nuniform float uRbTime;\nuniform float uRbTint;\n${RAINBOW_GLSL}`)
        // The paint itself takes the colour too, so it reads in daylight.
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), pwsRainbowHue(fract(uRbTime * 1.2 + (vRbPos.x + vRbPos.y * 1.3 + vRbPos.z) * 0.22)), uRbTint);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += pwsRainbowHue(fract(uRbTime * 1.2 + (vRbPos.x + vRbPos.y * 1.3 + vRbPos.z) * 0.22)) * uRbAmt;');
    };
    const key = m.customProgramCacheKey?.bind(m);
    m.customProgramCacheKey = () => (key ? key() : '') + '|rainbow';
    m.needsUpdate = true;
    return u;
  };
  const rainbowGlow = (root, on, now, halo = true) => {
    let st = rainbowState.get(root);
    if (!st) {
      if (!on) return;
      st = { u: [], aura: null, on: false };
      root.traverse((o) => {
        if (!o.isMesh || o.userData.isLamp) return;
        // Not the glass: you have to see out through it.
        for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && !/glass/i.test(m.name) && !m.userData.rainbow) { m.userData.rainbow = patchRainbow(m); }
        for (const m of [].concat(o.material)) if (m.userData.rainbow && !st.u.includes(m.userData.rainbow)) st.u.push(m.userData.rainbow);
      });
      rainbowHalo ??= haloTexture();
      st.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: rainbowHalo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      st.aura.scale.setScalar(10);
      st.aura.position.set(0, 0.4, 0);
      st.aura.renderOrder = 6;
      root.add(st.aura);
      rainbowState.set(root, st);
    }
    const sky = atmosphere.skyLight?.intensity ?? 1;
    const pulse = 0.7 + 0.3 * Math.sin(now * 13);
    for (const u of st.u) {
      u.uRbAmt.value = on ? (0.5 + 1.2 * Math.min(1.5, sky)) * pulse : 0;
      u.uRbTime.value = now;
      u.uRbTint.value = on ? 0.8 : 0;
    }
    st.aura.visible = on && halo;
    if (on) {
      st.aura.material.color.setHSL((now * 1.2) % 1, 1, 0.55);
      st.aura.material.opacity = (0.55 + 0.25 * Math.min(1, sky)) * pulse;
    }
    st.on = on;
  };
  const ITEM_KEY = 'offroad-drive.items.v1';
  const itemButton = document.createElement('button');
  itemButton.textContent = t('アイテム', 'Items');
  itemButton.title = t('お助けアイテム（星）を降らせる', 'Helpful stars fall from the sky');
  const setItems = (on) => {
    stars.setEnabled(on);
    itemButton.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(ITEM_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  };
  itemButton.addEventListener('click', (e) => {
    e.stopPropagation();
    setItems(!stars.enabled);
    padToast(stars.enabled ? t('★ アイテム オン: ときどき星が降ってきます（ピンク=ブースト、水色=グリップ、黄色=ワープ）', '★ Items on: now and then a star falls (pink = boost, blue = grip, yellow = warp)') : t('アイテム オフ', 'Items off'), 4500);
  });
  bar.appendChild(itemButton);
  // 洗車: a shower over the truck for a moment, and the mud, dust and snow
  // run off (it is left wet and shiny, and dries like after a swim).
  let washing = 0;
  const washButton = document.createElement('button');
  washButton.textContent = t('洗車', 'Wash');
  washButton.title = t('車を洗う（泥・砂ぼこり・雪を落とす）', 'Wash the truck (mud, dust, snow)');
  washButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const d = dirt.state;
    if (d.mud + d.dust + d.snow < 0.02) { padToast(t('もうピカピカです ✨', 'Already spotless ✨'), 2500); return; }
    washing = 1.6;
    padToast(t('🫧 洗車中…', '🫧 Washing…'), 1800);
  });
  bar.appendChild(washButton);
  let itemsSaved = false;
  try { itemsSaved = localStorage.getItem(ITEM_KEY) === '1'; } catch { /* private mode */ }
  setItems(itemsSaved);
  // The minimap (each player's own choice, on unless turned off).
  const minimap = new Minimap({
    ground, vehicle,
    items: () => stars.markers(),
    others: () => (remotes ? [...remotes.list.values()].filter((r) => r.root.visible).map((r) => ({ x: r.position.x, z: r.position.z, color: r.info.color })) : []),
  });
  const MAP_KEY = 'offroad-drive.map.v1';
  const mapButton = document.createElement('button');
  mapButton.textContent = t('地図', 'Map');
  mapButton.title = t('ミニマップ', 'Minimap');
  const setMap = (on) => {
    minimap.setEnabled(on);
    mapButton.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(MAP_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  };
  mapButton.addEventListener('click', (e) => { e.stopPropagation(); setMap(!minimap.enabled); });
  bar.appendChild(mapButton);
  let mapSaved = true;
  try { mapSaved = localStorage.getItem(MAP_KEY) !== '0'; } catch { /* private mode */ }
  setMap(mapSaved);
  window.addEventListener('keydown', (e) => { if (e.target instanceof HTMLInputElement) return; if (e.code === 'KeyG' && !e.repeat) cannonball.showMenu(cannonball.state === 'running' || cannonball.state === 'countdown'); });
  // --- multiplayer ---------------------------------------------------------
  const net = new Multiplayer();
  let chat = null; // created with the lobby below
  let games = null; // mini-games, likewise
  const remoteTracks = new Map();
  // Send our state on a timer rather than per frame: it keeps going (slower)
  // when this window is in the background and the frame loop pauses.
  setInterval(() => { if (net.active) net.sendState([...packState(vehicle), dirt.state.pack()]); }, 1000 / 15);
  const finishTimes = new Map();
  let raceId = '';
  remotes = new RemoteTrucks(scene, truck, vehicle, (root, color) => {
    // Each player's truck gets its own materials, tinted towards their colour.
    const tint = new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.55);
    // No real lights on other players' trucks (headlight beams, headlamp bulbs):
    // each one costs a little on every pixel. Their lamps still glow.
    const drop = [];
    root.traverse((o) => { if (o.isLight) drop.push(o, o.target); if (o.userData.windscreenRain) drop.push(o); });
    for (const o of drop) o?.removeFromParent();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      for (const m of [].concat(o.material)) {
        if (m.name === 'lambert1') m.color.copy(tint);
        if (m.isMeshStandardMaterial) truckMaterials.add(m);
        m.envMap = null; // picked up again from the sky reflection
      }
    });
    atmosphere.applyToObject(root);
    volumetric?.applyToObject(root);
    underwater.applyToObject(root);
    remoteDirt.set(root, makeDirty(root, bodyBox));
  });
  // The world everyone drives in. `id` changes with every switch, so a guest
  // can tell a new switch from the host repeating the weather.
  let world = { seed: firstSeed, start: { ...START }, id: Math.random().toString(36).slice(2, 10) };
  let worldUI = null; // the 世界 button and panel (made below)
  let langButton = null; // English / 日本語 (made below)
  const worldMsg = (slots) => ({ seed: world.seed, start: world.start, id: world.id, ...(slots ? { slots } : {}) });
  const envNow = (slots) => ({ scene: currentScene, moon: moon.getState(), world: worldMsg(slots) });
  const shareEnv = (slots) => { if (net.active && net.isHost) net.sendEnv(envNow(slots)); };
  const lockHostSettings = () => {
    const guest = net.active && !net.isHost;
    for (const b of [...sceneButtons.els, moonButton]) {
      b.disabled = guest;
      b.title = guest ? t('ホストが決めます', 'The host decides') : '';
    }
    worldUI?.refresh();
    // Switching language reloads the page, which would drop out of the room.
    if (langButton) {
      langButton.disabled = net.active;
      langButton.title = net.active ? t('マルチの部屋にいる間は切り替えられません', 'Not while in a multiplayer room') : '';
    }
  };
  // Everyone abreast at a start, host in the middle, 4.5 m apart (races and new worlds).
  const lineUp = (start) => {
    const h = start.heading;
    const right = { x: Math.cos(h), z: -Math.sin(h) };
    const slots = {};
    net.players.forEach((p, i) => {
      const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 4.5;
      slots[p.id] = { x: start.x + right.x * side, z: start.z + right.z * side, heading: h };
    });
    return slots;
  };
  net.hostEnv = () => envNow();
  net.hostSpot = () => {
    // Newcomers appear beside the host (or at the start line, if a race is on: see hostRace).
    const race = net.hostRace();
    if (race) return { ...race.course.start };
    const h = vehicle.heading;
    const off = 5 + Math.random() * 4;
    return { x: vehicle.position.x + Math.cos(h) * off, z: vehicle.position.z - Math.sin(h) * off, heading: h };
  };
  net.onEnv = (e) => {
    if (e?.world) applyHostWorld(e.world);
    if (e?.moon) moon.setState(e.moon);
    if (e?.scene) setScene(e.scene, true);
    updateMoonButton();
  };
  net.onSpot = (sp) => {
    if (!sp || !Number.isFinite(sp.x)) return;
    vehicle.place(sp.x, sp.z, sp.heading, ground);
    camHeading = sp.heading; camReady = false;
    tracks.break();
  };
  net.onState = (peerId, arr) => {
    const info = net.peers.get(peerId);
    if (info) remotes.receive(peerId, info, arr);
  };
  net.onPeersChanged = () => {
    for (const id of [...remotes.list.keys()]) {
      if (!net.peers.has(id)) {
        remotes.remove(id);
        const t = remoteTracks.get(id);
        if (t) { t.mesh.removeFromParent(); t.mesh.geometry.dispose(); remoteTracks.delete(id); }
        remoteGlows.get(id)?.dispose(); remoteGlows.delete(id);
      }
    }
    for (const [id, info] of net.peers) remotes.list.get(id)?.setInfo(info);
    lockHostSettings();
    lobby.render();
    chat?.peersChanged();
  };
  // Collisions between players: whoever detects the hit sends the other their share.
  const lastHit = new Map(); // peerId -> time we last resolved a hit with them
  const pendingHit = new Map();
  const lastSent = new Map();
  vehicle.onCarHit = (id, imp, strength, armored = false) => {
    games?.touched(id);
    const now = performance.now() / 1000;
    lastHit.set(id, now);
    // One impulse per collision: the physics touches them every step while
    // the bodies overlap, but they only need the first, strongest contact.
    if (now - (lastSent.get(id) ?? -1) < 0.3 && !pendingHit.has(id)) return;
    const p = pendingHit.get(id);
    if (!p || strength > p.s) pendingHit.set(id, { x: imp.x, z: imp.z, s: strength, a: armored });
    lastSent.set(id, now);
  };
  setInterval(() => { // batch the impulses of one collision into one message
    for (const [id, p] of pendingHit) net.sendHit(id, { x: Math.round(p.x), z: Math.round(p.z), s: Math.round(p.s * 100) / 100, ...(p.a ? { a: 1 } : {}) });
    pendingHit.clear();
  }, 50);
  net.onHit = (peerId, h) => {
    games?.touched(peerId);
    const now = performance.now() / 1000;
    vehicle.fx.crash = Math.max(vehicle.fx.crash, h.s || 0);
    sound.crash?.(Math.min(1, (h.s || 0) / 9));
    if (vehicle.armor) return; // super armour: nothing moves us
    if (now - (lastHit.get(peerId) ?? -1) < 0.3) return; // we already took our share
    const m = vehicle.spec.mass;
    // Equal trucks: at most ~65 % of the closing speed carries over to the one that was hit.
    const dv = Math.hypot(h.x, h.z) / m;
    const k = dv > 0 ? Math.min(1, (0.65 * (h.s || 0)) / dv) : 0;
    vehicle.velocity.x += (h.x / m) * k;
    vehicle.velocity.z += (h.z / m) * k;
    const big = h.a === 1; // hit by a rainbow truck: sent flying
    vehicle.velocity.y += Math.min(big ? 4.5 : 1.5, Math.hypot(h.x, h.z) / m * (big ? 0.35 : 0.15));
    vehicle.angularVelocity.y += (Math.random() - 0.5) * Math.min(big ? 5 : 2, Math.hypot(h.x, h.z) / m * (big ? 0.6 : 0.3));
  };
  net.onHostLeft = (p, next) => {
    const who = next === net.selfId ? t('あなた', 'You') : (net.peers.get(next)?.name ?? '?');
    const text = t(`ホスト（${p.name}）が退出しました。${who}が新しいホストです`, `The host (${p.name}) left. ${who} ${next === net.selfId ? 'are' : 'is'} the new host`);
    lobby.toast(text, 6000);
    chat?.add(null, text);
    games?.hostLost();
  };
  // We took over: the world, weather and moon stay as they are; tell everyone
  // anyway (a newcomer who joined in between has them from nobody).
  net.onBecameHost = () => { shareEnv(); lockHostSettings(); };
  // Someone joins during a race: they get the same course, starting from its start line.
  net.hostRace = () => {
    if (!cannonball.multiRace || !['countdown', 'running'].includes(cannonball.state) || !cannonball.course) return null;
    return { type: 'start', id: raceId, course: cannonball.course, starts: {}, late: true };
  };
  net.onFinish = (peerId, f) => {
    if (f?.race !== raceId || !Number.isFinite(f?.time)) return;
    if (finishTimes.has(peerId)) return;
    finishTimes.set(peerId, f.time);
    const place = finishTimes.size; // order of arrival
    const p = net.peers.get(peerId);
    if (!p) return;
    const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏁';
    const clock = `${Math.floor(f.time / 60)}:${(f.time % 60).toFixed(2).padStart(5, '0')}`;
    const text = t(`${medal} ${p.name} が${place}着でゴール！ ${clock}`, `${medal} ${p.name} finished ${placeName(place)}! ${clock}`);
    lobby.toast(text, place === 1 ? 6000 : 4000);
    chat?.add(null, text);
    sound.chime?.('other-goal');
  };
  const handleRace = (r) => {
    if (r?.type === 'abort') { cannonball.abortedByHost(); lobby.toast(t('ホストがレースを中止しました', 'The host called the race off')); return; }
    if (r?.type !== 'start' || !r.course?.goal) return;
    raceId = r.id;
    finishTimes.clear();
    const mine = r.starts?.[net.selfId] ?? r.course.start;
    cannonball.beginCourse({ ...r.course, start: mine });
    if (r.late) { lobby.toast(t('レースの途中から参加します。スタート地点から出発！', 'Joining the race already under way: off you go from the start!'), 5000); chat?.add(null, t('🏁 走っている最中のレースに途中から参加しました', '🏁 Joined a race already under way')); }
  };
  net.onRace = handleRace;
  cannonball.setMulti({
    active: () => net.active,
    isHost: () => net.isHost,
    startRace(course) {
      // Line everyone up abreast at the start, host in the middle.
      const starts = lineUp(course.start);
      const msg = { type: 'start', id: Math.random().toString(36).slice(2, 10), course, starts };
      net.sendRace(msg);
      handleRace(msg);
    },
    abortRace() { net.sendRace({ type: 'abort' }); },
    finished(time) {
      finishTimes.set(net.selfId, time);
      net.sendFinish({ race: raceId, time });
      const place = finishTimes.size;
      const clock = `${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, '0')}`;
      chat?.add(null, t(`${place === 1 ? '🥇' : '🏁'} ${net.me.name}（自分）が${place}着でゴール！ ${clock}`, `${place === 1 ? '🥇' : '🏁'} ${net.me.name} (you) finished ${placeName(place)}! ${clock}`));
      return place;
    },
    others: () => [...remotes.list.values()].filter((r) => r.root.visible).map((r) => ({ x: r.position.x, z: r.position.z, color: r.info.color })),
    board: () => net.players.map((p) => {
      const goal = cannonball.course?.goal;
      const pos = p.self ? vehicle.position : remotes.list.get(p.id)?.position;
      return { name: p.name, color: p.color, self: p.self, time: finishTimes.get(p.id) ?? null,
        dist: goal && pos ? Math.hypot(goal.x - pos.x, goal.z - pos.z) : null };
    }),
  });
  const lobby = createLobby({
    bar, net,
    onJoined: () => { lockHostSettings(); },
    onLeft: () => { chat?.peersChanged(); remotes.clear(); for (const t of remoteTracks.values()) t.mesh.removeFromParent(); remoteTracks.clear(); for (const g of remoteGlows.values()) g.dispose(); remoteGlows.clear(); lockHostSettings(); if (cannonball.multiRace) cannonball.abortedByHost(); },
  });
  chat = createChat({ bar, net, remotes, vehicle, onOpen: () => keys.clear() });
  games = new Games({
    net, bar, vehicle, truck, remotes, stars, sound, chat, cannonball, ground,
    toast: (text) => lobby.toast(text, 4000),
    camMode: () => camMode,
  });

  // --- worlds -----------------------------------------------------------------
  // A new seed is a whole new land: the terrain and the forests are rebuilt
  // around us (the engines take a new seed while running), and whatever lay
  // on the old ground (a race, a game, stars, ruts) goes.
  const finite = (...v) => v.every(Number.isFinite);
  const setWorld = (seed, start = null, { at = null, id = null, quiet = false } = {}) => {
    if (seed !== world.seed) {
      terrain.setParameters({ seed });
      vegetation.setParameters({ seed: vegetationSeed(seed) });
    }
    start ??= findStart(ground, seed, THREE.Vector3, treeChance);
    world = { seed, start: { x: start.x, z: start.z, heading: start.heading }, id: id ?? Math.random().toString(36).slice(2, 10) };
    if (cannonball.state !== 'idle') cannonball.quit(); // the host's quit calls the race off for everyone
    games?.stop(); // host only (the others hear the end from the host)
    stars.clear();
    minimap.reset();
    screenRain?.clear();
    tracks.clear();
    for (const t of remoteTracks.values()) t.clear();
    const p = at ?? world.start;
    vehicle.place(p.x, p.z, p.heading, ground);
    lastSafe = { x: p.x, z: p.z, heading: p.heading };
    camHeading = p.heading; camReady = false; orbit.yaw = orbit.pitch = 0;
    // The address bar keeps the world, so a reload (or a link) comes back to it.
    const url = new URL(location.href);
    for (const k of ['x', 'z', 'heading']) url.searchParams.delete(k);
    if (seed === HOME_SEED) url.searchParams.delete('seed'); else url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
    worldUI.refresh();
    if (!quiet) padToast(t(`🌍 世界 ${seed}${seed === HOME_SEED ? '（いつもの世界）' : ''}`, `🌍 World ${seed}${seed === HOME_SEED ? ' (the usual one)' : ''}`), 3500);
  };
  // Host (or alone): switch, and bring everyone along to the new start.
  const switchWorld = (seed) => {
    if (net.active && !net.isHost) return;
    setWorld(seed);
    if (net.active) {
      shareEnv(lineUp(world.start));
      chat?.add(null, t(`🌍 世界 ${seed} に切り替えました`, `🌍 Switched to world ${seed}`));
    }
  };
  // Guest: the host's world, from an env message (on joining, or a switch).
  const applyHostWorld = (hw) => {
    const seed = seedOf(hw?.seed);
    if (seed === null || hw.id === world.id) return;
    const start = hw.start && finite(hw.start.x, hw.start.z, hw.start.heading) ? hw.start : null;
    const mine = hw.slots?.[net.selfId];
    const at = mine && finite(mine.x, mine.z, mine.heading) ? mine : null;
    const changed = seed !== world.seed;
    setWorld(seed, start, { at, id: String(hw.id ?? ''), quiet: !changed });
    if (changed && hw.slots) chat?.add(null, t(`🌍 ホストが世界 ${seed} に切り替えました`, `🌍 The host switched to world ${seed}`));
  };
  const randomSeed = () => {
    let s;
    do s = 1 + Math.floor(Math.random() * SEED_MAX); while (s === world.seed || s === HOME_SEED);
    return s;
  };
  worldUI = (() => {
    const button = document.createElement('button');
    button.title = t('世界を変える（地形のシード値）', 'Change the world (terrain seed)');
    bar.insertBefore(button, resetButton);
    const panel = document.createElement('div');
    panel.className = 'cb-panel world-panel';
    panel.hidden = true;
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(panel);
    const render = () => {
      const guest = net.active && !net.isHost;
      const home = world.seed === HOME_SEED;
      panel.innerHTML = `
        <h2>🌍 ${t('世界', 'World')}</h2>
        <p>${t('いまの世界', 'This world')}: <b>${t('シード', 'seed')} ${world.seed}</b>${home ? t('（いつもの世界）', ' (the usual one)') : ''}<br>
        ${t('シード値ごとに、まったく別の土地になります。同じ値なら誰の画面でも同じ地形です。', 'Every seed is a whole different land. The same seed gives the same land on every screen.')}</p>
        ${guest ? t('<p><b>世界はホストが決めます。</b>ホストが切り替えると、みんなスタート地点に並びます。</p>', '<p><b>The host chooses the world.</b> When they switch, everyone lines up at the new start.</p>') : `
        ${net.active ? t('<p><b>あなたがホストです。</b>切り替えると、全員が新しい世界のスタート地点に並びます。</p>', '<p><b>You are the host.</b> Switching lines everyone up at the new world’s start.</p>') : ''}
        ${cannonball.state !== 'idle' || games?.mode ? t('<p>切り替えると、いまのキャノンボールやミニゲームは終わります。</p>', '<p>Switching ends the Cannonball race or mini-game under way.</p>') : ''}
        <div class="cb-row">
          <button data-w="random">${t('ランダムな新しい世界', 'A random new world')}</button>
          <button data-w="home" ${home ? 'disabled' : ''}>${t('いつもの世界へ', 'Back to the usual one')}<small>${HOME_SEED}</small></button>
        </div>
        <div class="cb-row world-seed">
          <input type="text" inputmode="numeric" maxlength="5" placeholder="${t('シード値', 'Seed')} (0–${SEED_MAX})" aria-label="${t('シード値', 'Seed')}">
          <button data-w="seed">${t('この世界へ', 'Go there')}</button>
        </div>
        <p class="world-err" hidden>${t(`0〜${SEED_MAX} の整数を入れてください`, `A whole number from 0 to ${SEED_MAX}, please`)}</p>`}
        <div class="cb-row"><button data-act="close">${t('閉じる', 'Close')}</button></div>`;
      const input = panel.querySelector('input');
      const err = panel.querySelector('.world-err');
      const go = (seed) => { panel.hidden = true; switchWorld(seed); };
      const fromInput = () => {
        const seed = seedOf(input.value);
        if (seed === null) { err.hidden = false; input.focus(); return; }
        go(seed);
      };
      // Typing a seed must not drive the truck, open the chat or send stamps.
      input?.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.isComposing) fromInput();
        if (e.key === 'Escape') panel.hidden = true;
      });
      input?.addEventListener('input', () => { err.hidden = true; });
      for (const b of panel.querySelectorAll('button')) {
        b.addEventListener('click', () => {
          const w = b.dataset.w;
          if (w === 'random') go(randomSeed());
          else if (w === 'home') go(HOME_SEED);
          else if (w === 'seed') fromInput();
          else panel.hidden = true;
        });
      }
    };
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!panel.hidden) { panel.hidden = true; return; }
      render();
      panel.hidden = false;
      if (!coarse) panel.querySelector('input')?.focus();
    });
    return {
      refresh() {
        button.textContent = `${t('世界', 'World')}: ${world.seed}`;
        if (!panel.hidden) render();
      },
      get panel() { return panel; },
    };
  })();
  worldUI.refresh();
  // English / 日本語.
  langButton = document.createElement('button');
  langButton.textContent = LANG === 'en' ? '日本語' : 'English';
  langButton.lang = LANG === 'en' ? 'ja' : 'en';
  langButton.addEventListener('click', (e) => { e.stopPropagation(); setLang(LANG === 'en' ? 'ja' : 'en'); });
  bar.appendChild(langButton);
  net.onPeersChanged();

  // The maps (minimap, the race map, the star radar) sit next to the meter:
  // below it when it is at the top of the screen (phones), above it when it
  // is at the bottom. Measured, not fixed in the CSS: the meter moves with the
  // notch (safe area) and its height changes with the fonts.
  const landscapeTouch = matchMedia('(pointer: coarse) and (min-width: 701px) and (orientation: landscape)');
  // Phone held upright: the meter goes just under the top bar, measured, since
  // the bar's height changes with the notch and the fonts (iPhone).
  const portraitTouch = matchMedia('(pointer: coarse) and (max-width: 700px), (pointer: coarse) and (orientation: portrait)');
  const layoutCorner = () => {
    const meterEl = $('meter');
    const b = bar.getBoundingClientRect();
    meterEl.style.top = portraitTouch.matches && b.height ? `${Math.round(b.bottom + 14)}px` : '';
    const m = meterEl.getBoundingClientRect();
    if (!m.height) return;
    const atTop = m.top < innerHeight / 2;
    const maps = [minimap.canvas, document.querySelector('.cb-map')].filter(Boolean);
    const radar = document.querySelector('.item-radar');
    for (const el of [...maps, radar]) {
      if (!el) continue;
      if (el === radar && radar.classList.contains('above-map')) continue;
      if (atTop) { el.style.top = `${Math.round(m.bottom + 8)}px`; el.style.bottom = 'auto'; }
      else { el.style.bottom = `${Math.round(innerHeight - m.top + 10)}px`; el.style.top = 'auto'; }
    }
    // In a race the radar goes next to the race map: beside it (phone on its
    // side), below it (upright), above it (big screens).
    if (radar?.classList.contains('above-map')) {
      const map = document.querySelector('.cb-map');
      const r = map?.getBoundingClientRect();
      if (!r?.height) return;
      if (landscapeTouch.matches) { radar.style.top = `${Math.round(r.top)}px`; radar.style.bottom = 'auto'; }
      else if (atTop) { radar.style.top = `${Math.round(r.bottom + 8)}px`; radar.style.bottom = 'auto'; }
      else { radar.style.bottom = `${Math.round(innerHeight - r.top + 10)}px`; radar.style.top = 'auto'; }
    }
  };
  addEventListener('resize', layoutCorner);
  new ResizeObserver(layoutCorner).observe(bar); // ☰ opened or closed
  setInterval(layoutCorner, 500); // also catches the radar changing place when a race starts or ends
  setTimeout(layoutCorner, 0);

  if (config?.credit) $('credit').textContent = `${t('車', 'Truck')}: ${config.credit}`;
  window.drive = { bushShake: () => shakeList.map((k) => +k.energy.toFixed(2)), rain: rainFx, screenRain, wash: () => washButton.click(), dirt: dirt.state, minimap, setWorld: switchWorld, get world() { return world; }, vehicle, truck, orbit, ground, sound, cannonball, bgm, tracks, moon, net, remotes, chat, stars, get games() { return games; } };
  $('meter').hidden = false;
  $('help').hidden = query.get('help') === '0';
  showCredit();
  $('loading').classList.add('done');

  // --- per frame (called by createWorld before the engines update)
  const camPos = new THREE.Vector3();
  let camHeading = vehicle.heading, camReady = false;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ'), qv = new THREE.Quaternion();
  const meter = { speed: $('speed'), rpm: $('rpmFill'), gear: $('gear'), range: $('range'), t: 0 };
  const wind = new THREE.Vector3();
  const rainLight = new THREE.Color(), rainCam = new THREE.Vector3();
  const cuts = [], cutAt = new THREE.Vector3(), cutRight = new THREE.Vector3();

  // Driving through water: a bow wave off the front corners, and a big
  // splash when we hit the water fast (a river crossing, a lake).
  const wading = { depth: 0 }, remoteWading = new Map();
  const wadeP = new THREE.Vector3(), wadeV = new THREE.Vector3();
  function wade(v, dt, st) {
    const speed = Math.abs(v.speed);
    wadeP.set(0, 0, -v.spec.size[2] / 2 * Math.sign(v.speed || 1)).applyQuaternion(v.quaternion).add(v.position);
    const surface = ground.water(wadeP.x, wadeP.z);
    const bottom = v.position.y - 0.9;
    const depth = Math.max(0, Math.min(1.6, surface - bottom)); // how deep the front is in the water
    // In it, fast, from dry: one big splash.
    if (depth > 0.15 && st.depth <= 0.05 && speed > 4) {
      const n = Math.min(90, 20 + speed * 4);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const up = 3 + Math.random() * (3 + speed * 0.45);
        wadeV.set(Math.sin(a) * (1.5 + Math.random() * 3), up, Math.cos(a) * (1.5 + Math.random() * 3)).addScaledVector(v.velocity, 0.3);
        dust.emit(tmp.set(wadeP.x + Math.sin(a) * 1.4, surface + 0.1, wadeP.z + Math.cos(a) * 1.4), wadeV, 1.0 + Math.random() * 1.2, 1.4 + Math.random() * 0.7, 0.92, 0.94, 0.96, 6);
      }
    }
    st.depth = depth;
    if (depth < 0.08 || speed < 1.5) return;
    // The bow wave: white water peeling off both front corners.
    const right = wadeV.set(1, 0, 0).applyQuaternion(v.quaternion);
    let n = Math.min(1, depth / 0.6) * speed * 2.2 * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const out = side * (1.5 + Math.random() * 2) * Math.min(1, speed / 6);
      tmp.set(wadeP.x + right.x * side * 1.0, surface + 0.05, wadeP.z + right.z * side * 1.0);
      tmp2.copy(v.velocity).multiplyScalar(0.55);
      tmp2.x += right.x * out; tmp2.z += right.z * out; tmp2.y = 1 + Math.random() * (0.6 + speed * 0.12);
      dust.emit(tmp, tmp2, 0.5 + Math.random() * 0.6, 0.8 + Math.random() * 0.4, 0.9, 0.93, 0.95, 5);
    }
  }

  // Bushes have no hard edge: the truck pushes through (the shader parts them
  // round it), a little slower, rustling, with leaves flying, and the bushes
  // it went through sway for a moment after (any truck: ours or another's).
  const bushAt = new THREE.Vector3(), bushRight = new THREE.Vector3(), leafP = new THREE.Vector3(), leafV = new THREE.Vector3();
  const shaking = new Map(); // "x,z" -> { x, z, energy, angle }
  // Bushes touching a truck at pos/quat: visit(bush, how deep 0..1).
  function touchBushes(pos, quat, bottomY, visit) {
    const c = bushAt.set((bodyBox.min.x + bodyBox.max.x) / 2, 0, (bodyBox.min.z + bodyBox.max.z) / 2).applyQuaternion(quat).add(pos);
    const r = bushRight.set(1, 0, 0).applyQuaternion(quat);
    const rl = Math.hypot(r.x, r.z) || 1;
    const rx = r.x / rl, rz = r.z / rl, fx = rz, fz = -rx;
    const hw = (bodyBox.max.x - bodyBox.min.x) / 2, hl = (bodyBox.max.z - bodyBox.min.z) / 2;
    vegetation.forEachBushNear(c.x, c.z, hl + 3.5, (bx, by, bz, br) => {
      if (bottomY > by + br * 1.6) return; // flying over it
      const dx = bx - c.x, dz = bz - c.z;
      const a = Math.abs(dx * rx + dz * rz) - hw, b = Math.abs(dx * fx + dz * fz) - hl;
      const outside = Math.hypot(Math.max(a, 0), Math.max(b, 0));
      const deep = Math.min(1, (br * 0.85 - outside) / Math.max(0.3, br * 0.85));
      if (deep > 0) visit(bx, by, bz, br, deep);
    });
  }
  // Set a bush swaying (or keep it going) as a truck moving at `vel` pushes it.
  function shakeBush(bx, bz, deep, vel) {
    const speed = Math.hypot(vel.x, vel.z);
    if (speed < 0.5) return;
    const key = `${Math.round(bx * 10)},${Math.round(bz * 10)}`;
    const e = Math.min(1, deep * (0.35 + speed / 7));
    const k = shaking.get(key);
    const angle = Math.atan2(vel.z, vel.x);
    if (k) { k.energy = Math.max(k.energy, e); k.angle = angle; }
    else shaking.set(key, { x: bx, z: bz, energy: e, angle });
  }
  const shakeList = [];
  function updateBushShake(dt) {
    shakeList.length = 0;
    for (const [key, k] of shaking) {
      k.energy *= Math.exp(-dt * 1.8); // dies away in a second or two
      if (k.energy < 0.02) shaking.delete(key); else shakeList.push(k);
    }
    shakeList.sort((a, b) => b.energy - a.energy);
    vegetation.setBushShake(shakeList.slice(0, 16));
  }
  function brushThroughBushes(dt) {
    const p = vehicle.position;
    let push = 0, hit = null;
    touchBushes(p, vehicle.quaternion, p.y + vehicle.spec.bodyBottom, (bx, by, bz, br, deep) => {
      shakeBush(bx, bz, deep, vehicle.velocity);
      if (deep > push) { push = deep; hit = { x: bx, y: by, z: bz, r: br }; }
    });
    const ground0 = hit ? ground.height(hit.x, hit.z) : 0;
    const speed = Math.abs(vehicle.speed);
    // A gentle drag (never a wall): about 1/4 of the speed per second deep in it.
    if (push > 0 && !vehicle.armor) {
      const k = Math.max(0, 1 - dt * 0.28 * push);
      vehicle.velocity.x *= k; vehicle.velocity.z *= k;
    }
    sound.rustle(push * Math.min(1, speed / 6));
    // Leaves and bits of twig, thrown up where the truck meets the bush.
    if (hit && speed > 0.8) {
      let n = push * speed * 9 * dt;
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * hit.r;
        leafP.set(hit.x + Math.cos(a) * rr, Math.max(ground0, hit.y) + 0.3 + Math.random() * hit.r * 1.2, hit.z + Math.sin(a) * rr);
        leafV.copy(vehicle.velocity).multiplyScalar(0.35);
        leafV.x += (Math.random() - 0.5) * 3; leafV.z += (Math.random() - 0.5) * 3; leafV.y += 1 + Math.random() * 2.5;
        const green = Math.random() < 0.75, sh = 0.7 + Math.random() * 0.4;
        if (green) dust.emit(leafP, leafV, 0.16 + Math.random() * 0.16, 1.4 + Math.random(), 0.2 * sh, 0.32 * sh, 0.1 * sh, 3);
        else dust.emit(leafP, leafV, 0.08 + Math.random() * 0.1, 1.2, 0.38 * sh, 0.28 * sh, 0.16 * sh, 6);
      }
    }
    vehicle.inBush = push;
  }

  function frame(dt) {
    if (!vehicle) return;
    // Input: keyboard (ramped), touch, gamepad.
    const k = (...c) => c.some((x) => keys.has(x));
    let steerKey = (k('KeyD', 'ArrowRight') || touch.right ? 1 : 0) - (k('KeyA', 'ArrowLeft') || touch.left ? 1 : 0);
    const gas = k('KeyW', 'ArrowUp') || touch.gas ? 1 : 0;
    const brk = k('KeyS', 'ArrowDown') || touch.brake ? 1 : 0;
    const ramp = (cur, target, up, down) => {
      const rate = Math.abs(target) > Math.abs(cur) && Math.sign(target) === Math.sign(cur || target) ? up : down;
      const d = target - cur;
      return cur + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    };
    input.steer = ramp(input.steer, steerKey, 2.8, 4.5);
    input.throttle = ramp(input.throttle, gas, 3, 6);
    input.brake = ramp(input.brake, brk, 4, 8);
    const gp = readPad();
    const vi = vehicle.input;
    vi.steer = gp && Math.abs(gp.steer) > Math.abs(input.steer) ? gp.steer : input.steer;
    vi.throttle = Math.max(input.throttle, gp?.throttle ?? 0);
    vi.brake = Math.max(input.brake, gp?.brake ?? 0);
    vi.handbrake = k('Space') || touch.hand || (gp?.handbrake ?? false);
    if (cannonball?.locked) { vi.throttle = 0; vi.brake = 0; }

    vehicle.update(dt, ground);
    brushThroughBushes(dt);

    // Remember the last place on dry land, for R after a swim.
    safeTimer += dt;
    if (safeTimer > 1.5) {
      safeTimer = 0;
      const p = vehicle.position;
      if (vehicle.submerged === 0 && vehicle.wheels.every((x) => x.contact) && Math.abs(vehicle.speed) < 25) lastSafe = { x: p.x, z: p.z, heading: vehicle.heading };
    }

    // Picture.
    truck.root.position.copy(vehicle.position);
    truck.root.quaternion.copy(vehicle.quaternion);
    poseWheels(truck, vehicle);
    // With a steering-wheel controller the wheel on screen follows the one in
    // your hands, degree for degree (WHEEL_RANGE lock to lock, 900 by default).
    if (gp?.wheel && truck.steering && Math.abs(vi.steer - gp.steer) < 1e-6) setSteeringWheelAngle(truck.steering, -gp.steer * (WHEEL_RANGE / 2) * Math.PI / 180);

    // Contact shadow on the ground under the truck.
    {
      const p = vehicle.position;
      const gh = ground.height(p.x, p.z);
      const above = p.y - gh;
      ground.normal(p.x, p.z, nrm);
      contactShadow.position.set(p.x, gh, p.z);
      contactShadow.quaternion.setFromUnitVectors(tmp.set(0, 1, 0), nrm);
      contactShadow.quaternion.multiply(qv.setFromAxisAngle(tmp.set(0, 1, 0), vehicle.heading));
      const day = THREE.MathUtils.clamp(environment.sunDirection.y * 6 + 0.3, 0.15, 1);
      contactShadow.material.uniforms.uOpacity.value = 0.55 * day * THREE.MathUtils.clamp(1.6 - above / 1.2, 0, 1);
      contactShadow.visible = gh > ground.water(p.x, p.z) - 0.3;
    }

    // Headlights after dusk.
    const dark = THREE.MathUtils.clamp((0.06 - environment.sunDirection.y) / 0.12, 0, 1);
    for (const l of lights) { l.intensity = dark * 1800; l.visible = dark > 0; } // candela

    // Rear lamps: brake (red), reversing (white), tail lamps with the headlights.
    // Hill hold (no pedal) does not count as braking. A bulb takes a moment.
    const lampTarget = vehicleLamps(vehicle);
    const lampK = Math.min(1, dt * 25);
    lamp.brake += ((lampTarget & 1 ? 1 : 0) - lamp.brake) * lampK;
    lamp.reverse += ((lampTarget & 2 ? 1 : 0) - lamp.reverse) * lampK;
    lamp.tail = dark;
    lamp.gain = 1 - 0.25 * dark;
    setLamps(truck.root, lamp);
    placeGlow(glow, vehicle.position, vehicle.quaternion, lamp, dark);
    vegetation.setGrassLamp(glowAt, glowBack, glowColor);

    // Dust and spray from the wheels.
    const wv = environment.windVector ?? wind;
    wind.set(wv.x ?? 0, 0, wv.z ?? 0);
    const sunE = atmosphere.sunLight ? atmosphere.sunLight.intensity * Math.max(0, environment.sunDirection.y) : 1;
    const skyE = atmosphere.skyLight ? atmosphere.skyLight.intensity : 0.3;
    dust.material.uniforms.uLight.value.setRGB(1, 1, 1).multiplyScalar((0.5 * sunE + skyE) / Math.PI); // like a Lambert surface
    const rain = Math.min(1, environment.precipitation * 1.5);
    const kickDust = (vehicle) => vehicle.wheels.forEach((wh) => {
      if (!wh.contact) return;
      const v = Math.abs(vehicle.speed);
      tmp.set(wh.local.x, wh.local.y - wh.length - vehicle.spec.wheelRadius * 0.8, wh.local.z).applyQuaternion(vehicle.quaternion).add(vehicle.position);
      const water = ground.water(tmp.x, tmp.z);
      const wet = water > tmp.y - 0.1;
      const surf = wh.surface;
      const muddy = wet ? 0 : mudAt(surf, ground.height(tmp.x, tmp.z) - water, rain);
      // Mud: dark clumps flung up and back off the tread, falling fast.
      if (muddy > 0.2) {
        let m = muddy * (Math.max(0, v - 1.5) * 0.9 + wh.slip * 30) * dt;
        while (m > 0) {
          if (m < 1 && Math.random() > m) break;
          m -= 1;
          tmp2.copy(vehicle.velocity).multiplyScalar(0.25);
          tmp2.x += (Math.random() - 0.5) * 2.5; tmp2.z += (Math.random() - 0.5) * 2.5; tmp2.y += 1.5 + Math.random() * 2.5;
          const shade = 0.75 + Math.random() * 0.3;
          dust.emit(tmp, tmp2, 0.18 + Math.random() * 0.22, 0.9, 0.27 * shade, 0.2 * shade, 0.13 * shade, 14);
        }
      }
      const dustiness = wet ? 1.2 : surf === 2 ? 1 : surf === 0 ? 0.55 * (1 - muddy) : surf === 3 ? 0.8 : 0.12;
      const rate = dustiness * (Math.max(0, v - 2) * 0.5 + wh.slip * 25) * (1 - 0.8 * Math.min(1, environment.precipitation * 2) * (wet ? 0 : 1));
      let n = rate * dt;
      while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        tmp2.copy(vehicle.velocity).multiplyScalar(wet ? 0.35 : 0.15);
        tmp2.x += (Math.random() - 0.5) * 2; tmp2.z += (Math.random() - 0.5) * 2; tmp2.y += wet ? 1.5 + Math.random() * 2 : 0.4 + Math.random() * 0.8;
        if (wet) dust.emit(tmp, tmp2, 0.6 + Math.random() * 0.5, 0.9, 0.9, 0.93, 0.95);
        else if (surf === 3) dust.emit(tmp, tmp2, 0.9 + Math.random(), 1.6, 0.92, 0.93, 0.96);
        else if (surf === 2) dust.emit(tmp, tmp2, 1.0 + Math.random() * 1.2, 2.6, 0.72, 0.62, 0.45);
        else dust.emit(tmp, tmp2, 0.9 + Math.random() * 1.2, 2.2, 0.48, 0.41, 0.31);
      }
    });
    kickDust(vehicle);
    wade(vehicle, dt, wading);
    dirt.state.update(dt, vehicle, ground, rain);
    if (washing > 0) {
      const d = dirt.state;
      d.mud = Math.max(0, d.mud - dt * 0.9); d.dust = Math.max(0, d.dust - dt * 0.9); d.snow = Math.max(0, d.snow - dt * 0.9);
      d.wet = 1;
      // Water raining down over the body.
      const half = vehicle.spec.size;
      for (let i = 0; i < 12; i++) {
        tmp.set((Math.random() - 0.5) * half[0] * 1.1, 1.3 + Math.random() * 0.6, (Math.random() - 0.5) * half[2]).applyQuaternion(vehicle.quaternion).add(vehicle.position);
        tmp2.set((Math.random() - 0.5) * 0.6, -5 - Math.random() * 3, (Math.random() - 0.5) * 0.6).add(vehicle.velocity);
        dust.emit(tmp, tmp2, 0.1 + Math.random() * 0.12, 0.35 + Math.random() * 0.15, 0.85, 0.92, 1, 25);
      }
      washing -= dt;
      if (washing <= 0) { d.clean(); d.wet = 1; screenRain?.clear(); sound.chime?.('star'); padToast(t('✨ ピカピカになりました！', '✨ Spotless!'), 3000); }
    }
    dirt.update(truck.root);
    // Other players: interpolate, pose, and give them dust and tracks too.
    if (remotes) {
      remotes.update(dt, camera, renderer);
      chat?.update(camera, renderer);
      sound.updateRemotes(remotes.list.values(), camera, underwater.depth, ground.water);
      for (const r of remotes.list.values()) {
        if (!r.root.visible) continue;
        const rl = { brake: r.lamps & 1 ? 1 : 0, reverse: r.lamps & 2 ? 1 : 0, tail: dark, gain: lamp.gain };
        setLamps(r.root, rl);
        rainbowGlow(r.root, !!(r.lamps & 4), performance.now() / 1000);
        let rg = remoteGlows.get(r.id);
        if (!rg) { rg = new LampGlow(); scene.add(rg.mesh); remoteGlows.set(r.id, rg); }
        placeGlow(rg, r.position, r.quaternion, rl, dark);
        kickDust(r);
        let rw = remoteWading.get(r.id);
        if (!rw) remoteWading.set(r.id, (rw = { depth: 0 }));
        wade(r, dt, rw);
        touchBushes(r.position, r.quaternion, r.position.y + vehicle.spec.bodyBottom, (bx, by, bz, br, deep) => shakeBush(bx, bz, deep, r.velocity));
        const rd = remoteDirt.get(r.root);
        if (rd) { rd.state.follow(r.dirtBits, dt); rd.update(r.root); }
        let t = remoteTracks.get(r.id);
        if (!t) { t = new TireTracks(3000); scene.add(t.mesh); remoteTracks.set(r.id, t); }
        t.update(dt, r, ground, Math.min(1, environment.precipitation * 1.5));
      }
    }
    // Keep the grass out of the trucks (it is pressed down under them).
    {
      cuts.length = 0;
      const cut = (pos, quat) => {
        const c = cutAt.set((bodyBox.min.x + bodyBox.max.x) / 2, 0, (bodyBox.min.z + bodyBox.max.z) / 2).applyQuaternion(quat).add(pos);
        const r = cutRight.set(1, 0, 0).applyQuaternion(quat);
        const len = Math.hypot(r.x, r.z) || 1;
        cuts.push({
          x: c.x, z: c.z, rightX: r.x / len, rightZ: r.z / len,
          halfWidth: (bodyBox.max.x - bodyBox.min.x) / 2, halfLength: (bodyBox.max.z - bodyBox.min.z) / 2,
          clearance: pos.y + vehicle.spec.bodyBottom - ground.height(c.x, c.z),
          top: pos.y + bodyBox.max.y - ground.height(c.x, c.z),
        });
      };
      cut(vehicle.position, vehicle.quaternion);
      if (remotes) for (const r of remotes.list.values()) if (r.root.visible && cuts.length < 8) cut(r.position, r.quaternion);
      vegetation.setGrassCutouts(cuts);
      updateBushShake(dt);
    }
    dust.update(dt, wind, camera, renderer);
    moon.update(environment, camera);
    moonButton.hidden = moon.night < 0.2;
    tracks.update(dt, vehicle, ground, Math.min(1, environment.precipitation * 1.5));

    // Paint reflection.
    reflection.update(dt, atmosphere, environment);
    if (reflection.texture) for (const m of truckMaterials) {
      if (m.envMap !== reflection.texture) { m.envMap = reflection.texture; m.envMapIntensity = m.metalness > 0.5 ? 0.9 : 0.55; m.needsUpdate = true; }
    }

    updateCamera(dt);

    // Rain (after the camera has moved: the streaks are placed round it).
    {
      const light = rainLight.setRGB(0.8, 0.85, 0.9).multiplyScalar(Math.max(0.03, (0.5 * sunE + skyE) / Math.PI));
      camera.getWorldPosition(rainCam);
      rainFx.update({
        dt, amount: rain, camera: rainCam, wind, light,
        viewer: vehicle.velocity, // every view moves with the truck: the rain comes at us as we drive
        water: ground.water(rainCam.x, rainCam.z), truck: truck.root,
        lamps: lights, lampOn: dark * 9, hidden: underwater.depth > 0,
      });
      if (vehicle.submerged > 0.4) screenRain?.clear();
      const onCar = vehicle.submerged > 0.1 ? 0 : rain;
      screenRain?.update(dt, onCar, vehicle.speed, Math.min(1, skyE * 1.2 + sunE * 0.05));
      sound.rainOnCar(onCar, camMode >= 2, !!screenRain?.wiping);
    }
    cannonball?.update(dt, camera);
    // The minimap, except in a race (the race has its own map there).
    minimap.update(['countdown', 'running'].includes(cannonball.state));
    stars.minimapShown = minimap.visible;
    stars.update(dt, camera);
    games?.update(dt, camera); // after the stars: 鬼's extra power goes on top
    // From the driver's seat or the bonnet the camera sits inside the halo: leave it out.
    rainbowGlow(truck.root, vehicle.armor, performance.now() / 1000, camMode < 2);
    sound.update(vehicle, underwater.depth);
    bgm.setUnderwater(TruckSound.underwater(vehicle.submerged, underwater.depth));
    // Afloat for too long: warn, stall, start again on land.
    if (vehicle.engineOn !== engineWas.on) {
      padToast(vehicle.engineOn ? t('エンジンがかかった', 'The engine started') : t('エンジンが水を吸って止まった… 岸に着けば乾いてかかる（R で起こす）', 'Water got in and the engine died… it dries out and starts again on land (R to reset)'), 5000);
      engineWas.on = vehicle.engineOn;
    }
    const warn = vehicle.engineOn && vehicle.flood > 0.6;
    if (warn && !engineWas.warned) padToast(t('エンジンがせき込んでいる。早く岸へ！', 'The engine is coughing. Get to the shore!'), 4000);
    engineWas.warned = vehicle.flood > 0.6 ? true : vehicle.flood < 0.3 ? false : engineWas.warned;

    meter.t -= dt;
    if (meter.t <= 0) {
      meter.t = 0.08;
      meter.speed.textContent = Math.round(Math.abs(vehicle.speed) * 3.6);
      meter.rpm.style.width = `${Math.min(100, (vehicle.rpm / vehicle.spec.redline) * 100)}%`;
      meter.gear.textContent = vehicle.gearLabel;
      meter.range.textContent = vehicle.low ? '4L' : '4H';
      meter.range.classList.toggle('low', vehicle.low);
    }
  }

  function updateCamera(dt) {
    if (!orbit.dragging) orbit.idle += dt;
    if (orbit.idle > 2.5 && camMode < 2) {
      // Swing back behind the truck after looking around.
      orbit.yaw *= Math.exp(-dt * 2);
      orbit.pitch *= Math.exp(-dt * 2);
    }
    const p = vehicle.position;
    const q = vehicle.quaternion;
    if (camMode >= 2) {
      // Inside: driver's eye or on the bonnet, fixed to the body.
      const eye = camMode === 2
        ? (config?.driverEye ?? [-0.38, 0.62, -0.05])
        : (config?.hoodEye ?? [0, 0.62, -1.3]);
      rig.position.set(...eye).applyQuaternion(q).add(p);
      // A head, not a camera bolted to the body: it keeps the horizon fairly
      // level (only part of the body's roll and pitch comes through) and soaks
      // up the small jolts. Heading follows the truck exactly.
      headEul.setFromQuaternion(q, 'YXZ');
      headEul.set(headEul.x * HEAD_PITCH, headEul.y, headEul.z * HEAD_ROLL, 'YXZ');
      headTarget.setFromEuler(headEul);
      if (!headReady) { head.copy(headTarget); headReady = true; }
      else head.slerp(headTarget, 1 - Math.exp(-dt * 14));
      // Keep the heading exact (no lag turning), only roll and pitch are eased.
      headEul.setFromQuaternion(head, 'YXZ');
      headEul.y = bodyEul.setFromQuaternion(q, 'YXZ').y;
      head.setFromEuler(headEul);
      eul.set(-orbit.pitch * 0.8 - 0.04, orbit.yaw, 0); // up/down inverted like the outside views (user's preference)
      camera.quaternion.copy(head).multiply(qv.setFromEuler(eul));
      camera.near = 0.05;
      camera.updateProjectionMatrix();
      camReady = false;
      return;
    }
    headReady = false; // outside: the head starts afresh when we go back in
    camera.near = 0.3;
    const far = camMode === 1;
    const dist = (far ? 12 : 6.8) * orbit.zoom;
    const height = (far ? 4.2 : 2.2) * Math.sqrt(orbit.zoom);
    // Follow the direction of travel when reversing fast? No: keep behind the body, smoothly.
    const target = vehicle.heading;
    let d = target - camHeading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    camHeading += d * (1 - Math.exp(-dt * 3.5));
    const h = camHeading + orbit.yaw;
    const pitch = orbit.pitch;
    const horiz = Math.cos(pitch) * dist;
    const want = tmp.set(p.x + Math.sin(h) * horiz, p.y + height + Math.sin(pitch) * dist, p.z + Math.cos(h) * horiz);
    if (!camReady) { camPos.copy(want); camReady = true; }
    camPos.lerp(want, 1 - Math.exp(-dt * 10));
    // Stay above the ground and the water.
    const floor = Math.max(ground.height(camPos.x, camPos.z), ground.water(camPos.x, camPos.z) - 50) + 0.7;
    if (camPos.y < floor) camPos.y = floor;
    rig.position.copy(camPos);
    rig.updateMatrixWorld();
    camera.lookAt(tmp2.set(p.x, p.y + 0.9, p.z));
  }
}
