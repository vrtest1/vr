// キャノンボール: a random goal somewhere out there, get to it as fast as you can, any route.
//
// The goal is a point on dry, drivable land at the chosen straight-line
// distance, preferring places where the straight line does not cross much
// water. It is marked with a beam of light visible from kilometres away; the
// HUD has a compass arrow, the distance, the clock and a minimap.
import * as THREE from 'three';

const COURSES = {
  short: { label: '近い', distance: 1000 },
  mid: { label: 'ふつう', distance: 2500 },
  long: { label: '遠い', distance: 5000 },
};
const ARRIVE = 14; // metres from the goal centre
const STORE = 'offroad-drive.cannonball.v1';

// --- small seeded random, so a course can be replayed from its seed ---------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Pick a goal from (x0, z0) at about `distance` metres. */
export function pickGoal(ground, x0, z0, distance, seed) {
  const random = rng(seed);
  let best = null;
  for (let i = 0; i < 160; i++) {
    const a = random() * Math.PI * 2;
    const d = distance * (0.85 + random() * 0.3);
    const x = x0 + Math.sin(a) * d, z = z0 - Math.cos(a) * d;
    const h = ground.height(x, z);
    if (h < ground.water(x, z) + 2 || h > 450) continue;
    const n = ground.normal(x, z, new THREE.Vector3());
    if (n.y < 0.92) continue; // flatter than about 23°
    // How much of the straight line is under water, and how much climbing.
    let wet = 0, climb = 0, prev = ground.height(x0, z0);
    const steps = Math.ceil(d / 40);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const sx = x0 + (x - x0) * t, sz = z0 + (z - z0) * t;
      const sh = ground.height(sx, sz);
      if (sh < 0.5) wet++;
      climb += Math.max(0, sh - prev);
      prev = sh;
    }
    const score = (wet / steps) * 4 + climb / d;
    if (!best || score < best.score) best = { x, z, h, score };
    if (wet / steps < 0.05 && climb / d < 0.12) break;
  }
  return best;
}

// --- the beacon -------------------------------------------------------------

