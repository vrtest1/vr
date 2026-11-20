// A dirty truck: mud, dust, snow and water on the body.
//
// DirtState keeps four amounts, 0..1, that change as we drive:
//   mud   thrown up by the tyres on wet earth (rain, or the soft ground at the
//         water's edge); thick low on the body, higher the muddier we get
//   dust  a pale film from dry earth and sand, all over, slowly
//   snow  packed into the wheel arches and along the sills on snow
//   wet   the body glistens after water or in rain, and dries off
// Driving into water washes it off (deep water at once, a ford from below).
//
// makeDirty() teaches a truck's materials to show them: an extra piece of
// shader on top of whatever the world already put there (sky, haze, water).
// The pattern lives in the truck's own space, so it rides along with it, and
// only on the outside (inside the cab and the bed stay clean).
import * as THREE from 'three';

const patched = new WeakSet();
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * How muddy the ground is under a tyre, 0..1.
 * @param {number} surface   0 earth/grass, 1 rock, 2 sand, 3 snow
 * @param {number} aboveWater  ground height over the water surface (m)
 * @param {number} rain      0..1
 */
export function mudAt(surface, aboveWater, rain) {
  if (surface !== 0) return 0;
  const bank = 1 - THREE.MathUtils.smoothstep(aboveWater, 0.3, 1.8); // soft ground by the water
  return clamp01(Math.max(bank, (rain - 0.15) / 0.5));
}

export class DirtState {
  mud = 0; dust = 0; snow = 0; wet = 0;
  #p = new THREE.Vector3();

  /**
   * @param {number} dt
   * @param {object} v       the Vehicle (wheels, speed, position, quaternion, submerged, spec)
   * @param {object} ground  height / water
   * @param {number} rain    0..1
   */
  update(dt, v, ground, rain) {
    const speed = Math.abs(v.speed);
    let mud = 0, dust = 0, snow = 0, ford = 0;
    for (const w of v.wheels) {
      const p = this.#p.set(w.local.x, w.local.y - w.length - v.spec.wheelRadius, w.local.z).applyQuaternion(v.quaternion).add(v.position);
      const water = ground.water(p.x, p.z);
      if (water > p.y + 0.15) { ford += 0.25; continue; } // tyre in the water
      if (!w.contact) continue;
      const work = Math.min(1.5, speed / 10) + Math.min(1, w.slip * 2);
      const muddy = mudAt(w.surface, ground.height(p.x, p.z) - water, rain);
      mud += 0.25 * work * muddy;
      dust += 0.25 * work * (w.surface === 2 ? 1.2 : w.surface === 0 ? 1 - muddy : w.surface === 1 ? 0.3 : 0) * (1 - rain);
      snow += 0.25 * work * (w.surface === 3 ? 1 : 0);
    }
    this.mud += dt * 0.07 * mud;     // ~15 s of hard driving in mud to be covered
    this.dust += dt * 0.012 * dust;  // a minute or two of dry tracks
    this.snow += dt * 0.06 * snow;
    // Washing: under water everything comes off within seconds; a ford
    // cleans from below; rain rinses the dust. Snow melts off slowly.
    const sub = v.submerged;
    if (sub > 0.05 || ford > 0) {
      const k = Math.min(1, sub * 3 + ford * 0.35 * Math.min(1, speed / 4 + 0.3));
      this.mud -= dt * 0.35 * k;
      this.dust -= dt * 0.5 * k;
      this.snow -= dt * 0.6 * k;
      this.wet = Math.max(this.wet, Math.min(1, sub * 4 + ford * 0.8));
    }
    this.dust -= dt * 0.02 * rain;
    this.mud -= dt * 0.004 * rain;
    if (snow === 0) this.snow -= dt * 0.008;
    this.wet = Math.max(this.wet - dt / 25, rain * 0.8);
    this.mud = clamp01(this.mud); this.dust = clamp01(this.dust); this.snow = clamp01(this.snow); this.wet = clamp01(this.wet);
  }

  /** For the wire: four 4-bit amounts in one integer. */
  pack() {
    const q = (x) => Math.round(x * 15);
    return q(this.mud) | (q(this.dust) << 4) | (q(this.snow) << 8) | (q(this.wet) << 12);
  }

  /** Move smoothly towards a packed state from another player. */
  follow(n, dt) {
    const k = Math.min(1, dt * 3);
    const u = (s) => ((n >> s) & 15) / 15;
    this.mud += (u(0) - this.mud) * k;
    this.dust += (u(4) - this.dust) * k;
    this.snow += (u(8) - this.snow) * k;
    this.wet += (u(12) - this.wet) * k;
  }

