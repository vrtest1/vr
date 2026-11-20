// Small visual extras around the truck: dust and spray, a contact shadow,
// headlights, and a sky reflection for the paint.
import * as THREE from 'three';

// --- dust and spray ----------------------------------------------------------

const DUST_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aAge;     // 0..1, >= 1 is dead
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying float vAge;
varying vec3 vColor;
void main() {
  vAge = aAge;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float grow = 0.35 + 1.4 * sqrt(aAge);
  gl_PointSize = aAge >= 1.0 ? 0.0 : aSize * grow * uScale / max(-mv.z, 0.1);
  #include <logdepthbuf_vertex>
}`;

const DUST_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uLight;
varying float vAge;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r) * (1.0 - vAge) * (1.0 - vAge) * 0.4;
  gl_FragColor = vec4(vColor * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Dust {
  #n; #pos; #vel; #age; #life; #size; #color; #fall; #geo; #next = 0;
  points;
  material;

  constructor(count = 900) {
    this.#n = count;
    this.#pos = new Float32Array(count * 3);
    this.#vel = new Float32Array(count * 3);
    this.#age = new Float32Array(count).fill(1);
    this.#life = new Float32Array(count).fill(1);
    this.#size = new Float32Array(count);
    this.#color = new Float32Array(count * 3);
    this.#fall = new Float32Array(count);
    const g = (this.#geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.#pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.#age, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.#size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.#color, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /**
   * Emit one puff at `p` drifting with velocity `v`. `fall` (m/s² down):
   * by default light colours (water spray) fall and dark ones (dust) linger;
   * mud clumps and big splashes pass their own.
   */
  emit(p, v, size, life, r, gc, b, fall = r > 0.8 ? 1.5 : -0.25) {
    const i = this.#next;
    this.#next = (i + 1) % this.#n;
    this.#pos.set([p.x, p.y, p.z], i * 3);
    this.#vel.set([v.x, v.y, v.z], i * 3);
    this.#age[i] = 0;
    this.#life[i] = life;
    this.#size[i] = size;
    this.#color.set([r, gc, b], i * 3);
    this.#fall[i] = fall;
  }

  update(dt, wind, camera, renderer) {
    const pos = this.#pos, vel = this.#vel;
    for (let i = 0; i < this.#n; i++) {
      if (this.#age[i] >= 1) continue;
      this.#age[i] = Math.min(1, this.#age[i] + dt / this.#life[i]);
      const k = Math.exp(-2.2 * dt);
      const j = i * 3;
      vel[j] = vel[j] * k + wind.x * (1 - k);
      vel[j + 1] = vel[j + 1] * k - this.#fall[i] * dt; // spray and mud fall, dust lingers
      vel[j + 2] = vel[j + 2] * k + wind.z * (1 - k);
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
    }
    for (const name of ['position', 'aAge', 'aSize', 'aColor']) this.#geo.attributes[name].needsUpdate = true;
    const h = renderer.domElement.height;
    this.material.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }
}

// --- things drawn on the ground ---------------------------------------------
//
// The visible terrain is a triangle mesh between height samples, so it can sit
// a few centimetres above the true height that a decal is placed at; and the
// logarithmic depth buffer ignores polygonOffset. So decals are pulled toward
// the camera in the vertex shader by a little more than that error.

const DECAL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aAlpha;
attribute float aTime;
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying float vTime;
varying vec3 vColor;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vTime = aTime;
  vColor = aColor;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 toCam = cameraPosition - wp.xyz;
  float d = length(toCam);
  wp.xyz += toCam / max(d, 1e-3) * (0.12 + d * 0.004);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const DECAL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform float uUseMap;
uniform float uOpacity;
uniform float uNow;
uniform float uLife;
varying vec2 vUv;
varying float vAlpha;
varying float vTime;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float a = uOpacity * vAlpha;
  if (uUseMap > 0.5) a *= texture2D(uMap, vUv).a;
  else {
    // Tyre strip: soft edges across, a faint tread pattern along.
    float across = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 3.0);
    float tread = 0.8 + 0.2 * step(0.5, fract(vUv.y * 6.0));
    a *= across * tread;
  }
  if (uLife > 0.0) a *= 1.0 - smoothstep(uLife * 0.6, uLife, uNow - vTime);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}`;