const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vY;
varying vec3 vN;
varying vec3 vView;
void main() {
  vY = position.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const BEAM_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uGain;
varying float vY;
varying vec3 vN;
varying vec3 vView;
void main() {
  #include <logdepthbuf_fragment>
  float edge = abs(dot(normalize(vN), normalize(vView)));
  float core = pow(edge, 1.5);
  float fade = (1.0 - smoothstep(0.0, 1.0, vY)) * smoothstep(0.0, 0.004, vY);
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0 - vY * 40.0);
  gl_FragColor = vec4(uColor * uGain * (0.6 + 0.4 * core) * pulse, (0.35 + 0.55 * core) * fade);
}`;

function makeBeacon() {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.55, 0.12) }, uTime: { value: 0 }, uGain: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0), material);
  beam.frustumCulled = false;
  beam.renderOrder = 3;
  group.add(beam);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(ARRIVE - 1.2, ARRIVE, 64).rotateX(-Math.PI / 2), ringMat);
  ring.renderOrder = 2;
  group.add(ring);
  return { group, beam, ring, material };
}

// --- the game ---------------------------------------------------------------

export class Cannonball {
  state = 'idle'; // idle | countdown | running | finished
  course = null; // { key, seed, start: {x, z, heading}, goal: {x, z, h}, distance }
  time = 0;
  #o; #beacon; #ui = {}; #countdown = 0; #mapCanvas = null; #mapView = null; #mapTimer = 0;
  #lastBeep = 0; #driven = 0; #lastPos = new THREE.Vector3();

  /**
   * @param {object} o  { ground, vehicle, scene, camera, sound, place(x, z, heading), bar, brightness() }
   */
  constructor(o) {
    this.#o = o;
    this.#beacon = makeBeacon();
    this.#beacon.group.visible = false;
    o.scene.add(this.#beacon.group);
    this.#buildUI();
  }

  /** Multiplayer hooks from the app (see main.js). */
  setMulti(m) { this.#o.multi = m; }

  /** True while the truck must stay put (countdown). */
  get locked() { return this.state === 'countdown'; }

  // --- UI ---------------------------------------------------------------------

  #buildUI() {
    const el = (tag, cls, parent = document.body, html = '') => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      e.innerHTML = html;
      parent.appendChild(e);
      return e;
    };
    const ui = this.#ui;
    const open = el('button', '', this.#o.bar, 'キャノンボール');
    open.addEventListener('click', (e) => { e.stopPropagation(); this.state === 'idle' || this.state === 'finished' ? this.showMenu() : this.showMenu(true); });
    ui.open = open;

    ui.menu = el('div', 'cb-panel', document.body);
    ui.menu.hidden = true;

    ui.hud = el('div', 'cb-hud');
    ui.hud.hidden = true;
    ui.arrow = el('div', 'cb-arrow', ui.hud, '<svg viewBox="0 0 40 40" width="46" height="46"><path d="M20 3 L33 33 L20 26 L7 33 Z" fill="#ffc35a" stroke="#14100a" stroke-width="2" stroke-linejoin="round"/></svg>');
    ui.dist = el('div', 'cb-dist', ui.hud);
    ui.clock = el('div', 'cb-clock', ui.hud);

    ui.map = el('canvas', 'cb-map');
    ui.map.width = ui.map.height = 200;
    ui.map.hidden = true;

    ui.big = el('div', 'cb-big');
    ui.big.hidden = true;

    ui.board = el('div', 'cb-board');
    ui.board.hidden = true;
  }

  /** Multiplayer hooks (set by the app): see main.js. */
  get #net() { return this.#o.multi?.active() ? this.#o.multi : null; }

  showMenu(running = false) {
    const ui = this.#ui;
    const records = this.#records();
    const best = records.slice().sort((a, b) => b.avg - a.avg)[0];
    const list = records.slice(-6).reverse().map((r) =>
      `<tr><td>${COURSES[r.key]?.label ?? ''}</td><td>${(r.distance / 1000).toFixed(1)} km</td><td>${fmt(r.time)}</td><td>${r.avg.toFixed(0)} km/h</td></tr>`).join('');
    const net = this.#net;
    const guest = net && !net.isHost();
    ui.menu.innerHTML = `
      <h2>キャノンボール${net ? '（マルチ）' : ''}</h2>
      ${guest ? '<p><b>コースはホストが選びます。</b>ホストがスタートすると、みんな横に並んでカウントダウンが始まります。</p>' : ''}
      ${net && !guest ? '<p><b>あなたがホストです。</b>選んだコースで全員一斉にスタートします。</p>' : ''}
      <p>どこかにゴールが現れます。道はありません。好きなルートで、できるだけ速く着いてください。<br>
      光の柱と画面上の矢印、右下の地図がゴールの方向です。</p>
      ${guest ? '' : `<div class="cb-row">${Object.entries(COURSES).map(([k, c]) => `<button data-k="${k}">${c.label}<small>${(c.distance / 1000).toFixed(1)} km</small></button>`).join('')}</div>`}
      ${running && !guest ? '<div class="cb-row"><button data-act="retry">同じコースを最初から</button><button data-act="quit">やめる</button></div>' : ''}
      ${running && guest ? '<div class="cb-row"><button data-act="quit">リタイア</button></div>' : ''}
      ${this.state === 'finished' && this.course && !guest ? '<div class="cb-row"><button data-act="retry">同じコースをもう一度</button></div>' : ''}
      ${records.length ? `<h3>記録${best ? `（最速の平均速度 ${best.avg.toFixed(0)} km/h）` : ''}</h3><table>${list}</table>` : ''}
      <div class="cb-row"><button data-act="close">閉じる</button></div>`;
    ui.menu.hidden = false;
    for (const b of ui.menu.querySelectorAll('button')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        ui.menu.hidden = true;
        if (b.dataset.k) this.start(b.dataset.k);
        else if (b.dataset.act === 'retry') this.retry();
        else if (b.dataset.act === 'quit') this.quit();
      });
    }
  }

  // --- flow ---------------------------------------------------------------------

  start(key, seed = (Math.random() * 1e9) | 0) {
    const { vehicle, ground } = this.#o;
    const p = vehicle.position;
    const start = { x: p.x, z: p.z, heading: vehicle.heading };
    const goal = pickGoal(ground, start.x, start.z, COURSES[key].distance, seed);
    if (!goal) return;
    // Face the goal at the start: the heading of the straight line.
    start.heading = Math.atan2(-(goal.x - start.x), -(goal.z - start.z));
    const course = { key, seed, start, goal, distance: Math.hypot(goal.x - start.x, goal.z - start.z) };
    const net = this.#net;
    if (net) { if (net.isHost()) net.startRace(course); return; }
    this.course = course;
    this.multiRace = false;
    this.#buildMap();
    this.retry();
  }

  /** Multiplayer: start the host's course from our own place on the grid. */
  beginCourse(course) {
    this.course = course;
    this.multiRace = true;
    this.#buildMap();
    this.retry(true);
  }

  retry(fromNet = false) {
    if (!this.course) return;
    const net = this.#net;
    if (net && !fromNet) { if (net.isHost()) net.startRace(this.course); return; }
    const { start, goal } = this.course;
    this.#o.place(start.x, start.z, start.heading);
    const g = this.#beacon.group;
    g.position.set(goal.x, this.#o.ground.height(goal.x, goal.z) + 0.25, goal.z);
    g.visible = true;
    this.time = 0;
    this.#driven = 0;
    this.#lastPos.copy(this.#o.vehicle.position);
    this.#countdown = 3.5;
    this.#lastBeep = 4;
    this.state = 'countdown';
    this.#ui.hud.hidden = false;
    this.#ui.map.hidden = false;
    this.#ui.board.hidden = !this.multiRace;
    this.#ui.open.setAttribute('aria-pressed', 'true');
  }

  quit() {
    this.state = 'idle';
    this.#beacon.group.visible = false;
    this.#ui.hud.hidden = true;
    this.#ui.map.hidden = true;
    this.#ui.big.hidden = true;
    this.#ui.board.hidden = true;
    this.#ui.open.setAttribute('aria-pressed', 'false');
    if (this.multiRace && this.#net?.isHost()) this.#net.abortRace();
    this.multiRace = false;
  }

  #finish() {
    this.state = 'finished';
    const c = this.course;
    const avg = (c.distance / this.time) * 3.6;
    const rec = { key: c.key, seed: c.seed, distance: c.distance, time: this.time, avg, driven: this.#driven, date: Date.now() };
    const records = this.#records();
    const prevBest = records.reduce((m, r) => Math.max(m, r.avg), 0);
    records.push(rec);
    try { localStorage.setItem(STORE, JSON.stringify(records.slice(-50))); } catch { /* private mode */ }
    // In a race with others: our place (1 = first to arrive).
    const place = this.multiRace ? this.#net?.finished(this.time) : null;
    this.#o.sound.chime?.(place === 1 ? 'goal-first' : 'goal');
    const big = this.#ui.big;
    const placeText = place ? ` ${place === 1 ? '🥇 1着' : place === 2 ? '🥈 2着' : place === 3 ? '🥉 3着' : `${place}着`}` : '';
    big.innerHTML = `<div class="cb-title">ゴール！${placeText}</div><div class="cb-time">${fmt(this.time)}</div>
      <div class="cb-sub">直線 ${(c.distance / 1000).toFixed(2)} km ・ 実際に走った距離 ${(this.#driven / 1000).toFixed(2)} km ・ 平均 ${avg.toFixed(0)} km/h
      ${avg > prevBest && records.length > 1 ? '<br><b>最速記録を更新！</b>' : ''}</div>`;
    big.hidden = false;
    setTimeout(() => { if (this.state === 'finished') { big.hidden = true; this.showMenu(); } }, 4500);
  }

  #records() {
    try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; }
  }

  // --- per frame ---------------------------------------------------------------

  update(dt, camera) {
    if (this.state === 'idle') return;
    const { vehicle } = this.#o;
    const ui = this.#ui;
    const goal = this.course.goal;
    const p = vehicle.position;
    this.#beacon.material.uniforms.uTime.value += dt;
    // As bright as the sky around it, so it stands out by day and glows at night.
    this.#beacon.material.uniforms.uGain.value = 1.5 + 5 * (this.#o.brightness?.() ?? 1);

    if (this.state === 'countdown') {
      this.#countdown -= dt;
      const n = Math.ceil(this.#countdown - 0.5);
      if (n !== this.#lastBeep) {
        this.#lastBeep = n;
        this.#o.sound.chime?.(n > 0 ? 'tick' : 'go');
        ui.big.hidden = false;
        ui.big.innerHTML = `<div class="cb-count">${n > 0 ? n : 'GO!'}</div>`;
      }
      if (this.#countdown <= 0.5) {
        this.state = 'running';
        setTimeout(() => { if (this.state === 'running') ui.big.hidden = true; }, 700);
      }
    } else if (this.state === 'running') {
      this.time += dt;
      this.#driven += Math.hypot(p.x - this.#lastPos.x, p.z - this.#lastPos.z);
      this.#lastPos.copy(p);
      if (Math.hypot(p.x - goal.x, p.z - goal.z) < ARRIVE) this.#finish();
    }

    // Beacon: keep it a few pixels wide however far away.
    const camDist = camera.getWorldPosition(new THREE.Vector3()).distanceTo(this.#beacon.group.position);
    const r = Math.max(2.5, camDist * 0.011);
    this.#beacon.beam.scale.set(r, Math.max(350, camDist * 0.35), r);

    // Arrow: the goal's direction relative to where the camera looks.
    const f = camera.getWorldDirection(new THREE.Vector3());
    const camYaw = Math.atan2(f.x, -f.z);
    const goalYaw = Math.atan2(goal.x - p.x, -(goal.z - p.z));
    ui.arrow.style.transform = `rotate(${goalYaw - camYaw}rad)`;
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    ui.dist.textContent = d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(0)} m`;
    ui.clock.textContent = fmt(this.time);

    if (this.multiRace && this.#net) this.#drawBoard();
    this.#mapTimer -= dt;
    if (this.#mapTimer <= 0) { this.#mapTimer = 0.1; this.#drawMap(); }
  }

  #boardTimer = 0;
  #drawBoard() {
    if ((this.#boardTimer = (this.#boardTimer + 1) % 6) !== 0) return; // a few times a second is plenty
    const rows = this.#net.board(); // [{ name, color, time | null, self, dist }]
    rows.sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9) || (a.dist ?? 1e9) - (b.dist ?? 1e9));
    this.#ui.board.innerHTML = rows.map((r, i) => `<div class="${r.self ? 'me' : ''}"><span>${i + 1}</span><i style="background:${r.color}"></i>
      <em>${escapeHtml(r.name)}</em><b>${r.time != null ? fmt(r.time) : r.dist != null ? (r.dist > 1000 ? (r.dist / 1000).toFixed(1) + ' km' : Math.round(r.dist) + ' m') : '—'}</b></div>`).join('');
  }

  /** Multiplayer: the host called the race off. */
  abortedByHost() {
    if (this.state === 'idle') return;
    this.multiRace = false;
    this.quit();
  }

  // --- minimap ---------------------------------------------------------------

  #buildMap() {
    const { ground } = this.#o;
    const { start, goal } = this.course;
    const cx = (start.x + goal.x) / 2, cz = (start.z + goal.z) / 2;
    const half = Math.max(Math.abs(goal.x - start.x), Math.abs(goal.z - start.z)) / 2 * 1.35 + 300;
    const N = 160;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const n = new THREE.Vector3();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = cx - half + (i + 0.5) / N * 2 * half;
        const z = cz - half + (j + 0.5) / N * 2 * half;
        const h = ground.height(x, z);
        let rgb;
        if (h < 0) {
          const deep = Math.min(1, -h / 30);
          rgb = [40 - 25 * deep, 120 - 60 * deep, 150 - 40 * deep];
        } else {
          ground.normal(x, z, n);
          const shade = 0.75 + 0.35 * (n.x * -0.5 + n.y * 0.7 + n.z * -0.5);
          const steep = n.y < 0.8;
          if (h < 3) rgb = [200, 186, 140];
          else if (h > 700) rgb = [230, 232, 236];
          else if (steep) rgb = [130, 124, 116];
          else rgb = [92 + h * 0.06, 122 - h * 0.02, 62];
          rgb = rgb.map((v) => v * shade);
        }
        const o = (j * N + i) * 4;
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.#mapCanvas = c;
    this.#mapView = { cx, cz, half };
  }

  #drawMap() {
    const ui = this.#ui;
    if (!this.#mapCanvas) return;
    const g = ui.map.getContext('2d');
    const S = ui.map.width;
    const { cx, cz, half } = this.#mapView;
    const toPx = (x, z) => [((x - (cx - half)) / (2 * half)) * S, ((z - (cz - half)) / (2 * half)) * S];
    g.imageSmoothingEnabled = true;
    g.drawImage(this.#mapCanvas, 0, 0, S, S);
    const { start, goal } = this.course;
    const [sx, sy] = toPx(start.x, start.z), [gx, gy] = toPx(goal.x, goal.z);
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(gx, gy); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 3, 0, 7); g.fill();
    g.fillStyle = '#ffc35a'; g.strokeStyle = '#14100a'; g.lineWidth = 2;
    g.beginPath(); g.arc(gx, gy, 6, 0, 7); g.fill(); g.stroke();
    // Other players: coloured dots.
    for (const o of this.#net?.others() ?? []) {
      const [ox, oy] = toPx(o.x, o.z);
      g.fillStyle = o.color; g.strokeStyle = '#fff'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(ox, oy, 4.5, 0, 7); g.fill(); g.stroke();
    }
    // The truck: a triangle pointing where it faces.
    const v = this.#o.vehicle;
    const [px, py] = toPx(v.position.x, v.position.z);
    const h = v.heading;
    g.save();
    g.translate(px, py);
    g.rotate(-h);
    g.fillStyle = '#ff5a4a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // Power-up stars (when the アイテム button is on), on top of everything.
    for (const m of this.#o.items?.() ?? []) {
      const [ix, iy] = toPx(m.x, m.z);
      g.fillStyle = m.color; g.strokeStyle = '#fff'; g.lineWidth = 1.2;
      g.globalAlpha = m.landed ? 1 : 0.6;
      g.beginPath(); g.arc(ix, iy, m.rainbow ? 5.5 : 4, 0, 7); g.fill(); g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.font = '11px sans-serif';
    g.fillText('N', S / 2 - 4, 12);
  }
}

function fmt(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
