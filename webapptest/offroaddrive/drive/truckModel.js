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
  return { root: model, wheels, fit, haveWheels };
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
}
