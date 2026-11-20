// Rain: falling streaks around the camera, and drops on the windscreen.
//
// RainStreaks: thousands of thin streaks in one draw call. Everything moves
// on the GPU: each streak has a fixed random place in a box that travels with
// the camera, falls with time and wraps round, so the CPU only hands over the
// time, the camera and the wind each frame. They are lit by the sky and, at
// night, by the headlights, and kept out of our own truck's body (no rain in
// the cab) and out of the water.
//
// WindscreenRain: drops on the windscreen glass. A copy of the windscreen's
// triangles, a few millimetres outside the glass, shows a small canvas where
// the drops are drawn: they land, grow, run down when we are slow, are blown
// up and aside when we are fast, and the wipers sweep them off.
import * as THREE from 'three';

const STREAK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 corner;     // x: -1..1 across, y: 0 head .. 1 tail
attribute vec4 aSeed;      // xyz: place in the box (0..1), w: 0..1 which ones show for this much rain
uniform vec3 uCam, uBox;
uniform vec3 uOffset;      // how far the rain has fallen (and drifted), kept within the box
uniform vec3 uStreak;      // the way a streak points: the rain's velocity as the camera sees it
uniform float uLen, uWidth, uAmount;
uniform mat4 uTruckInv;
uniform vec3 uTruckMin, uTruckMax;
varying float vAlpha;
varying float vAcross;
varying vec3 vWorld;
void main() {
  vAlpha = 0.0; vAcross = corner.x;
  if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 base = uCam - uBox * 0.5;
  vec3 p = aSeed.xyz * uBox + uOffset;
  p = base + mod(p - base, uBox);
  vec3 dir = normalize(uStreak);
  // Its length is how far it moves while the eye takes it in (~1/14 s).
  vec3 P = p - dir * (clamp(length(uStreak) * uLen, 0.4, 3.0) * corner.y);
  // Not inside our truck (the cab and the body keep the rain off).
  vec3 lt = (uTruckInv * vec4(P, 1.0)).xyz;
  if (all(greaterThan(lt, uTruckMin)) && all(lessThan(lt, uTruckMax))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 toCam = cameraPosition - P;
  float d = length(toCam);
  // Wider far away (no streak thinner than about a pixel), fainter to match.
  float w = uWidth * max(1.0, d * 0.035);
  vec3 side = normalize(cross(dir, toCam));
  P += side * corner.x * w;
  vWorld = P;
  vec2 h = abs(p.xz - uCam.xz) / (uBox.xz * 0.5);
  float edge = 1.0 - smoothstep(0.6, 1.0, max(h.x, h.y));
  vAlpha = edge * smoothstep(1.0, 3.0, d) / max(1.0, d * 0.035);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  #include <logdepthbuf_vertex>
}`;

const STREAK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uLight;
uniform float uWater, uOpacity;
uniform vec3 uLampPos[2], uLampDir;
uniform float uLampCos, uLamp;
varying float vAlpha;
varying float vAcross;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  if (vWorld.y < uWater || vAlpha <= 0.0) discard;
  vec3 c = uLight;
  // In the headlight beams the drops shine.
  for (int i = 0; i < 2; i++) {
    vec3 d = vWorld - uLampPos[i];
    float r = length(d);
    float cone = smoothstep(uLampCos, mix(uLampCos, 1.0, 0.4), dot(d / r, uLampDir));
    c += vec3(1.0, 0.95, 0.85) * uLamp * cone / (1.0 + r * r * 0.012);
  }
  float a = vAlpha * uOpacity * (1.0 - abs(vAcross));
  gl_FragColor = vec4(c, a);
}`;

export class RainStreaks {
  mesh;
  #u;
  #max;
  #fall = new THREE.Vector3();

  constructor(max = 9000) {
    this.#max = max;
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
    base.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3)); // unused, three wants one
    base.setIndex([0, 2, 1, 1, 2, 3]);
    const seed = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) {
      seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = (i + Math.random()) / max; // evenly spread, so any amount shows a fair sample
    }
    base.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    base.instanceCount = max;
    this.#u = {
      uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(60, 36, 60) },
      uOffset: { value: new THREE.Vector3() }, uStreak: { value: new THREE.Vector3(0, -9, 0) }, uLen: { value: 0.075 }, uWidth: { value: 0.011 }, uAmount: { value: 0 },
      uTruckInv: { value: new THREE.Matrix4() }, uTruckMin: { value: new THREE.Vector3(1, 1, 1) }, uTruckMax: { value: new THREE.Vector3(-1, -1, -1) },
      uLight: { value: new THREE.Color() }, uWater: { value: 0 }, uOpacity: { value: 0.55 },
      uLampPos: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uLampDir: { value: new THREE.Vector3(0, 0, -1) },
      uLampCos: { value: Math.cos(0.46) }, uLamp: { value: 0 },
    };
    this.mesh = new THREE.Mesh(base, new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, uniforms: this.#u,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** How many streaks at most (by the quality setting). */
  setCount(n) { this.mesh.geometry.instanceCount = Math.min(this.#max, n); }

  /** Our truck's body, in its own space: no streaks inside it. */
  setTruckBox(box) { this.#u.uTruckMin.value.copy(box.min); this.#u.uTruckMax.value.copy(box.max); }

  /**
   * @param {object} o
   * @param {number} o.dt       seconds since the last frame
   * @param {THREE.Vector3} [o.viewer] the camera's own velocity, to slant the streaks
   *        towards a moving viewer (driver's seat); omitted: they fall as seen standing still
   * @param {number} o.amount   0..1 rain
   * @param {THREE.Vector3} o.camera  camera position
   * @param {THREE.Vector3} o.wind    wind (m/s, x and z used)
   * @param {THREE.Color} o.light     the light on the drops (sky and sun)
   * @param {number} o.water          water surface height near the camera
   * @param {THREE.Object3D} o.truck  our truck's root (its world matrix is current)
   * @param {THREE.Object3D[]} [o.lamps]  our two headlights (SpotLights) and how bright (0..1)
   * @param {number} [o.lampOn]
   * @param {boolean} [o.hidden]      e.g. the camera is under water
   */
  update(o) {
    const u = this.#u;
    this.mesh.visible = o.amount > 0.01 && !o.hidden;
    if (!this.mesh.visible) return;
    u.uAmount.value = Math.min(1, o.amount);
    u.uCam.value.copy(o.camera);
    // Fall a little each frame (wind can change without the rain jumping), wrapped to the box.
    const f = this.#fall.set(o.wind.x * 0.6, -9, o.wind.z * 0.6);
    const off = u.uOffset.value.addScaledVector(f, Math.min(0.1, o.dt));
    const b = u.uBox.value;
    off.set(((off.x % b.x) + b.x) % b.x, ((off.y % b.y) + b.y) % b.y, ((off.z % b.z) + b.z) % b.z);
    u.uStreak.value.copy(f);
    if (o.viewer) u.uStreak.value.sub(o.viewer);
    u.uLight.value.copy(o.light);
    u.uWater.value = o.water;
    u.uTruckInv.value.copy(o.truck.matrixWorld).invert();
    if (o.lamps?.length === 2) {
      for (let i = 0; i < 2; i++) o.lamps[i].getWorldPosition(u.uLampPos.value[i]);
      o.lamps[0].target.getWorldPosition(u.uLampDir.value).sub(u.uLampPos.value[0]).normalize();
    }
    u.uLamp.value = o.lampOn ?? 0;
  }
}

// --- the windscreen -----------------------------------------------------------

const W = 1024, H = 512; // the drops' canvas (about 1.5 mm a pixel on the glass)

function dropSprite() {
  // A drop is a tiny lens: a dark rim, a lighter middle and a glint of sky on
  // top. Drawn small (16 px) with strong contrast, as it is used at 2..5 px:
  // a soft, faint one simply vanishes at that size.
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(70, 80, 92, 0.75)';
  g.beginPath(); g.arc(8, 8.5, 7.5, 0, 7); g.fill();
  g.fillStyle = 'rgba(200, 212, 225, 0.7)';
  g.beginPath(); g.arc(8, 7.5, 5, 0, 7); g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.beginPath(); g.arc(6.5, 5.5, 2.2, 0, 7); g.fill();
  return c;
}

/**
 * Find the windscreen in the truck model (the glass facing forward and up,
 * ahead of the cab) and put a drops layer on it.
 * @returns {WindscreenRain|null}
 */
export function makeWindscreenRain(root, { material = /glass/i, maxZ = -0.4, minY = 0.9 } = {}) {
  let made = null;
  root.traverse((o) => {
    if (made || !o.isMesh || o.userData.isLamp) return;
    const mats = [].concat(o.material);
    const g = o.geometry;
    const pos = g.attributes.position, nrm = g.attributes.normal, idx = g.index;
    if (!pos || !nrm) return;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    const P = [], N = [];
    for (const grp of groups) {
      if (!material.test(mats[grp.materialIndex ?? 0]?.name ?? '')) continue;
      for (let i = grp.start; i < grp.start + grp.count; i += 3) {
        const v = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
        let cy = 0, cz = 0, ny = 0, nz = 0;
        for (const a of v) { cy += pos.getY(a) / 3; cz += pos.getZ(a) / 3; ny += nrm.getY(a) / 3; nz += nrm.getZ(a) / 3; }
        if (!(nz < -0.35 && ny > 0.25 && cz < maxZ && cz > -2 && cy > minY)) continue;
        for (const a of v) {
          // 4 mm out from the glass, so the drops sit on its outside.
          P.push(pos.getX(a) + nrm.getX(a) * 0.004, pos.getY(a) + nrm.getY(a) * 0.004, pos.getZ(a) + nrm.getZ(a) * 0.004);
          N.push(nrm.getX(a), nrm.getY(a), nrm.getZ(a));
        }
      }
    }
    if (P.length) made = new WindscreenRain(o, P, N);
  });
  return made;
}

export class WindscreenRain {
  mesh;
  drops = [];
  splashes = [];  // the ring where a drop just hit, for a moment
  onStroke = null; // (seconds) a wiper stroke begins (for its sound)
  #canvas; #g; #tex; #sprite;
  #wipe = 0; #wiping = false; #lastA = [0, 0]; #redraw = 0;

  constructor(parent, P, N) {
    // Planar texture coordinates: across the screen, and up it.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
    const U = [];
    for (let i = 0; i < P.length; i += 3) U.push((P[i] - x0) / (x1 - x0), (P[i + 1] - y0) / (y1 - y0));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = W; this.#canvas.height = H;
    this.#g = this.#canvas.getContext('2d');
    this.#tex = new THREE.CanvasTexture(this.#canvas);
    this.#tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.#tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    }));
    this.mesh.name = 'WindscreenRain';
    this.mesh.userData.windscreenRain = true; // other players' copies leave it out
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.#sprite = dropSprite();
  }

  /** Wipe it clean at once (a new world, the car wash). */
  clear() { this.drops.length = 0; this.splashes.length = 0; this.#redraw = 1; }

  /** The wipers are going. */
  get wiping() { return this.#wiping; }

  /**
   * @param {number} dt
   * @param {number} rain   0..1 (0 when the screen is sheltered or under water)
   * @param {number} speed  forward speed, m/s
   * @param {number} light  0..1 how bright it is (sky)
   * @param {boolean} [wet] under water: the screen is all water, no drops of note
   */
  update(dt, rain, speed, light) {
    const drops = this.drops;
    // New drops: more when driving into the rain.
    let n = rain * (220 + Math.max(0, speed) * 26) * dt;
    while (n > 0 && drops.length < 1800) {
      if (n < 1 && Math.random() > n) break;
      n -= 1;
      const x = Math.random() * W, y = Math.random() * H, r = 0.7 + Math.random() * 1.0;
      drops.push({ x, y, r, vx: 0, vy: 0, life: 1 });
      // It hit: a quick ring, and some of it scatters into droplets round about.
      this.splashes.push({ x, y, r, t: 0 });
      const bits = Math.random() < 0.75 ? 2 + Math.floor(Math.random() * 4) : 0;
      for (let k = 0; k < bits && drops.length < 1800; k++) {
        const a = Math.random() * Math.PI * 2, dist = 2.5 + Math.random() * 7;
        drops.push({ x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist * 0.8, r: 0.3 + Math.random() * 0.35, vx: 0, vy: 0, life: 1 });
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      this.splashes[i].t += dt;
      if (this.splashes[i].t > 0.2) this.splashes.splice(i, 1);
    }
    // Wipers: two blades from the bottom of the screen, sweeping up and back,
    // once every ~1.6 s in rain (a little faster in a downpour).
    if (rain > 0.05 || (this.#wiping && this.#wipe > 0)) this.#wiping = true;
    let a0 = 0, a1 = 0;
    if (this.#wiping) {
      const period = rain > 0.6 ? 1.2 : 1.7;
      const was = this.#wipe;
      this.#wipe += dt / period;
      if (this.#wipe >= 1) { this.#wipe = 0; if (rain <= 0.05) this.#wiping = false; }
      // A stroke starts at 0 (going up) and at 0.5 (coming back).
      if (this.#wiping && (was === 0 || (was < 0.5 && this.#wipe >= 0.5))) this.onStroke?.(period / 2);
      const t = this.#wipe;
      const s = t < 0.5 ? t * 2 : 2 - t * 2; // out and back
      const ang = (Math.sin((s - 0.5) * Math.PI) * 0.5 + 0.5) * 2.1; // 0 (resting along the bottom) .. 2.1 rad
      a0 = this.#lastA[0]; a1 = ang;
      this.#lastA[0] = ang;
    }
    const pivots = [[W * 0.2, H + 12], [W * 0.62, H + 12]], blade = W * 0.47;
    const airflow = Math.max(0, speed - 7) * 18; // px/s up the screen
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (airflow > 0) { d.vy = -airflow * (0.4 + d.r / 1.6); d.vx = (d.x - W / 2) / W * airflow * 0.8; }
      else if (d.r > 1.5) { d.vy = Math.min(80 * d.r / 2.2, d.vy + 50 * dt); d.vx = 0; } // big ones run down
      else { d.vy *= 0.9; d.vx *= 0.9; }
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (Math.random() < dt * 0.25 && d.r < 2.2) d.r += 0.12; // drops merge and grow
      if (rain <= 0.01) d.life -= dt / 40; // dry off slowly once it stops
      let gone = d.y < -4 || d.y > H + 4 || d.x < -4 || d.x > W + 4 || d.life <= 0;
      // Swept by a blade this frame?
      if (!gone && this.#wiping) {
        for (const [px, py] of pivots) {
          const dx = d.x - px, dy = py - d.y;
          const r = Math.hypot(dx, dy);
          if (r > blade) continue;
          const a = Math.atan2(dy, dx); // 0 = along the bottom to the right
          if (a >= Math.min(a0, a1) - 0.03 && a <= Math.max(a0, a1) + 0.03) { gone = true; break; }
        }
      }
      if (gone) drops.splice(i, 1);
    }
    this.mesh.visible = drops.length > 0 || this.#wiping;
    if (!this.mesh.visible) return;
    this.mesh.material.color.setScalar(0.25 + 0.75 * Math.min(1, light));
    // Draw (20 times a second is plenty, and keeps the texture uploads small).
    this.#redraw -= dt;
    if (this.#redraw > 0) return;
    this.#redraw = 1 / 20;
    const g = this.#g;
    g.clearRect(0, 0, W, H);
    for (const d of drops) {
      const s = d.r * 2;
      const stretch = Math.min(2.5, 1 + Math.abs(d.vy) / 120); // moving drops leave a streak
      g.globalAlpha = Math.min(1, d.life * 1.5);
      g.drawImage(this.#sprite, d.x - d.r, d.y - d.r * stretch, s, s * stretch);
    }
    // Where drops just landed: a ring opening out and fading.
    g.lineWidth = 1;
    for (const sp of this.splashes) {
      const k = sp.t / 0.2;
      g.strokeStyle = `rgba(225, 235, 245, ${0.5 * (1 - k)})`;
      g.beginPath(); g.ellipse(sp.x, sp.y, sp.r * (1.2 + 2.5 * k), sp.r * (1 + 2 * k), 0, 0, 7); g.stroke();
    }
    g.globalAlpha = 1;
    // The blades.
    if (this.#wiping) {
      g.strokeStyle = 'rgba(12, 12, 14, 0.95)';
      g.lineWidth = 16;
      g.lineCap = 'round';
      for (const [px, py] of pivots) {
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a1) * blade, py - Math.sin(a1) * blade);
        g.stroke();
      }
    }
    this.#tex.needsUpdate = true;
  }
}
