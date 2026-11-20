// The moon: a random phase each night. Full moon lights the land in cold blue
// and casts shadows; a crescent gives a little; a new moon leaves the night as
// dark as it is without one.
import * as THREE from 'three';

export const PHASES = [
  { name: '新月', en: 'New moon', icon: '🌑', lit: 0 },
  { name: '三日月', en: 'Crescent', icon: '🌒', lit: 0.18 },
  { name: '半月', en: 'Half moon', icon: '🌓', lit: 0.5 },
  { name: '十三夜', en: 'Gibbous', icon: '🌔', lit: 0.8 },
  { name: '満月', en: 'Full moon', icon: '🌕', lit: 1 },
];

const DISC_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

// A lit sphere seen face on: the terminator moves with the phase angle.
const DISC_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uPhase;   // 0 new .. PI full
uniform float uBright;
uniform float uFade;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  #include <logdepthbuf_fragment>
  float r2 = dot(vUv, vUv);
  // Halo around the disc.
  float halo = exp(-max(r2 - 0.25, 0.0) * 2.5) * 0.25 * uBright;
  vec3 col = vec3(0.6, 0.7, 0.9) * halo;
  float alpha = halo;
  if (r2 < 0.25) {
    vec2 p = vUv * 2.0;                     // unit disc
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))));
    vec3 L = vec3(sin(uPhase), 0.0, -cos(uPhase));
    float lit = smoothstep(-0.03, 0.06, dot(n, L));
    // Maria: darker patches.
    float maria = smoothstep(0.45, 0.7, noise(p * 2.3 + 3.1)) * 0.35 + noise(p * 9.0) * 0.12;
    float limb = 0.75 + 0.25 * n.z;
    vec3 surface = vec3(1.0, 0.98, 0.92) * (1.0 - maria) * limb;
    float earthshine = 0.035;
    col = surface * (lit * 9.0 + earthshine * 3.0) + col;
    alpha = 1.0;
  }
  gl_FragColor = vec4(col * uFade, alpha * uFade);
}`;

export class Moon {
  phase = PHASES[4];
  angle = Math.PI; // phase angle
  light;
  ambient;
  #disc;
  #dir = new THREE.Vector3();
  #night = 0;

  constructor(scene) {
    this.light = new THREE.DirectionalLight(0xaabbff, 0);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.00003;
    this.light.shadow.normalBias = 0.25;
    const c = this.light.shadow.camera;
    c.left = -90; c.right = 90; c.top = 90; c.bottom = -90; c.near = 1; c.far = 3000;
    scene.add(this.light, this.light.target);
    this.ambient = new THREE.HemisphereLight(0x8090c0, 0x202020, 0);
    scene.add(this.ambient);

    this.#disc = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: DISC_VERT, fragmentShader: DISC_FRAG,
        uniforms: { uPhase: { value: Math.PI }, uBright: { value: 1 }, uFade: { value: 0 } },
        transparent: true, depthWrite: false,
      }),
    );
    this.#disc.frustumCulled = false;
    this.#disc.renderOrder = -1;
    scene.add(this.#disc);
    this.randomize();
  }

  /** Pick tonight's moon: a phase and a place in the sky. */
  randomize() {
    const i = Math.floor(Math.random() * PHASES.length);
    this.phase = PHASES[i];
    // Phase angle from the lit fraction (waxing or waning at random).
    const a = Math.acos(1 - 2 * this.phase.lit);
    this.angle = Math.random() < 0.5 ? a : -a;
    const el = THREE.MathUtils.degToRad(25 + Math.random() * 35);
    const az = Math.random() * Math.PI * 2;
    this.#dir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    return this.phase;
  }

  /** For sharing tonight's moon with other players. */
  getState() { return { phase: PHASES.indexOf(this.phase), angle: this.angle, dir: this.#dir.toArray() }; }

  setState(st) {
    if (!st) return;
    this.phase = PHASES[st.phase] ?? this.phase;
    this.angle = Number(st.angle) || 0;
    if (Array.isArray(st.dir) && st.dir.length === 3) this.#dir.fromArray(st.dir.map(Number)).normalize();
  }

  /** Unit vector toward the moon (live; changes on randomize()). */
  get direction() { return this.#dir; }

  /** How much night it is (0 by day, 1 when the sun is well down). */
  get night() { return this.#night; }

  update(environment, camera) {
    const sunY = environment.sunDirection.y;
    const night = (this.#night = THREE.MathUtils.clamp((0.02 - sunY) / 0.12, 0, 1));
    const lit = this.phase.lit;
    const clouds = 1 - 0.75 * (environment.cloudCover ?? 0);
    // Brightness: proportional to the lit area, and a little more (full moon is opposition-surge bright).
    const b = Math.pow(lit, 1.3) * night;
    this.light.intensity = 5.5 * b * clouds;
    this.light.visible = this.light.intensity > 0.001;
    this.ambient.intensity = 1.3 * b * (0.6 + 0.4 * clouds);
    this.ambient.visible = this.ambient.intensity > 0.001;
    // Light and its shadow box follow the camera.
    const cam = camera.getWorldPosition(new THREE.Vector3());
    this.light.target.position.copy(cam);
    this.light.position.copy(cam).addScaledVector(this.#dir, 1500);
    // The disc: far away in the moon's direction, facing the camera, ~1.3° across.
    const dist = 20000;
    this.#disc.position.copy(cam).addScaledVector(this.#dir, dist);
    this.#disc.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
    this.#disc.scale.setScalar(dist * 0.07); // disc ~2° across (the real moon is 0.5°; this reads better on screen)
    const u = this.#disc.material.uniforms;
    // Lit fraction = (1 - cos angle) / 2; the sign picks waxing (right side lit) or waning.
    u.uPhase.value = this.angle;
    u.uBright.value = 0.3 + lit;
    u.uFade.value = night * clouds * (lit > 0 ? 1 : 0) * THREE.MathUtils.clamp(this.#dir.y * 10, 0, 1);
    this.#disc.visible = u.uFade.value > 0.001;
  }
}