function decalMaterial({ map = null, opacity = 1, life = 0 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    uniforms: {
      uMap: { value: map }, uUseMap: { value: map ? 1 : 0 }, uOpacity: { value: opacity },
      uNow: { value: 0 }, uLife: { value: life },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function makeContactShadow(width, length) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 64, 4, 32, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(width * 1.25, length * 1.12).rotateX(-Math.PI / 2);
  const n = geo.attributes.position.count;
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  geo.setAttribute('aTime', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mesh = new THREE.Mesh(geo, decalMaterial({ map: tex, opacity: 0.6 }));
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Tyre tracks and skid marks: one strip per wheel, laid down as the truck
 * moves, kept in a ring buffer and fading out after `life` seconds.
 * Ruts are deepest in sand and snow, faint on rock; sliding adds dark rubber.
 */
export class TireTracks {
  mesh;
  #max; #pos; #uv; #alpha; #time; #color; #geo; #next = 0; #now = 0;
  #last = [null, null, null, null];

  constructor(maxQuads = 8000, life = 120) {
    this.#max = maxQuads;
    const v = maxQuads * 4;
    this.#pos = new Float32Array(v * 3);
    this.#uv = new Float32Array(v * 2);
    this.#alpha = new Float32Array(v);
    this.#time = new Float32Array(v).fill(-1e9);
    this.#color = new Float32Array(v * 3);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
    const g = (this.#geo = new THREE.BufferGeometry());
    const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this.#pos, 3));
    g.setAttribute('uv', dyn(this.#uv, 2));
    g.setAttribute('aAlpha', dyn(this.#alpha, 1));
    g.setAttribute('aTime', dyn(this.#time, 1));
    g.setAttribute('aColor', dyn(this.#color, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, decalMaterial({ opacity: 1, life }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Forget where each wheel was (after a reset), so no strip joins across the jump. */
  break() { this.#last = [null, null, null, null]; }

  /** Wipe every mark (a new world: the old ruts would float over new ground). */
  clear() {
    this.break();
    this.#alpha.fill(0);
    this.#geo.getAttribute('aAlpha').needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {Vehicle} vehicle
   * @param {object} ground  height / normal / water
   * @param {number} wetness 0..1 (rain darkens and deepens ruts)
   */
  update(dt, vehicle, ground, wetness = 0) {
    this.#now += dt;
    this.mesh.material.uniforms.uNow.value = this.#now;
    const q = vehicle.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const n = new THREE.Vector3();
    const s = vehicle.spec;
    let dirty = false;
    vehicle.wheels.forEach((w, i) => {
      if (!w.contact) { this.#last[i] = null; return; }
      const p = new THREE.Vector3(w.local.x, w.local.y - w.length - s.wheelRadius, w.local.z).applyQuaternion(q).add(vehicle.position);
      const h = ground.height(p.x, p.z);
      if (h < ground.water(p.x, p.z) - 0.05) { this.#last[i] = null; return; }
      p.y = h;
      ground.normal(p.x, p.z, n);
      const a = w.front ? vehicle.steerAngle : 0;
      const wf = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, -Math.sin(a));
      const side = new THREE.Vector3().crossVectors(wf, n).normalize().multiplyScalar(s.wheelWidth * 0.48);
      const last = this.#last[i];
      if (!last) { this.#last[i] = { p, side, v: 0 }; return; }
      const step = p.distanceTo(last.p);
      if (step < 0.35) return;
      if (step > 3) { this.#last[i] = { p, side, v: 0 }; return; }
      // How visible: the ground (sand / snow deep, rock faint), plus rubber when sliding.
      const surf = w.surface;
      const rut = surf === 2 ? 0.5 : surf === 3 ? 0.55 : surf === 1 ? 0.06 : 0.3;
      const skid = Math.min(1, Math.max(0, w.slip - 0.15) * 1.6);
      const alpha = Math.min(0.85, rut * (1 + wetness * 0.4) + skid * 0.55);
      // Colour: darkened ground for ruts, near-black for rubber.
      const base = surf === 2 ? [0.42, 0.36, 0.26] : surf === 3 ? [0.55, 0.58, 0.64] : surf === 1 ? [0.2, 0.2, 0.2] : [0.18, 0.15, 0.1];
      // Sliding: black rubber on rock, torn-up dark earth elsewhere, churned slush on snow.
      const scuff = surf === 1 ? [0.03, 0.03, 0.03] : surf === 3 ? [0.32, 0.33, 0.36] : surf === 2 ? [0.3, 0.25, 0.17] : [0.09, 0.07, 0.04];
      const col = base.map((c, j) => c * (1 - skid) + scuff[j] * skid);
      const v1 = last.v + step / (s.wheelRadius * 2 * Math.PI) * 3;
      const k = this.#next;
      this.#next = (k + 1) % this.#max;
      const o = k * 4;
      const put = (j, pt, sd, sign, u, v, al) => {
        this.#pos.set([pt.x + sd.x * sign, pt.y + sd.y * sign, pt.z + sd.z * sign], (o + j) * 3);
        this.#uv.set([u, v], (o + j) * 2);
        this.#alpha[o + j] = al;
        this.#time[o + j] = this.#now;
        this.#color.set(col, (o + j) * 3);
      };
      put(0, last.p, last.side, -1, 0, last.v, last.alpha ?? alpha);
      put(1, last.p, last.side, 1, 1, last.v, last.alpha ?? alpha);
      put(2, p, side, -1, 0, v1, alpha);
      put(3, p, side, 1, 1, v1, alpha);
      this.#last[i] = { p, side, v: v1 % 1000, alpha };
      dirty = true;
    });
    if (dirty) for (const name of ['position', 'uv', 'aAlpha', 'aTime', 'aColor']) this.#geo.attributes[name].needsUpdate = true;
  }
}

// --- sky reflection for the paint ------------------------------------------------

export class SkyReflection {
  #pmrem; #scene; #mat; #target = null; #timer = 0;
  texture = null;

  constructor(renderer) {
    this.#pmrem = new THREE.PMREMGenerator(renderer);
    this.#scene = new THREE.Scene();
    this.#mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop, uHorizon, uGround, uSun, uSunDir; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir);
          vec3 c = d.y > 0.0 ? mix(uHorizon, uTop, pow(d.y, 0.5)) : mix(uHorizon * 0.6, uGround, smoothstep(0.0, 0.25, -d.y));
          c += uSun * pow(max(dot(d, uSunDir), 0.0), 600.0) + uSun * 0.04 * pow(max(dot(d, uSunDir), 0.0), 8.0);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.#scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.#mat));
  }

  /** Rebuild about once a second from the lights the atmosphere computed. */
  update(dt, atmosphere, environment, force = false) {
    this.#timer -= dt;
    if (this.#timer > 0 && !force && this.texture) return;
    this.#timer = 1.0;
    const sky = atmosphere.skyLight, sun = atmosphere.sunLight;
    if (!sky || !sun) return;
    const u = this.#mat.uniforms;
    const skyE = sky.intensity;
    u.uTop.value.copy(sky.color).multiplyScalar(skyE * 0.9);
    u.uHorizon.value.copy(sky.color).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(skyE * 1.15);
    u.uGround.value.setRGB(0.18, 0.17, 0.12).multiplyScalar(skyE + sun.intensity * 0.1 * Math.max(0, environment.sunDirection.y));
    u.uSun.value.copy(sun.color).multiplyScalar(sun.intensity * (environment.sunDirection.y > -0.02 ? 1 : 0));
    u.uSunDir.value.copy(environment.sunDirection);
    const old = this.#target;
    this.#target = this.#pmrem.fromScene(this.#scene, 0.02);
    this.texture = this.#target.texture;
    old?.dispose();
  }
}

// --- light from the rear lamps on the ground ----------------------------------
// Brake and reversing lamps at night colour the ground behind the truck. Not
// a three.js light (each of those costs a little on every pixel of the whole
// scene): a patch of ground behind the truck, re-fitted to the terrain each
// frame, drawn additively with the light a lamp at that spot would give
// (inverse square, aimed backwards) on ground of ordinary brightness.

const GLOW_VERT = /* glsl */ `
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

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uLamp;     // where the light comes from (world)
uniform vec3 uDir;      // which way it shines (world, unit)
uniform vec3 uColor;    // colour x intensity (candela)
uniform float uRange;   // m
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 L = vWorld - uLamp;
  float d = length(L);
  float aim = smoothstep(-0.1, 0.7, dot(L / d, uDir));
  float fall = (1.0 - smoothstep(uRange * 0.5, uRange, d)) / max(d * d, 0.25);
  float cosIn = clamp(-L.y / d, 0.0, 1.0); // light comes down at a slant
  // Ground of albedo ~0.25, lit: albedo / pi x illuminance.
  vec3 c = uColor * (0.25 * RECIPROCAL_PI * aim * fall * (0.3 + 0.7 * cosIn));
  if (max(c.r, max(c.g, c.b)) < 1e-4) discard;
  gl_FragColor = vec4(c, 1.0);
}`;

export class LampGlow {
  mesh;
  #geo; #pos; #n;
  /** @param {number} length  how far back the patch reaches (m)  @param {number} width (m) */
  constructor(length = 8, width = 7, cells = 8) {
    this.length = length;
    this.width = width;
    this.#n = cells + 1;
    const geo = new THREE.PlaneGeometry(1, 1, cells, cells);
    this.#geo = geo;
    this.#pos = geo.attributes.position;
    this.#pos.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: {
        uLamp: { value: new THREE.Vector3() },
        uDir: { value: new THREE.Vector3(0, 0, 1) },
        uColor: { value: new THREE.Color(0, 0, 0) },
        uRange: { value: length },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * @param {THREE.Vector3} lamp   world position of the rear lamps
   * @param {THREE.Vector3} back   world direction straight back from the truck
   * @param {THREE.Color} color    colour x intensity (candela); black hides it
   * @param {object} ground        { height(x, z) }
   */
  update(lamp, back, color, ground) {
    const on = Math.max(color.r, color.g, color.b) > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.mesh.material.uniforms;
    u.uLamp.value.copy(lamp);
    u.uDir.value.copy(back);
    u.uColor.value.copy(color);
    // Fit the patch to the ground: it starts just under the bumper and fans
    // backwards; its edges are where the light has faded anyway.
    const fx = back.x, fz = back.z, fl = Math.hypot(fx, fz) || 1;
    const bx = fx / fl, bz = fz / fl, sx = -bz, sz = bx;
    const n = this.#n, pos = this.#pos;
    for (let j = 0; j < n; j++) {
      const along = (j / (n - 1)) * this.length - 0.6;
      for (let i = 0; i < n; i++) {
        const across = (i / (n - 1) - 0.5) * this.width;
        const x = lamp.x + bx * along + sx * across;
        const z = lamp.z + bz * along + sz * across;
        pos.setXYZ(j * n + i, x, ground.height(x, z), z);
      }
    }
    pos.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.#geo.dispose();
    this.mesh.material.dispose();
  }
}
