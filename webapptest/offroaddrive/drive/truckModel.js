// The truck's picture: a glTF model when one is configured, otherwise a
// simple stand-in built from boxes. Either way the result is
//   { root, wheels: [Object3D x4 | null], fit }
// where `root` sits at the centre of mass in the vehicle's body frame
// (+X right, +Y up, -Z forward) and `wheels` are pivots at the wheel centres
// in the order front-left, front-right, rear-left, rear-right.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Model settings (models/truck.json):
 *   url          path to the .gltf / .glb, relative to drive/
 *   yaw          extra turn (degrees) so the nose points to -Z
 *   length       scale the model to this overall length (m); 0 keeps its size
 *   wheels       { fl, fr, rl, rr }: node names of the four wheels (optional;
 *                otherwise found by name or by position)
 *   lift         raise the body (m) relative to the computed fit
 */
export async function loadTruck(spec, config) {
  if (!config?.url) return buildStandIn(spec);
  const gltf = await new GLTFLoader().loadAsync(new URL(config.url, import.meta.url).href);
  return fitModel(gltf.scene, spec, config);
}

const WHEEL_NAME = /wheel|tire|tyre|rim|rueda|roue|rad\b/i;

function fitModel(scene, spec, config) {
  const model = new THREE.Group();
  model.add(scene);
  scene.rotation.y = THREE.MathUtils.degToRad(config.yaw ?? 0);
  scene.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = config.length ? config.length / size.z : 1;
  scene.scale.multiplyScalar(scale);
  scene.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(scene);

  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });

  // Wheels: by name from the config, else by name pattern, grouped by quadrant.
  const centre = box.getCenter(new THREE.Vector3());
  const found = { fl: [], fr: [], rl: [], rr: [] };
  const named = config.wheels ?? {};
  for (const key of Object.keys(found)) {
    const names = [].concat(named[key] ?? []);
    for (const n of names) {
      const o = scene.getObjectByName(n);
      if (o) found[key].push(o);
    }
  }
  if (!Object.values(found).some((a) => a.length)) {
    const candidates = [];
    scene.traverse((o) => { if (o.isMesh && WHEEL_NAME.test(o.name + ' ' + (o.parent?.name ?? ''))) candidates.push(o); });
    for (const o of candidates) {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const key = (c.z < centre.z ? 'f' : 'r') + (c.x < centre.x ? 'l' : 'r');
      found[key].push(o);
    }
  }

  // Wheel centres and radius from the wheel meshes.
  const wheelInfo = {};
  for (const [key, list] of Object.entries(found)) {
    if (!list.length) continue;
    const b = new THREE.Box3();
    for (const o of list) b.expandByObject(o);
    wheelInfo[key] = { centre: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()), list };
  }
  const haveWheels = Object.keys(wheelInfo).length === 4;

  // Fit: put the model so its wheel centres land on the vehicle's wheel positions.
  const fit = {};
  if (haveWheels) {
    const w = wheelInfo;
    const front = (w.fl.centre.z + w.fr.centre.z) / 2, rear = (w.rl.centre.z + w.rr.centre.z) / 2;
    fit.wheelbase = rear - front;
    fit.track = ((w.fr.centre.x - w.fl.centre.x) + (w.rr.centre.x - w.rl.centre.x)) / 2;
    fit.wheelRadius = Object.values(w).reduce((a, i) => a + i.size.y, 0) / 8;
    fit.wheelWidth = Object.values(w).reduce((a, i) => a + i.size.x, 0) / 4;
    fit.axleY = Object.values(w).reduce((a, i) => a + i.centre.y, 0) / 4;
    fit.axleZ = (front + rear) / 2;
  } else {
    fit.wheelbase = spec.wheelbase; fit.track = spec.track; fit.wheelRadius = spec.wheelRadius;
    fit.axleY = box.min.y + spec.wheelRadius; fit.axleZ = centre.z;
  }
  fit.size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  fit.bodyTopAboveAxle = box.max.y - fit.axleY;
  fit.bodyBottomAboveAxle = box.min.y - fit.axleY;
  fit.frontOverhang = fit.axleZ - box.min.z;

  // Centre of mass: about 0.55 m above the axles, between them, a bit forward (engine).
  const comY = fit.axleY + 0.4 + (config.lift ?? 0);
  const comZ = fit.axleZ - 0.12 * fit.wheelbase;
  fit.comAboveAxle = 0.4;
  fit.comAhead = 0.12 * fit.wheelbase;
  scene.position.x -= centre.x;
  scene.position.y -= comY;
  scene.position.z -= comZ;
  scene.updateMatrixWorld(true);

  // Wheel pivots: re-parent each wheel's meshes under a pivot at its centre.
  const wheels = [];
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    const info = wheelInfo[key];
    if (!info || !haveWheels) { wheels.push(null); continue; }
    const pivot = new THREE.Group();
    pivot.position.set(info.centre.x - centre.x, info.centre.y - comY, info.centre.z - comZ);
    const spin = new THREE.Group();
    pivot.add(spin);
    model.add(pivot);
    model.updateMatrixWorld(true);
    for (const o of info.list) spin.attach(o);
    pivot.userData.rest = pivot.position.clone();
    wheels.push(pivot);
  }
  addLamps(scene, config.lamps);
  const steering = config.steeringWheel ? extractSteeringWheel(scene, config.steeringWheel) : null;
  return { root: model, wheels, fit, haveWheels, steering };
}

