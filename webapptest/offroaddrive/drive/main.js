// Offroad drive: a 4WD pickup in the Procedural World.
import * as THREE from 'three';
import { createWorld } from '../examples/shared/createWorld.js';
import { Vehicle } from './vehicle.js';
import { makeGround } from './ground.js';
import { loadTruck, poseWheels } from './truckModel.js';
import { TruckSound } from './truckSound.js';
import { Dust, SkyReflection, makeContactShadow, TireTracks } from './effects.js';
import { Cannonball } from './cannonball.js';
import { MetalBGM } from './music/metal.js';
import { Moon } from './moon.js';
import { Multiplayer } from './net/multiplayer.js';
import { RemoteTrucks, packState } from './net/remotes.js';
import { createLobby } from './net/lobby.js';

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
const START = { x: num('x', -5400), z: num('z', 7960), heading: num('heading', 2.2) };

function fail(err) {
  console.error(err);
  const el = $('error');
  el.textContent = `起動に失敗しました:\n${err?.message ?? err}`;
  el.style.display = 'grid';
}

try {
  await main();
} catch (err) {
  fail(err);
}

async function main() {
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
    start: { x: START.x, z: START.z },
    params: {
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
  const touch = { left: false, right: false, gas: false, brake: false };
  const input = { steer: 0, throttle: 0, brake: 0 };
  let camMode = query.has('cam') ? Number(query.get('cam')) : 0;
  const CAMS = ['追従', '遠め', '運転席', 'ボンネット'];
  const orbit = { yaw: 0, pitch: 0, idle: 0, dragging: false, x: 0, y: 0, zoom: 1 };

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
      if (e.code === 'KeyH') $('help').hidden = !$('help').hidden;
      if (e.code === 'KeyM') toggleSound();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const dom = renderer.domElement;
  dom.style.touchAction = 'none';
  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture(e.pointerId);
    orbit.dragging = true; orbit.x = e.clientX; orbit.y = e.clientY;
  });
  dom.addEventListener('pointermove', (e) => {
    if (!orbit.dragging) return;
    orbit.yaw -= (e.clientX - orbit.x) * 0.006;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch - (e.clientY - orbit.y) * 0.004, -0.5, 1.0);
    orbit.x = e.clientX; orbit.y = e.clientY; orbit.idle = 0;
  });
  const endDrag = () => { orbit.dragging = false; };
  dom.addEventListener('pointerup', endDrag);
  dom.addEventListener('pointercancel', endDrag);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * Math.exp(e.deltaY * 0.001), 0.5, 3);
  }, { passive: false });

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
    padToast(`🎮 コントローラーを認識しました: ${g.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'gamepad'}（${g.mapping || '独自配置'}）`);
  });
  window.addEventListener('gamepaddisconnected', () => padToast('🎮 コントローラーが外れました'));
  const RAW_DS = { cross: 1, circle: 2, square: 0, triangle: 3, l1: 4, r1: 5, share: 8, options: 9 }; // DualShock raw (macOS)
  const STD = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, share: 8, options: 9 };
  // Every connected pad is read and their inputs combined (this Mac, for one,
  // has a USB pad and a DualShock 4 at the same time); each keeps its own
  // button history so a press on one is never lost to the other.
  const readOne = (gp) => {
    const standard = gp.mapping === 'standard';
    const sony = /054c|sony|wireless controller|dualshock|dualsense/i.test(gp.id);
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
    const rx = gp.axes[2] ?? 0, ry = (standard || !sony ? gp.axes[3] : gp.axes[5]) ?? 0;
    return { steer: gp.axes[0] ?? 0, throttle, brake, handbrake: btn(M.cross) > 0.5 || btn(M.circle) > 0.5, rx, ry, actions };
  };
  const readPad = () => {
    if (query.get('pad') === '0') return null; // tests: ignore real controllers
    const list = [...(navigator.getGamepads?.() ?? [])].filter((g) => g && g.connected);
    if (!list.length) return null;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const out = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    let rx = 0, ry = 0;
    for (const gp of list) {
      const r = readOne(gp);
      if (Math.abs(dz(r.steer)) > Math.abs(out.steer)) out.steer = dz(r.steer);
      out.throttle = Math.max(out.throttle, r.throttle);
      out.brake = Math.max(out.brake, r.brake);
      out.handbrake ||= r.handbrake;
      if (Math.abs(r.rx) > Math.abs(rx)) rx = r.rx;
      if (Math.abs(r.ry) > Math.abs(ry)) ry = r.ry;
      if (r.actions.cam) nextCam();
      if (r.actions.low) toggleLow();
      if (r.actions.reset) resetTruck();
      if (r.actions.help) $('help').hidden = !$('help').hidden;
    }
    if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) {
      orbit.yaw -= dz(rx) * 0.05; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch - dz(ry) * 0.03, -0.5, 1); orbit.idle = 0;
    }
    if (query.get('pad') === '1') {
      const t = list.map((gp) => `[${gp.index}] ${gp.id} | ${gp.mapping || 'raw'} | axes ${gp.axes.map((a) => a.toFixed(2)).join(' ')} | buttons ${gp.buttons.map((b, i) => (b.pressed || b.value > 0.05 ? i : null)).filter((x) => x !== null).join(',')}`).join('\n');
      if (t !== pad.shown) { pad.shown = t; padToast(t, 600000); }
    }
    return out;
  };

  // --- top bar
  const bar = $('bar');
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
  sceneButtons = buttons([['morning', '朝'], ['noon', '昼'], ['golden', '夕方'], ['rain', '雨'], ['night', '夜']], firstScene, (n) => setScene(n));
  buttons([['high', 'high'], ['medium', 'medium'], ['low', 'low']], w.quality, (q) => w.setQuality(q));
  // Tonight's moon (random; a new moon is as dark as no moon at all). Click for another.
  const moonButton = document.createElement('button');
  const updateMoonButton = () => { moonButton.textContent = `${moon.phase.icon} ${moon.phase.name}`; };
  moonButton.title = '月を変える';
  moonButton.addEventListener('click', (e) => { e.stopPropagation(); moon.randomize(); updateMoonButton(); shareEnv(); });
  updateMoonButton();
  bar.appendChild(moonButton);
  const camButton = document.createElement('button');
  const updateCamButton = () => { camButton.textContent = `視点: ${CAMS[camMode]}`; };
  camButton.addEventListener('click', nextCam);
  updateCamButton();
  bar.appendChild(camButton);
  const soundButton = document.createElement('button');
  soundButton.textContent = '音';
  soundButton.setAttribute('aria-pressed', String(soundOn));
  soundButton.addEventListener('click', (e) => { e.stopPropagation(); toggleSound(); });
  bar.appendChild(soundButton);
  // BGM: original heavy metal, synthesised (music/).
  const bgm = new MetalBGM();
  bgm.volume = 0.45;
  const bgmButton = document.createElement('button');
  const nextButton = document.createElement('button');
  nextButton.textContent = '⏭';
  nextButton.title = '次の曲 (N)';
  nextButton.hidden = true;
  bgm.onchange = (song) => {
    bgmButton.textContent = song ? `♪ ${song.title}` : 'BGM';
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
  resetButton.textContent = '起こす (R)';
  resetButton.addEventListener('click', resetTruck);
  bar.appendChild(resetButton);

  const cannonball = new Cannonball({
    ground, vehicle, scene, camera, sound, bar,
    brightness: () => atmosphere.skyLight?.intensity ?? 1,
    place: (x, z, heading) => { vehicle.place(x, z, heading, ground); camHeading = heading; camReady = false; orbit.yaw = orbit.pitch = 0; },
  });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyG' && !e.repeat) cannonball.showMenu(cannonball.state === 'running' || cannonball.state === 'countdown'); });
  // --- multiplayer ---------------------------------------------------------
  const net = new Multiplayer();
  const remoteTracks = new Map();
  // Send our state on a timer rather than per frame: it keeps going (slower)
  // when this window is in the background and the frame loop pauses.
  setInterval(() => { if (net.active) net.sendState(packState(vehicle)); }, 1000 / 15);
  const finishTimes = new Map();
  let raceId = '';
  remotes = new RemoteTrucks(scene, truck, vehicle, (root, color) => {
    // Each player's truck gets its own materials, tinted towards their colour.
    const tint = new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.55);
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
  });
  const shareEnv = () => { if (net.active && net.isHost) net.sendEnv({ scene: currentScene, moon: moon.getState() }); };
  const lockHostSettings = () => {
    const guest = net.active && !net.isHost;
    for (const b of [...sceneButtons.els, moonButton]) {
      b.disabled = guest;
      b.title = guest ? 'ホストが決めます' : '';
    }
  };
  net.hostEnv = () => ({ scene: currentScene, moon: moon.getState() });
  net.hostSpot = () => {
    // Newcomers appear beside the host.
    const h = vehicle.heading;
    const off = 5 + Math.random() * 4;
    return { x: vehicle.position.x + Math.cos(h) * off, z: vehicle.position.z - Math.sin(h) * off, heading: h };
  };
  net.onEnv = (e) => {
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
      }
    }
    for (const [id, info] of net.peers) remotes.list.get(id)?.setInfo(info);
    lockHostSettings();
    lobby.render();
  };
  // Collisions between players: whoever detects the hit sends the other their share.
  const lastHit = new Map(); // peerId -> time we last resolved a hit with them
  const pendingHit = new Map();
  const lastSent = new Map();
  vehicle.onCarHit = (id, imp, strength) => {
    const now = performance.now() / 1000;
    lastHit.set(id, now);
    // One impulse per collision: the physics touches them every step while
    // the bodies overlap, but they only need the first, strongest contact.
    if (now - (lastSent.get(id) ?? -1) < 0.3 && !pendingHit.has(id)) return;
    const p = pendingHit.get(id);
    if (!p || strength > p.s) pendingHit.set(id, { x: imp.x, z: imp.z, s: strength });
    lastSent.set(id, now);
  };
  setInterval(() => { // batch the impulses of one collision into one message
    for (const [id, p] of pendingHit) net.sendHit(id, { x: Math.round(p.x), z: Math.round(p.z), s: Math.round(p.s * 100) / 100 });
    pendingHit.clear();
  }, 50);
  net.onHit = (peerId, h) => {
    const now = performance.now() / 1000;
    vehicle.fx.crash = Math.max(vehicle.fx.crash, h.s || 0);
    sound.crash?.(Math.min(1, (h.s || 0) / 9));
    if (now - (lastHit.get(peerId) ?? -1) < 0.3) return; // we already took our share
    const m = vehicle.spec.mass;
    // Equal trucks: at most ~65 % of the closing speed carries over to the one that was hit.
    const dv = Math.hypot(h.x, h.z) / m;
    const k = dv > 0 ? Math.min(1, (0.65 * (h.s || 0)) / dv) : 0;
    vehicle.velocity.x += (h.x / m) * k;
    vehicle.velocity.z += (h.z / m) * k;
    vehicle.velocity.y += Math.min(1.5, Math.hypot(h.x, h.z) / m * 0.15);
    vehicle.angularVelocity.y += (Math.random() - 0.5) * Math.min(2, Math.hypot(h.x, h.z) / m * 0.3);
  };
  net.onHostLeft = (p) => lobby.toast(`ホスト（${p.name}）が退出しました。天気とコースはこのままです`, 6000);
  net.onFinish = (peerId, f) => {
    if (f?.race !== raceId || !Number.isFinite(f?.time)) return;
    finishTimes.set(peerId, f.time);
    const p = net.peers.get(peerId);
    if (p) lobby.toast(`🏁 ${p.name} がゴール！ ${Math.floor(f.time / 60)}:${(f.time % 60).toFixed(2).padStart(5, '0')}`);
  };
  const handleRace = (r) => {
    if (r?.type === 'abort') { cannonball.abortedByHost(); lobby.toast('ホストがレースを中止しました'); return; }
    if (r?.type !== 'start' || !r.course?.goal) return;
    raceId = r.id;
    finishTimes.clear();
    const mine = r.starts?.[net.selfId] ?? r.course.start;
    cannonball.beginCourse({ ...r.course, start: mine });
  };
  net.onRace = handleRace;
  cannonball.setMulti({
    active: () => net.active,
    isHost: () => net.isHost,
    startRace(course) {
      // Line everyone up abreast at the start, host in the middle.
      const h = course.start.heading;
      const right = { x: Math.cos(h), z: -Math.sin(h) };
      const starts = {};
      net.players.forEach((p, i) => {
        const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 4.5;
        starts[p.id] = { x: course.start.x + right.x * side, z: course.start.z + right.z * side, heading: h };
      });
      const msg = { type: 'start', id: Math.random().toString(36).slice(2, 10), course, starts };
      net.sendRace(msg);
      handleRace(msg);
    },
    abortRace() { net.sendRace({ type: 'abort' }); },
    finished(time) { finishTimes.set(net.selfId, time); net.sendFinish({ race: raceId, time }); },
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
    onLeft: () => { remotes.clear(); for (const t of remoteTracks.values()) t.mesh.removeFromParent(); remoteTracks.clear(); lockHostSettings(); if (cannonball.multiRace) cannonball.abortedByHost(); },
  });
  net.onPeersChanged();

  if (config?.credit) $('credit').textContent = `車: ${config.credit}`;
  window.drive = { vehicle, truck, orbit, ground, sound, cannonball, bgm, tracks, moon, net, remotes };
  $('meter').hidden = false;
  $('help').hidden = query.get('help') === '0';
  $('loading').classList.add('done');

  // --- per frame (called by createWorld before the engines update)
  const camPos = new THREE.Vector3();
  let camHeading = vehicle.heading, camReady = false;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ'), qv = new THREE.Quaternion();
  const meter = { speed: $('speed'), rpm: $('rpmFill'), gear: $('gear'), range: $('range'), t: 0 };
  const wind = new THREE.Vector3();

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
    vi.handbrake = k('Space') || (gp?.handbrake ?? false);
    if (cannonball?.locked) { vi.throttle = 0; vi.brake = 0; }

    vehicle.update(dt, ground);

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

    // Dust and spray from the wheels.
    const wv = environment.windVector ?? wind;
    wind.set(wv.x ?? 0, 0, wv.z ?? 0);
    const sunE = atmosphere.sunLight ? atmosphere.sunLight.intensity * Math.max(0, environment.sunDirection.y) : 1;
    const skyE = atmosphere.skyLight ? atmosphere.skyLight.intensity : 0.3;
    dust.material.uniforms.uLight.value.setRGB(1, 1, 1).multiplyScalar((0.5 * sunE + skyE) / Math.PI); // like a Lambert surface
    const kickDust = (vehicle) => vehicle.wheels.forEach((wh) => {
      if (!wh.contact) return;
      const v = Math.abs(vehicle.speed);
      tmp.set(wh.local.x, wh.local.y - wh.length - vehicle.spec.wheelRadius * 0.8, wh.local.z).applyQuaternion(vehicle.quaternion).add(vehicle.position);
      const water = ground.water(tmp.x, tmp.z);
      const wet = water > tmp.y - 0.1;
      const surf = wh.surface;
      const dustiness = wet ? 1.2 : surf === 2 ? 1 : surf === 0 ? 0.55 : surf === 3 ? 0.8 : 0.12;
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
    // Other players: interpolate, pose, and give them dust and tracks too.
    if (remotes) {
      remotes.update(dt, camera, renderer);
      for (const r of remotes.list.values()) {
        if (!r.root.visible) continue;
        kickDust(r);
        let t = remoteTracks.get(r.id);
        if (!t) { t = new TireTracks(3000); scene.add(t.mesh); remoteTracks.set(r.id, t); }
        t.update(dt, r, ground, Math.min(1, environment.precipitation * 1.5));
      }
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
    cannonball?.update(dt, camera);
    sound.update(vehicle);

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
      eul.set(orbit.pitch * 0.8 - 0.04, orbit.yaw, 0);
      camera.quaternion.copy(q).multiply(qv.setFromEuler(eul));
      camera.near = 0.05;
      camera.updateProjectionMatrix();
      camReady = false;
      return;
    }
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
