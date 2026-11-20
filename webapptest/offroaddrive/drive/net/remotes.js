// Other players' trucks: a copy of our model per player, moved smoothly
// between the states they send (drawn ~120 ms in the past so there is always
// a snapshot on each side), wheels steered and rolled, a name tag above.
import * as THREE from 'three';
import { poseSteeringWheel } from '../truckModel.js';

const DELAY = 0.12; // s of interpolation delay
const R3 = (v) => Math.round(v * 1000) / 1000;

/** Rear lamps as bits: 1 brake, 2 reversing; and 4 super armour (rainbow). */
export function vehicleLamps(v) {
  const reverse = v.gear < 0;
  const pedal = reverse ? v.input.throttle : v.input.brake; // in reverse W is the brake
  return (pedal > 0.05 ? 1 : 0) | (reverse ? 2 : 0) | (v.armor ? 4 : 0);
}

/** Our truck's state as a compact array for the wire. */
export function packState(v) {
  const p = v.position, q = v.quaternion, u = v.velocity;
  const w = v.wheels;
  return [
    R3(performance.now() / 1000),
    R3(p.x), R3(p.y), R3(p.z),
    R3(q.x), R3(q.y), R3(q.z), R3(q.w),
    R3(u.x), R3(u.y), R3(u.z),
    R3(v.steerAngle),
    R3(w[0].length), R3(w[1].length), R3(w[2].length), R3(w[3].length),
    w.reduce((b, x, i) => b | (x.contact ? 1 << i : 0) | (x.surface << (4 + i * 2)), 0),
    R3(w[0].slip), R3(w[1].slip), R3(w[2].slip), R3(w[3].slip),
    Math.round(v.rpm),
    vehicleLamps(v),
  ];
}

class Remote {
  constructor(id, info, root, wheels, spec) {
    this.id = id;
    this.info = info;
    this.root = root;
    this.pivots = wheels;
    this.snaps = [];
    this.offset = null; // local time - sender time (smallest seen)
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.steerAngle = 0;
    this.speed = 0;
    this.rpm = 800;
    this.lamps = 0;
    this.spec = spec;
    // Looks enough like a Vehicle for the dust and tyre-track code.
    this.wheels = spec.wheelLocals.map((local, i) => ({ local, front: i < 2, length: spec.restLength, contact: false, slip: 0, surface: 0, spin: 0 }));
    this.seen = false;
    this.lastHeard = 0;
    this.tag = document.createElement('div');
    this.tag.className = 'mp-tag';
    document.body.appendChild(this.tag);
    this.setInfo(info);
  }

  setInfo(info) {
    this.info = info;
    this.tag.innerHTML = `<i style="background:${info.color}"></i>${escapeHtml(info.name)}${info.host ? ' <b>ホスト</b>' : ''}<u style="border-top-color:${info.color}"></u>`;
  }

  receive(a, now) {
    const t = a[0];
    const off = now - t;
    if (this.offset === null || off < this.offset) this.offset = off;
    // Let the offset drift up slowly so a one-off fast packet does not pin it.
    this.offset += 0.0005;
    this.snaps.push(a);
    if (this.snaps.length > 30) this.snaps.shift();
    this.lastHeard = now;
  }

  update(dt, now) {
    if (!this.snaps.length) { this.root.visible = false; return; }
    this.root.visible = true;
    const target = now - this.offset - DELAY; // in sender time
    const s = this.snaps;
    let a = null, b = null;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i][0] <= target) { a = s[i]; b = s[i + 1] ?? null; break; }
    }
    if (!a) a = s[0];
    const P = new THREE.Vector3(), Q = new THREE.Quaternion();
    if (b) {
      const k = THREE.MathUtils.clamp((target - a[0]) / Math.max(1e-3, b[0] - a[0]), 0, 1);
      P.set(a[1], a[2], a[3]).lerp(new THREE.Vector3(b[1], b[2], b[3]), k);
      Q.set(a[4], a[5], a[6], a[7]).slerp(new THREE.Quaternion(b[4], b[5], b[6], b[7]), k);
      this.steerAngle = a[11] + (b[11] - a[11]) * k;
      for (let i = 0; i < 4; i++) this.wheels[i].length = a[12 + i] + (b[12 + i] - a[12 + i]) * k;
    } else {
      // Past the newest snapshot: carry on with its velocity for a moment.
      const ahead = Math.min(0.5, Math.max(0, target - a[0]));
      P.set(a[1] + a[8] * ahead, a[2] + a[9] * ahead, a[3] + a[10] * ahead);
      Q.set(a[4], a[5], a[6], a[7]);
      this.steerAngle = a[11];
      for (let i = 0; i < 4; i++) this.wheels[i].length = a[12 + i];
    }
    const last = b ?? a;
    this.velocity.set(last[8], last[9], last[10]);
    const bits = last[16];
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.contact = !!(bits & (1 << i));
      w.surface = (bits >> (4 + i * 2)) & 3;
      w.slip = last[17 + i];
    }
    this.rpm = last[21];
    this.lamps = last[22] | 0; // older clients send no lamps
    // First pose: jump; afterwards follow (the interpolation is already smooth).
    if (!this.seen) { this.position.copy(P); this.quaternion.copy(Q); this.seen = true; }
    else { this.position.lerp(P, Math.min(1, dt * 20)); this.quaternion.slerp(Q, Math.min(1, dt * 20)); }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    this.speed = this.velocity.dot(fwd);
    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.quaternion);
    this.wheels.forEach((w, i) => {
      const pivot = this.pivots[i];
      if (!pivot) return;
      if (w.contact) w.spin += (this.speed / this.spec.wheelRadius) * dt;
      pivot.position.set(pivot.userData.rest.x, w.local.y - w.length, w.local.z);
      pivot.rotation.set(0, w.front ? this.steerAngle : 0, 0);
      pivot.children[0].rotation.x = -w.spin;
    });
    poseSteeringWheel(this.root, this.steerAngle);
  }

  dispose() {
    this.root.removeFromParent();
    this.tag.remove();
  }
}