  clean() { this.mud = this.dust = this.snow = this.wet = 0; }
}

const DIRT_GLSL = /* glsl */ `
  float pwdHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float pwdNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(pwdHash(i), pwdHash(i + vec3(1, 0, 0)), f.x), mix(pwdHash(i + vec3(0, 1, 0)), pwdHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(pwdHash(i + vec3(0, 0, 1)), pwdHash(i + vec3(1, 0, 1)), f.x), mix(pwdHash(i + vec3(0, 1, 1)), pwdHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

/**
 * Make a truck's materials show its dirt. Call after the world's own
 * applyToObject calls. Returns { state, update(root) } (call update every
 * frame, after the root has been moved).
 * @param {THREE.Object3D} root
 * @param {{ min: THREE.Vector3, max: THREE.Vector3 }} box  the body's extent in the root's own space
 * @param {DirtState} [state]
 */
export function makeDirty(root, box, state = new DirtState()) {
  const u = {
    uDirt: { value: new THREE.Vector4() },
    uDirtY: { value: new THREE.Vector2(box.min.y, box.max.y) },
    uDirtInv: { value: new THREE.Matrix4() },
  };
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isLamp) return;
    for (const m of [].concat(o.material)) {
      // (A WeakSet, not userData: a clone copies userData but not onBeforeCompile.)
      if (!m.isMeshStandardMaterial || /glass/i.test(m.name) || patched.has(m)) continue;
      patched.add(m);
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer);
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uDirtInv;\nvarying vec3 vDirtPos;\nvarying vec3 vDirtNrm;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            vDirtPos = (uDirtInv * modelMatrix * vec4(transformed, 1.0)).xyz;
            vDirtNrm = normalize(mat3(uDirtInv * modelMatrix) * objectNormal);`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform vec4 uDirt; uniform vec2 uDirtY;
            varying vec3 vDirtPos; varying vec3 vDirtNrm;
            float dirtMud = 0.0, dirtDust = 0.0, dirtSnow = 0.0;
            ${DIRT_GLSL}`)
          .replace('#include <map_fragment>', `#include <map_fragment>
            {
              float n = pwdNoise(vDirtPos * 3.1) * 0.6 + pwdNoise(vDirtPos * 11.0) * 0.4;
              float hgt = clamp((vDirtPos.y - uDirtY.x) / (uDirtY.y - uDirtY.x), 0.0, 1.0);
              vec3 nr = normalize(vDirtNrm);
              // Outside only: faces looking away from the middle, or down.
              float outside = max(smoothstep(0.05, 0.35, dot(normalize(vDirtPos.xz + 1e-4), nr.xz)), step(nr.y, -0.5));
              float mudLine = uDirt.x * 0.62;
              dirtMud = (1.0 - smoothstep(mudLine - 0.12, mudLine + 0.03, hgt + (n - 0.5) * 0.3)) * smoothstep(0.18, 0.5, n + uDirt.x * 0.5) * step(0.004, uDirt.x) * outside;
              dirtDust = clamp(uDirt.y * (0.5 + 0.5 * (1.0 - hgt)) * (0.6 + 0.8 * n), 0.0, 1.0) * mix(0.5, 1.0, outside);
              float snowLine = uDirt.z * 0.42;
              dirtSnow = (1.0 - smoothstep(snowLine - 0.1, snowLine + 0.02, hgt + (n - 0.5) * 0.25)) * step(0.004, uDirt.z) * outside;
              // (Colours are linear: sRGB mud 0.3/0.22/0.14, dust 0.66/0.58/0.46.)
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.22, 0.13), dirtDust * 0.85);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.042, 0.018), dirtMud * 0.95);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.89, 0.96), dirtSnow * 0.92);
              diffuseColor.rgb *= 1.0 - 0.22 * uDirt.w * (1.0 - dirtSnow); // wet paint looks deeper
            }`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor = mix(roughnessFactor, 0.97, max(dirtMud, max(dirtDust * 0.8, dirtSnow)));
            roughnessFactor = mix(roughnessFactor, 0.12, uDirt.w * 0.85 * (1.0 - dirtSnow));`)
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
            metalnessFactor *= 1.0 - max(dirtMud, max(dirtSnow, dirtDust * 0.6));`);
      };
      const key = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => (key ? key() : '') + '|dirt';
      m.needsUpdate = true;
    }
  });
  return {
    state,
    update(r = root) {
      r.updateMatrixWorld();
      u.uDirtInv.value.copy(r.matrixWorld).invert();
      u.uDirt.value.set(state.mud, state.dust, state.snow, state.wet);
    },
  };
}