// --- steering wheel -----------------------------------------------------------
// The model's steering wheel is part of the body mesh. Cut it out (the
// connected pieces around `near`, in that mesh's own coordinates), put it on a
// pivot at its centre, and turn it about its column: the axis is the ring's
// thinnest direction, pointing back at the driver.

function extractSteeringWheel(scene, cfg) {
  const near = new THREE.Vector3(...cfg.near);
  const reach = cfg.reach ?? 0.12;
  let made = null;
  scene.traverse((o) => {
    if (made || !o.isMesh || o.userData.isLamp || !o.geometry.index) return;
    if (cfg.material && o.material?.name !== cfg.material) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    // Weld by position so seams in the UVs don't split a part in two.
    const ids = new Map(), weld = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (!ids.has(k)) ids.set(k, ids.size);
      weld[i] = ids.get(k);
    }
    const parent = Int32Array.from({ length: ids.size }, (_, i) => i);
    const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
    for (let t = 0; t < idx.count; t += 3) {
      const a = find(weld[idx.getX(t)]);
      parent[find(weld[idx.getX(t + 1)])] = a;
      parent[find(weld[idx.getX(t + 2)])] = a;
    }
    // Pieces: bounding boxes per root.
    const boxes = new Map();
    for (let t = 0; t < idx.count; t++) {
      const v = idx.getX(t), r = find(weld[v]);
      let b = boxes.get(r);
      if (!b) boxes.set(r, (b = new THREE.Box3()));
      b.expandByPoint(_v3.fromBufferAttribute(pos, v));
    }
    const keep = new Set();
    for (const [r, b] of boxes) {
      const size = b.getSize(_v3).length();
      if (b.getCenter(_v3).distanceTo(near) < reach && size < (cfg.maxSize ?? 0.6)) keep.add(r);
    }
    if (!keep.size) return;
    // Split the index: the wheel's triangles leave the body.
    const body = [], wheel = [];
    for (let t = 0; t < idx.count; t += 3) {
      const list = keep.has(find(weld[idx.getX(t)])) ? wheel : body;
      list.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    }
    // Centre and axis. The spokes and hub sit to one side, so the average of
    // all vertices is off centre; the rim is what turns true. So: a first axis
    // from all vertices (covariance, smallest spread), then keep the rim (the
    // outermost vertices around that axis), and take the axis and the centre
    // again from the rim alone: its plane, and the middle of its circle.
    const used = [...new Set(wheel)];
    const pts = used.map((v) => new THREE.Vector3().fromBufferAttribute(pos, v));
    const fitAxis = (list, centre) => {
      const cov = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
      for (const p of list) {
        const x = p.x - centre.x, y = p.y - centre.y, z = p.z - centre.z;
        cov[0] += x * x; cov[1] += x * y; cov[2] += x * z; cov[3] += y * y; cov[4] += y * z; cov[5] += z * z;
      }
      return smallestEigenvector(cov);
    };
    const mean = (list) => list.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(list.length);
    let c = mean(pts);
    let axis = fitAxis(pts, c);
    let rim = pts;
    for (let pass = 0; pass < 3; pass++) {
      // In-plane basis.
      const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.9 ? _v3.set(0, 1, 0) : _v3.set(1, 0, 0)).normalize();
      const w = new THREE.Vector3().crossVectors(axis, u);
      // Circle centre: the middle of the rim's extent in that plane (a ring's
      // bounding square is centred on it whatever the spokes do).
      let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
      for (const p of rim) {
        const du = _v3.subVectors(p, c).dot(u), dw = _v3.subVectors(p, c).dot(w);
        u0 = Math.min(u0, du); u1 = Math.max(u1, du); w0 = Math.min(w0, dw); w1 = Math.max(w1, dw);
      }
      const along = rim.reduce((a, p) => a + _v3.subVectors(p, c).dot(axis), 0) / rim.length;
      c = c.clone().addScaledVector(u, (u0 + u1) / 2).addScaledVector(w, (w0 + w1) / 2).addScaledVector(axis, along);
      // The rim: vertices out past 75 % of the largest radius.
      const radius = (p) => { const d = _v3.subVectors(p, c); return Math.hypot(d.dot(u), d.dot(w)); };
      const rMax = pts.reduce((m, p) => Math.max(m, radius(p)), 0);
      rim = pts.filter((p) => radius(p) > rMax * 0.75);
      axis = fitAxis(rim, mean(rim));
    }
    if (axis.dot(_v3.set(0, 0, 1)) < 0) axis.negate(); // toward the driver (+Z is back)
    const wheelGeo = g.clone();
    wheelGeo.setIndex(wheel);
    wheelGeo.translate(-c.x, -c.y, -c.z);
    g.setIndex(body);
    const mesh = new THREE.Mesh(wheelGeo, o.material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'SteeringWheelMesh';
    const pivot = new THREE.Group();
    pivot.name = 'SteeringWheel';
    pivot.position.copy(c);
    pivot.userData.axis = axis.toArray();
    // How far the wheel on screen turns at full lock, each way. A real truck
    // goes 1.75 turns (lock to lock 3.5), but on a pad or keys that spins it
    // round in a blink, so like most racing games it shows less (half a turn).
    pivot.userData.ratio = ((cfg.visualTurns ?? 0.5) * 2 * Math.PI) / (cfg.maxSteer ?? 0.6);
    pivot.userData.angle = 0;
    pivot.add(mesh);
    o.add(pivot);
    made = pivot;
  });
  return made;
}