export class RemoteTrucks {
  /** peerId -> Remote */
  list = new Map();
  #scene; #truck; #prepare; #spec;

  /**
   * @param {THREE.Scene} scene
   * @param {object} truck     our truck ({ root, wheels }) to copy
   * @param {object} vehicle   our Vehicle (for the wheel layout)
   * @param {function} prepare (root, color) => void: tint and hook the copy into the world
   */
  constructor(scene, truck, vehicle, prepare) {
    this.#scene = scene;
    this.#truck = truck;
    this.#prepare = prepare;
    this.#spec = {
      wheelLocals: vehicle.wheels.map((w) => w.local.clone()),
      wheelRadius: vehicle.spec.wheelRadius,
      restLength: vehicle.spec.restLength,
      size: vehicle.spec.size,
    };
  }

  ensure(id, info) {
    let r = this.list.get(id);
    if (r) { r.setInfo(info); return r; }
    const root = this.#truck.root.clone(true);
    // The wheel pivots are direct children of the root: find the same ones in the copy.
    const wheels = this.#truck.wheels.map((p) => (p ? root.children[this.#truck.root.children.indexOf(p)] : null));
    this.#prepare(root, info.color);
    root.visible = false;
    this.#scene.add(root);
    r = new Remote(id, info, root, wheels, this.#spec);
    this.list.set(id, r);
    return r;
  }

  remove(id) {
    this.list.get(id)?.dispose();
    this.list.delete(id);
  }

  clear() { for (const id of [...this.list.keys()]) this.remove(id); }

  receive(id, info, arr) {
    this.ensure(id, info).receive(arr, performance.now() / 1000);
  }

  update(dt, camera, renderer) {
    const now = performance.now() / 1000;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const v = new THREE.Vector3();
    for (const r of this.list.values()) {
      r.update(dt, now);
      // Name tag above the cab; hidden behind the camera or very far away.
      v.copy(r.position).add(new THREE.Vector3(0, 1.75, 0));
      const d = v.distanceTo(camPos);
      v.project(camera);
      const show = r.root.visible && v.z < 1 && d < 1500;
      r.tag.style.display = show ? 'block' : 'none';
      if (show) {
        r.tag.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        r.tag.style.opacity = String(THREE.MathUtils.clamp(1.4 - d / 900, 0.35, 1));
        r.tag.dataset.dist = d > 60 ? `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}` : '';
      }
      // A truck that has gone quiet (its window hidden, or the connection
      // stalling) stays parked where it was; the tag says so.
      r.tag.classList.toggle('quiet', now - r.lastHeard > 3);
    }
  }

  /** Collision circles for our physics: three along each truck's length. */
  obstacles(x, z, range, visit) {
    for (const r of this.list.values()) {
      if (!r.root.visible) continue;
      const p = r.position;
      if (Math.hypot(p.x - x, p.z - z) > range + 4) continue;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(r.quaternion);
      const half = this.#spec.size[2] / 2 - 0.9;
      const other = { id: r.id, vx: r.velocity.x, vz: r.velocity.z, mass: 1750 };
      for (const k of [-1, 0, 1]) visit(p.x + fwd.x * half * k, p.y, p.z + fwd.z * half * k, 0.9, other);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
