// お助けアイテム: while the アイテム button is on, konpeito-shaped stars
// (round, with soft nubs, glowing like a paper room lamp) fall out of the sky
// ahead of the truck with a comet's trail, land, and wait. Drive into one to
// pick it up. Each colour is an effect:
//
//   pink    ブースト      more engine power for a while
//   blue    グリップ      tyres hold much better for a while
//   yellow  ワープ        (キャノンボール only) a jump towards the goal
//
// Stars are this player's own: nobody else sees them, so turning the button
// on is a handicap for whoever wants one. No three.js lights are used: the
// glow on the ground is a decal fitted to the terrain.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { t } from './i18n.js';

const KINDS = {
  boost: { label: t('ブースト', 'Boost'), icon: '⚡', color: new THREE.Color(1.0, 0.38, 0.62), time: 8 },
  grip: { label: t('グリップ', 'Grip'), icon: '🛞', color: new THREE.Color(0.3, 0.72, 1.0), time: 12 },
  warp: { label: t('ワープ', 'Warp'), icon: '✨', color: new THREE.Color(1.0, 0.82, 0.22), time: 0 },
  // The rare special one: rainbow, flashing, 30 s of super armour.
  rainbow: { label: t('スーパー', 'Super'), icon: '🌈', color: new THREE.Color(1, 1, 1), time: 30 },
};
const RADIUS = 1.5;     // m: about a car's width across with the nubs
const FALL = 3.2;       // s from the sky to the ground
const LIFE = 50;        // s a landed star waits
const MAX = 2;          // stars out at once
const REACH = 3.6;      // m: drive this close to pick one up

// --- the shape: a sphere with ~24 rounded nubs ------------------------------

function konpeitoGeometry() {
  // Shared corners (mergeVertices) so the normals average out: smooth shading.
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 20).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = geo.attributes.position;
  // Nub directions spread evenly over the sphere (golden spiral), a little jittered.
  const dirs = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996 + Math.sin(i * 12.9898) * 0.15;
    dirs.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let bump = 0;
    // Sum of soft bumps rather than the largest: rounded nubs, smooth valleys.
    for (const d of dirs) bump += Math.pow(Math.max(0, v.dot(d)), 22);
    v.multiplyScalar(0.84 + 0.22 * Math.min(1.2, bump));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// A milky glow: brightest where the surface faces you (light through paper),