/** Smallest-eigenvalue eigenvector of a symmetric 3x3 (Jacobi). */
function smallestEigenvector([xx, xy, xz, yy, yz, zz]) {
  const a = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 20; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-12) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const cs = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = cs * vkp - sn * vkq; v[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  let i = 0;
  if (a[1][1] < a[i][i]) i = 1;
  if (a[2][2] < a[i][i]) i = 2;
  return new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize();
}

const _v3 = new THREE.Vector3();
const _axis = new THREE.Vector3();

/** Turn a truck's steering wheel (ours or a copy) for this road-wheel angle (rad, + = left). */
export function poseSteeringWheel(root, steerAngle, pivot = null) {
  if (!pivot) {
    // Looked up once per truck (not in userData: clone() copies that).
    if (!steeringPivots.has(root)) {
      let found = null;
      root.traverse((o) => { if (o.name === 'SteeringWheel') found = o; });
      steeringPivots.set(root, found);
    }
    pivot = steeringPivots.get(root);
  }
  if (!pivot) return;
  // Eased toward the target so it turns like hands on a wheel, not a snap.
  const target = steerAngle * pivot.userData.ratio;
  pivot.userData.angle += (target - pivot.userData.angle) * 0.25;
  pivot.quaternion.setFromAxisAngle(_axis.fromArray(pivot.userData.axis), pivot.userData.angle);
}
const steeringPivots = new WeakMap();

/** Set the steering wheel straight to an angle (rad, + = turned left): wheel controllers. */
export function setSteeringWheelAngle(pivot, angle) {
  pivot.userData.angle = angle;
  pivot.quaternion.setFromAxisAngle(_axis.fromArray(pivot.userData.axis), angle);
}

// --- lamps ------------------------------------------------------------------
// The model's lamps are part of its glass, painted into the glass texture:
// at the back red lenses with grey squares (reversing lamps) in them, at the
// front clear headlamp lenses with amber indicators. The glass triangles at
// the very back and front are copied into a thin glowing skin laid over the
// lenses. Its shader reads the same texture, so the red parts light up for
// the brakes, the grey squares for reversing, and the clear front glass with
// the headlights. Kinds: 0 rear cluster, 1 brake only (roof), 2 front.