// a soft rim, the nubs a touch paler.
const STAR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vView;
varying float vR;
void main() {
  vR = length(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uGlow;
uniform float uOpacity;
uniform float uRainbow; // 1 = the special star: hues racing over the surface
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying float vR;
vec3 pwsHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  #include <logdepthbuf_fragment>
  float facing = max(dot(normalize(vN), normalize(vView)), 0.0);
  float core = 0.55 + 0.45 * facing;
  float nub = smoothstep(0.9, 1.05, vR);
  vec3 base = uColor;
  if (uRainbow > 0.5) base = pwsHue(fract(uTime * 0.9 + dot(normalize(vN), vec3(0.35, 0.6, 0.25)) * 0.8));
  vec3 c = mix(base, vec3(1.0), (uRainbow > 0.5 ? 0.0 : 0.06) + 0.22 * nub) * core * uGlow;
  gl_FragColor = vec4(c, uOpacity);
}`;

// The comet's tail: a long cone behind the star, fading along its length.
const TRAIL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLength;
varying float vT;
void main() {
  vT = position.y / uLength;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const TRAIL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying float vT;
void main() {
  #include <logdepthbuf_fragment>
  float a = pow(1.0 - clamp(vT, 0.0, 1.0), 2.2) * uOpacity;
  gl_FragColor = vec4(mix(vec3(1.0), uColor, vT) * a * 2.5, 1.0);
}`;

// The soft light it throws on the ground around it.
const POOL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec3 toCam = cameraPosition - wp.xyz;
  float d = length(toCam);
  wp.xyz += toCam / max(d, 1e-3) * (0.12 + d * 0.004);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;
const POOL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCenter;
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  float d = distance(vWorld.xz, uCenter.xz);
  float a = exp(-d * d / 18.0) * uStrength;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StarDrops {
  enabled = false;
  stars = [];
  #o; #geo; #halo; #timer = 6; #active = {}; #hud; #radar; #radarTimer = 0;

  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {object} o.ground     { height, normal, water }
   * @param {object} o.vehicle
   * @param {object} o.sound      TruckSound (chime)
   * @param {object} o.cannonball  for the warp: { state, course }
   * @param {function} o.place    (x, z, heading) puts the truck down there
   * @param {function} o.toast    (text) a short message
   * @param {function} [o.onLand] (position) e.g. a puff of dust
   * @param {function} [o.brightness] () => sky light (about 1.7 at noon, 0.05 at night): the glow follows it
   */
  constructor(o) {
    this.#o = o;
    this.#geo = konpeitoGeometry();
    this.#halo = haloTexture();
    // Outside a race: a small radar (the race has its own minimap).
    this.#radar = document.createElement('canvas');
    this.#radar.className = 'item-radar';
    this.#radar.width = this.#radar.height = 160;
    this.#radar.hidden = true;
    document.body.appendChild(this.#radar);
    this.#hud = document.createElement('div');
    this.#hud.className = 'item-fx';
    this.#hud.hidden = true;
    document.body.appendChild(this.#hud);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) for (const s of [...this.stars]) this.#remove(s);
    this.#timer = 4 + Math.random() * 4;
  }

  /** Where the stars are, for maps: { x, z, css colour, rainbow, landed }. */
  markers() {
    const hue = (performance.now() / 1000 * 0.9) % 1;
    return this.stars.map((st) => ({
      x: st.target.x, z: st.target.z, landed: st.landed, rainbow: st.kind === 'rainbow',
      color: st.kind === 'rainbow' ? `hsl(${Math.round(hue * 360)}, 100%, 60%)` : `#${KINDS[st.kind].color.getHexString()}`,
    }));
  }

  /** Seconds of super armour left (0 = none): main.js makes the truck glow. */
  get armorLeft() { return this.#active.rainbow ?? 0; }

  // --- stars shared by a mini-game (net/games.js decides who gets them) -------

  /** The minimap is on screen and shows the stars itself: no radar then (main.js sets it). */
  minimapShown = false;

  /** No stars of our own while a game is on. */
  pauseLocal = false;

  /** A game star: id from the game, kind, where it lands. */
  addShared(id, kind, x, z) {
    if (this.stars.some((s) => s.shared === id)) return;
    const h = this.#o.ground.height(x, z);
    this.#spawn(kind, new THREE.Vector3(x, h, z), id);
  }

  /** Take a game star away; `mine` = we got it (its effect applies). */
  removeShared(id, mine = false) {
    const s = this.stars.find((x) => x.shared === id);
    if (s) this.#remove(s);
    if (mine) this.#apply(KINDS[s?.kind] ? s.kind : 'boost');
  }

  /** Remove all game stars. */
  clearShared() { for (const s of this.stars.filter((x) => x.shared !== null)) this.#remove(s); }

  /** Remove every star, ours and the game's (a new world: they would hang over other ground). */
  clear() { for (const s of [...this.stars]) this.#remove(s); this.#timer = 4 + Math.random() * 4; }

  /** Drop one now (tests, or a debug key). */
  spawnNow(kind = null) { this.#spawn(kind); }

  // --- making one -------------------------------------------------------------

  #pickKind() {
    const racing = this.#o.cannonball.state === 'running';
    if (Math.random() < 0.12) return 'rainbow'; // the rare one
    const kinds = racing ? ['boost', 'boost', 'grip', 'warp'] : ['boost', 'grip'];
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  /** Somewhere ahead (towards the goal in a race), on dry and not too steep land. */
  #spot() {
    const { vehicle, ground, cannonball } = this.#o;
    const p = vehicle.position;
    let dir = Math.atan2(-vehicle.forward.x, -vehicle.forward.z); // heading of travel
    const goal = cannonball.state === 'running' ? cannonball.course?.goal : null;
    if (goal) dir = Math.atan2(-(goal.x - p.x), -(goal.z - p.z));
    const n = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      const a = dir + (Math.random() - 0.5) * 0.9;
      const d = 45 + Math.random() * 50;
      const x = p.x - Math.sin(a) * d, z = p.z - Math.cos(a) * d;
      const h = ground.height(x, z);
      if (h < ground.water(x, z) + 0.6) continue;
      if (ground.normal(x, z, n).y < 0.85) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  #spawn(force = null, at = null, shared = null) {
    const target = at ?? this.#spot();
    if (!target) return;
    const kind = force ?? this.#pickKind();
    const color = KINDS[kind].color;
    // A shallow streak across the view: from far off to one side and further
    // ahead, low enough in the sky that the driving camera sees it come in.
    const f = this.#o.vehicle.forward;
    const fl = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / fl, fz = f.z / fl;
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = target.clone().add(new THREE.Vector3(
      fx * 160 + -fz * side * 240, 70 + Math.random() * 25, fz * 160 + fx * side * 240));

    const group = new THREE.Group();
    const body = new THREE.Mesh(this.#geo, new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uColor: { value: color.clone() }, uGlow: { value: 1.5 }, uOpacity: { value: 1 }, uRainbow: { value: kind === 'rainbow' ? 1 : 0 }, uTime: { value: 0 } },
      transparent: true,
    }));
    body.scale.setScalar(RADIUS);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.#halo, color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.3), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(RADIUS * 6.5);
    group.add(body, halo);
    this.#o.scene.add(group);

    const L = 70;
    const trail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, RADIUS * 0.9, L, 20, 1, true).translate(0, L / 2, 0),
      new THREE.ShaderMaterial({
        vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
        uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 1 }, uLength: { value: L } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
    trail.frustumCulled = false;
    this.#o.scene.add(trail);

    // The pool of light on the ground (shown once it has landed).
    const cells = 10, size = 14;
    const poolGeo = new THREE.PlaneGeometry(1, 1, cells, cells);
    const pool = new THREE.Mesh(poolGeo, new THREE.ShaderMaterial({
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
      uniforms: { uCenter: { value: target.clone() }, uColor: { value: color.clone() }, uStrength: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    pool.frustumCulled = false;
    const pp = poolGeo.attributes.position;
    for (let j = 0; j <= cells; j++) {
      for (let i = 0; i <= cells; i++) {
        const x = target.x + (i / cells - 0.5) * size, z = target.z + (j / cells - 0.5) * size;
        pp.setXYZ(j * (cells + 1) + i, x, this.#o.ground.height(x, z), z);
      }
    }
    pp.needsUpdate = true;
    pool.visible = false;
    this.#o.scene.add(pool);

    const star = { kind, group, body, halo, trail, pool, start, target, t: 0, landed: false, life: shared !== null ? Infinity : LIFE, gone: 0, spin: (Math.random() - 0.5) * 1.2, shared, claimed: false };
    this.stars.push(star);
    this.#o.sound.chime?.('fall');
  }

  #remove(s) {
    for (const m of [s.group, s.trail, s.pool]) m.removeFromParent();
    s.body.material.dispose(); s.halo.material.dispose();
    s.trail.geometry.dispose(); s.trail.material.dispose();
    s.pool.geometry.dispose(); s.pool.material.dispose();
    this.stars.splice(this.stars.indexOf(s), 1);
  }

  // --- effects ----------------------------------------------------------------

  #apply(kind) {
    const { vehicle, cannonball, ground, place, toast, sound } = this.#o;
    sound.chime?.('star');
    const k = KINDS[kind];
    if (kind === 'warp') {
      const goal = cannonball.state === 'running' ? cannonball.course?.goal : null;
      if (goal) {
        const p = vehicle.position;
        const d = Math.hypot(goal.x - p.x, goal.z - p.z);
        const jump = Math.min(350, Math.max(0, d - 60));
        const heading = Math.atan2(-(goal.x - p.x), -(goal.z - p.z));
        const n = new THREE.Vector3();
        // The nearest dry, gentle spot around the point that far along.
        for (let r = 0; r < 120 && jump > 20; r += 8) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const x = p.x + ((goal.x - p.x) / d) * jump + Math.sin(a) * r;
            const z = p.z + ((goal.z - p.z) / d) * jump + Math.cos(a) * r;
            if (ground.height(x, z) < ground.water(x, z) + 0.6 || ground.normal(x, z, n).y < 0.9) continue;
            place(x, z, heading);
            toast(t(`${k.icon} ワープ！ ゴールまで ${Math.round(Math.hypot(goal.x - x, goal.z - z))} m`, `${k.icon} Warp! ${Math.round(Math.hypot(goal.x - x, goal.z - z))} m to the goal`));
            return;
          }
        }
      }
      kind = 'boost'; // nowhere to go: a boost instead
    }
    const fx = KINDS[kind];
    this.#active[kind] = fx.time;
    if (kind === 'rainbow') {
      sound.chime?.('rainbow');
      sound.rainbow?.(true);
      toast(t('🌈 スーパーアーマー！ 木をすり抜け、ぶつかった車を弾き飛ばす（30秒）', '🌈 Super armour! Through trees, and other trucks go flying (30 s)'));
      return;
    }
    toast(t(`${fx.icon} ${fx.label}！（${fx.time}秒）`, `${fx.icon} ${fx.label}! (${fx.time} s)`));
  }

  // --- radar -------------------------------------------------------------------

  #drawRadar() {
    // In a race the minimap is too large a scale for stars a stone's throw
    // away, so the radar sits above it.
    const racing = this.#o.cannonball.state === 'running' || this.#o.cannonball.state === 'countdown';
    const show = this.stars.length > 0 && !this.minimapShown;
    this.#radar.hidden = !show;
    this.#radar.classList.toggle('above-map', racing);
    if (!show) return;
    const c = this.#radar, g = c.getContext('2d');
    const S = c.width, R = S / 2 - 4, RANGE = 120; // metres to the edge
    const v = this.#o.vehicle;
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(S / 2, S / 2);
    g.fillStyle = 'rgba(8, 12, 10, .62)';
    g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, .18)'; g.lineWidth = 1;
    for (const r of [R / 3, (2 * R) / 3, R]) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
    // Truck-up: rotate the world so where we face is the top.
    const h = v.heading;
    const cos = Math.cos(h), sin = Math.sin(h);
    for (const m of this.markers()) {
      const dx = m.x - v.position.x, dz = m.z - v.position.z;
      // World (dx, dz) into the truck's frame: forward is -Z at heading 0.
      let rx = dx * cos - dz * sin, ry = dx * sin + dz * cos;
      let px = (rx / RANGE) * R, py = (ry / RANGE) * R;
      const d = Math.hypot(px, py);
      const far = d > R - 7;
      if (far) { px *= (R - 7) / d; py *= (R - 7) / d; }
      g.fillStyle = m.color;
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.globalAlpha = m.landed ? 1 : 0.6;
      g.beginPath(); g.arc(px, py, far ? 4.5 : m.rainbow ? 7.5 : 6, 0, 7); g.fill(); g.stroke();
      g.globalAlpha = 1;
    }
    // Us, in the middle, pointing up.
    g.fillStyle = '#ff5a4a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(255, 255, 255, .75)';
    g.font = '11px sans-serif';
    g.fillText('★', 8, 16);
  }

  // --- every frame ------------------------------------------------------------

  update(dt, camera) {
    const { vehicle } = this.#o;
    // Effects wear off.
    const armor = this.#active.rainbow > 0;
    vehicle.power = armor ? 2.8 : this.#active.boost > 0 ? 1.9 : 1;
    vehicle.gripBoost = armor ? 1.35 : this.#active.grip > 0 ? 1.45 : 1;
    if (vehicle.armor && !armor) this.#o.sound.rainbow?.(false);
    vehicle.armor = armor;
    // More grip also tips the truck harder in a turn: help it stay up.
    vehicle.rollAssist = !armor && this.#active.grip > 0 ? 0.6 : 0;
    const shown = [];
    for (const k of Object.keys(this.#active)) {
      this.#active[k] -= dt;
      if (this.#active[k] > 0) shown.push(`${KINDS[k].icon} ${KINDS[k].label} ${Math.ceil(this.#active[k])}`);
      else delete this.#active[k];
    }
    this.#hud.hidden = !shown.length;
    if (shown.length) this.#hud.textContent = shown.join('　');

    // The radar, ten times a second.
    this.#radarTimer -= dt;
    if (this.#radarTimer <= 0) { this.#radarTimer = 0.1; this.#drawRadar(); }

    // New stars now and then.
    if (this.enabled && !this.pauseLocal && this.stars.filter((x) => x.shared === null).length < MAX) {
      this.#timer -= dt;
      if (this.#timer <= 0) { this.#spawn(); this.#timer = 14 + Math.random() * 16; }
    }

    const now = performance.now() / 1000;
    const p = vehicle.position;
    // A room lamp: bright enough to read by day, soft at night (not a floodlight).
    const sky = this.#o.brightness?.() ?? 1;
    const glow = 0.45 + 0.95 * sky;
    const haloK = 0.22 + 0.3 * Math.min(1, sky);
    for (const s of [...this.stars]) {
      if (s.kind === 'rainbow') {
        const c = _c.setHSL((now * 0.9) % 1, 1, 0.6);
        s.body.material.uniforms.uTime.value = now;
        s.halo.material.color.copy(c);
        s.trail.material.uniforms.uColor.value.copy(c);
        s.pool.material.uniforms.uColor.value.copy(c);
      }
      if (!s.landed) {
        // Falling: speeding up a little, the tail streaming behind.
        s.t += dt / FALL;
        const e = Math.min(1, s.t * (0.6 + 0.4 * s.t));
        const rest = s.target.clone().add(_up.set(0, RADIUS + 0.4, 0));
        s.group.position.lerpVectors(s.start, rest, e);
        const vel = rest.clone().sub(s.start).normalize();
        s.trail.position.copy(s.group.position);
        s.trail.quaternion.setFromUnitVectors(_up.set(0, 1, 0), vel.negate());
        if (s.t >= 1) {
          s.landed = true;
          s.trail.visible = false;
          s.pool.visible = true;
          this.#o.sound.chime?.('land');
          this.#o.onLand?.(s.target);
        }
      } else {
        // Waiting: a slow turn, a gentle bob, a soft breathing glow.
        s.life -= dt;
        const breathe = 0.85 + 0.15 * Math.sin(now * 2.2 + s.spin * 5);
        s.group.position.y = s.target.y + RADIUS + 0.4 + 0.25 * Math.sin(now * 1.6 + s.spin * 3);
        s.body.rotation.y += dt * (0.5 + s.spin);
        s.body.rotation.x += dt * 0.2;
        const fade = Math.min(1, s.life / 3);
        s.body.material.uniforms.uGlow.value = s.kind === 'rainbow' ? (glow * 1.3 + 0.4) * (0.75 + 0.25 * Math.sin(now * 14)) : glow * breathe;
        s.body.material.uniforms.uOpacity.value = fade;
        s.halo.material.opacity = haloK * breathe * fade;
        s.pool.material.uniforms.uStrength.value = 0.35 * breathe * fade;
        if (s.life <= 0) { this.#remove(s); continue; }
        // Picked up?
        const dx = p.x - s.group.position.x, dz = p.z - s.group.position.z, dy = p.y - s.group.position.y;
        if (dx * dx + dz * dz < REACH * REACH && Math.abs(dy) < 4) {
          if (s.shared === null) {
            this.#apply(s.kind);
            this.#remove(s);
          } else if (!s.claimed) {
            // A game star: ask whoever runs the game; it goes when they say.
            s.claimed = true;
            s.body.material.uniforms.uOpacity.value = 0.35;
            this.#o.onSharedTouch?.(s.shared);
          }
        }
      }
    }
  }
}

const _up = new THREE.Vector3();
const _c = new THREE.Color();