const LAMP_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aKind;
varying vec2 vUv;
varying float vKind;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vKind = aKind;
  vLocal = position;
  vec3 p = position + normal * 0.004; // just in front of the lens
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;
const LAMP_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform float uBrake;    // brake lamps, 0..1
uniform float uTail;     // tail lamps (with the headlights), 0..1
uniform float uReverse;  // reversing lamps, 0..1
uniform float uHead;     // headlamps, 0..1
uniform float uLens;     // how much the headlamp glass itself glows (the bulbs light the reflectors)
uniform vec3 uBulb[2];   // headlamp bulbs, mesh space
uniform float uSpot;     // size of the bright patch on the glass in front of a bulb (m)
uniform vec3 uRear[2];   // middle of the left and right rear lamps, mesh space
uniform vec2 uRearSpot;  // size of their bright patch across and up (m)
uniform float uGain;
varying vec2 vUv;
varying float vKind;
varying vec3 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  vec3 t = texture2D(map, vUv).rgb;
  vec3 c;
  if (vKind > 1.5) {
    // Front: clear glass is the headlamp; amber is the indicator, which
    // glows faintly as a parking lamp.
    float amber = smoothstep(0.06, 0.2, t.r - t.b);
    // Brightest straight in front of the bulb, dim towards the edge of the glass.
    float d = min(distance(vLocal.xy, uBulb[0].xy), distance(vLocal.xy, uBulb[1].xy));
    float hot = exp(-pow(d / uSpot, 2.0));
    c = vec3(1.0, 0.96, 0.86) * (1.0 - amber) * uHead * (0.9 + 0.5 * t.g) * uLens * (0.15 + 2.5 * hot)
      + vec3(1.0, 0.35, 0.02) * amber * uHead * 0.12;
  } else {
    float red = smoothstep(0.06, 0.2, t.r - max(t.g, t.b));
    float lens = (1.0 - red) * (1.0 - vKind);
    // A bulb behind the middle of each rear lamp: brighter there, darker at the ends.
    vec2 d0 = (vLocal.xy - uRear[0].xy) / uRearSpot, d1 = (vLocal.xy - uRear[1].xy) / uRearSpot;
    float hot = exp(-min(dot(d0, d0), dot(d1, d1)));
    float shape = vKind > 0.5 ? 1.0 : 0.45 + 1.1 * hot;
    c = vec3(1.0, 0.012, 0.006) * red * (0.5 + 0.8 * t.r) * (uBrake + 0.18 * uTail) * shape
      + vec3(1.0, 0.97, 0.9) * lens * uReverse * (0.7 + 0.5 * hot);
  }
  gl_FragColor = vec4(c * uGain, 1.0);
}`;

const _p = new THREE.Vector3();

/** Read a texture's colour at a uv (0..255 rgb), from a small copy of it. */
function sampler(texture) {
  const img = texture?.image;
  if (!img?.width || typeof document === 'undefined') return null;
  try {
    const n = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    const flip = texture.flipY;
    return (u, v) => {
      const x = Math.min(n - 1, Math.max(0, Math.floor(u * n)));
      const yy = Math.min(n - 1, Math.max(0, Math.floor((flip ? 1 - v : v) * n)));
      const j = (yy * n + x) * 4;
      return [d[j], d[j + 1], d[j + 2]];
    };
  } catch { return null; }
}

function addLamps(scene, cfg = {}) {
  const glassName = new RegExp(cfg.material ?? 'GLASS', 'i');
  const rearFrom = cfg.rearFrom ?? 2.0; // model units along +Z (the back)
  const frontTo = cfg.frontTo ?? -2.0;  // and along -Z (the front)
  // A box (model units) holding a brake-only lamp, e.g. the roof-mounted one.
  const box = cfg.brakeOnly ? new THREE.Box3(new THREE.Vector3(...cfg.brakeOnly[0]), new THREE.Vector3(...cfg.brakeOnly[1])) : null;
  const c = new THREE.Vector3();
  const made = [];
  scene.traverse((o) => {
    if (!o.isMesh || o.userData.isLamp) return;
    const mats = [].concat(o.material);
    const g = o.geometry;
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    if (!pos || !nrm || !uv) return;
    const index = g.index;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex ?? 0];
      if (!m?.map || !glassName.test(m.name)) continue;
      const P = [], N = [], U = [], K = [];
      // Headlamp centres, left and right: the middle of the clear, forward-facing
      // glass (the amber indicators round the corners are left out).
      const bulbs = [new THREE.Box3(), new THREE.Box3()];
      const rears = [new THREE.Box3(), new THREE.Box3()];
      const colour = sampler(m.map);
      for (let i = grp.start; i < grp.start + grp.count; i += 3) {
        const v = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
        c.set(0, 0, 0);
        for (const a of v) c.x += pos.getX(a) / 3, c.y += pos.getY(a) / 3, c.z += pos.getZ(a) / 3;
        const kind = box?.containsPoint(c) ? 1 : c.z >= rearFrom ? 0 : c.z <= frontTo ? 2 : -1;
        if (kind < 0) continue;
        if (kind === 0) for (const a of v) rears[c.x < 0 ? 0 : 1].expandByPoint(_p.fromBufferAttribute(pos, a));
        if (kind === 2) {
          const fz = (nrm.getZ(v[0]) + nrm.getZ(v[1]) + nrm.getZ(v[2])) / 3;
          const t = colour?.((uv.getX(v[0]) + uv.getX(v[1]) + uv.getX(v[2])) / 3, (uv.getY(v[0]) + uv.getY(v[1]) + uv.getY(v[2])) / 3);
          const amber = t && t[0] - t[2] > 40;
          if (fz < -0.6 && !amber) for (const a of v) bulbs[c.x < 0 ? 0 : 1].expandByPoint(_p.fromBufferAttribute(pos, a));
        }
        for (const a of v) {
          K.push(kind);
          P.push(pos.getX(a), pos.getY(a), pos.getZ(a));
          N.push(nrm.getX(a), nrm.getY(a), nrm.getZ(a));
          U.push(uv.getX(a), uv.getY(a));
        }
      }
      if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      geo.setAttribute('aKind', new THREE.Float32BufferAttribute(K, 1));
      const material = new THREE.ShaderMaterial({
        name: 'TruckLamps',
        vertexShader: LAMP_VERT,
        fragmentShader: LAMP_FRAG,
        uniforms: {
          map: { value: m.map },
          uBrake: { value: 0 }, uTail: { value: 0 }, uReverse: { value: 0 }, uHead: { value: 0 },
          uLens: { value: cfg.lensGlow ?? 0.3 },
          uBulb: { value: [new THREE.Vector3(1e3, 1e3, 0), new THREE.Vector3(1e3, 1e3, 0)] },
          uSpot: { value: cfg.reflector?.spot ?? 0.07 },
          uRear: { value: rears.map((b) => (b.isEmpty() ? new THREE.Vector3(1e3, 1e3, 0) : b.getCenter(new THREE.Vector3()))) },
          uRearSpot: { value: new THREE.Vector2(...(cfg.rearSpot ?? [0.08, 0.13])) },
          uGain: { value: cfg.gain ?? 3 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const lamp = new THREE.Mesh(geo, material);
      lamp.name = 'TruckLamps';
      lamp.userData.isLamp = true;
      lamp.renderOrder = 5;
      lamp.visible = false;
      // Where the rear lamps' light comes from, for the glow on the ground.
      const back = rears.filter((b) => !b.isEmpty());
      if (back.length) {
        const all = back.reduce((a, b) => a.union(b), new THREE.Box3());
        lamp.userData.rearLamp = all.getCenter(new THREE.Vector3()).setZ(all.max.z).toArray();
      }
      made.push([o, lamp]);
      // A small bulb inside each headlamp, a little behind the glass, lights
      // the reflector and housing around it.
      const r = cfg.reflector ?? {};
      bulbs.forEach((b, i) => {
        if (b.isEmpty()) return;
        const bulb = new THREE.PointLight(0xfff1d6, 0, r.distance ?? 0.35, 2);
        if (r.at?.[i]) bulb.position.fromArray(r.at[i]); // or placed by hand in truck.json
        else { b.getCenter(bulb.position); bulb.position.z += r.back ?? 0.08; }
        bulb.name = 'TruckLampBulb';
        bulb.userData.isLamp = true;
        bulb.userData.intensity = r.intensity ?? 0.3; // candela
        material.uniforms.uBulb.value[i].copy(bulb.position);
        made.push([o, bulb]);
      });
    }
  });
  for (const [o, lamp] of made) o.add(lamp);
}

/**
 * Light a truck's lamps (ours or a copy of it).
 * @param {THREE.Object3D} root  truck.root or a clone of it
 * @param {{brake:number, reverse:number, tail:number, head?:number, gain?:number}} s  0..1 each;
 *   gain scales the brightness (less at night, when the eye is adapted)
 */
/** The middle of the rear lamps in the truck's body frame (root space), or null. */
export function rearLampPoint(root) {
  let out = null;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  root.traverse((o) => {
    if (out || !o.userData.rearLamp) return;
    out = new THREE.Vector3().fromArray(o.userData.rearLamp).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
  });
  return out;
}

const lampLists = new WeakMap(); // not userData: clone() copies that as JSON
export function setLamps(root, s) {
  let list = lampLists.get(root);
  if (!list) {
    list = [];
    root.traverse((o) => { if (o.userData.isLamp) list.push(o); });
    lampLists.set(root, list);
  }
  for (const o of list) {
    if (o.isLight) {
      // Stays visible with zero intensity by day: hiding a light changes the
      // light count, and that recompiles every material in the scene.
      o.intensity = o.userData.intensity * (s.head ?? s.tail);
      continue;
    }
    const u = o.material.uniforms;
    u.uBrake.value = s.brake;
    u.uReverse.value = s.reverse;
    u.uTail.value = s.tail;
    u.uHead.value = s.head ?? s.tail;
    u.uGain.value = (o.userData.gain ??= u.uGain.value) * (s.gain ?? 1);
    o.visible = s.brake + s.reverse + s.tail + (s.head ?? 0) > 0.001;
  }
}

// --- stand-in --------------------------------------------------------------

function buildStandIn(spec) {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.45, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.1, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 1 });
  const box = (w, h, l, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const L = 5.0, W = 1.76;
  const axle = spec.hardpointY - spec.restLength + 0.12; // wheel centre at static ride (approx)
  // Chassis and lower body.
  box(W, 0.55, L, paint, 0, axle + 0.42, 0);
  // Cab.
  box(W - 0.06, 0.62, 1.9, paint, 0, axle + 0.98, -0.35);
  box(W - 0.02, 0.5, 0.05, glass, 0, axle + 1.0, -1.31).rotation.x = -0.35;
  box(W - 0.1, 0.42, 0.04, glass, 0, axle + 1.02, 0.61);
  // Bed sides.
  box(0.08, 0.38, 1.85, paint, -W / 2 + 0.04, axle + 0.88, 1.55);
  box(0.08, 0.38, 1.85, paint, W / 2 - 0.04, axle + 0.88, 1.55);
  box(W, 0.38, 0.08, paint, 0, axle + 0.88, 2.46);
  // Bumpers, grille, lights.
  box(W + 0.08, 0.2, 0.14, chrome, 0, axle + 0.25, -2.55);
  box(W + 0.04, 0.16, 0.12, dark, 0, axle + 0.25, 2.55);
  box(1.0, 0.26, 0.05, dark, 0, axle + 0.55, -2.51);
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.5 });
  box(0.3, 0.18, 0.04, lamp, -0.66, axle + 0.56, -2.51);
  box(0.3, 0.18, 0.04, lamp, 0.66, axle + 0.56, -2.51);
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0x400000 });
  box(0.12, 0.3, 0.04, tail, -W / 2 + 0.08, axle + 0.85, 2.51);
  box(0.12, 0.3, 0.04, tail, W / 2 - 0.08, axle + 0.85, 2.51);

  // Wheels.
  const R = spec.wheelRadius, Wd = spec.wheelWidth;
  const tyreGeo = new THREE.CylinderGeometry(R, R, Wd, 28, 1).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(R * 0.6, R * 0.6, Wd + 0.01, 10, 1).rotateZ(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const half = spec.wheelbase / 2;
  const wheels = [];
  for (const [x, z] of [[-spec.track / 2, -half], [spec.track / 2, -half], [-spec.track / 2, half], [spec.track / 2, half]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, axle, z - spec.frontOffset);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    const rim = new THREE.Mesh(rimGeo, chrome);
    tyre.castShadow = rim.castShadow = true;
    spin.add(tyre, rim);
    pivot.add(spin);
    pivot.userData.rest = pivot.position.clone();
    root.add(pivot);
    wheels.push(pivot);
  }
  return { root, wheels, fit: null, haveWheels: true };
}

/** Move the wheel pivots to match the simulation (suspension, steering, rotation). */
export function poseWheels(truck, vehicle) {
  const s = vehicle.spec;
  vehicle.wheels.forEach((w, i) => {
    const pivot = truck.wheels[i];
    if (!pivot) return;
    pivot.position.set(w.local.x, w.local.y - w.length, w.local.z);
    // Keep the model's own lateral offset (wheel centre may sit outside the hardpoint).
    pivot.position.x = pivot.userData.rest.x;
    pivot.rotation.set(0, w.front ? vehicle.steerAngle : 0, 0);
    pivot.children[0].rotation.x = -w.spin;
  });
  if (truck.steering) poseSteeringWheel(truck.root, vehicle.steerAngle, truck.steering);
}
