import * as THREE from 'three';
import { TANK, makeShadowBlob } from './environment.js';
import { createWhaleShark, createManta, createTuna } from './creatures.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();

// 生物に影キャストを付与（Mesh 配下まとめて）
function enableCastShadow(obj) { obj.traverse((o) => { if (o.isMesh) o.castShadow = true; }); }

function angleLerp(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}
function yawOf(vx, vz) { return Math.atan2(-vx, -vz); } // 前方 = -Z 基準（mesh.lookAt と整合取らず自前）
// 角度差を [-π, π] に畳む（±π 跨ぎで bank/roll が ±2π 飛びするのを防ぐ）
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

// 泳動領域から押し戻す（予測点が外に出そうなら内側へ針路補正）
function boundsYaw(pos, yaw, look = 18) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const px = pos.x + fx * look, pz = pos.z + fz * look;
  let pushX = 0, pushZ = 0;
  if (px > TANK.xMax) pushX = -(px - TANK.xMax);
  if (px < TANK.xMin) pushX = -(px - TANK.xMin);
  if (pz > TANK.zMax) pushZ = -(pz - TANK.zMax);
  if (pz < TANK.zMin) pushZ = -(pz - TANK.zMin);
  if (pushX === 0 && pushZ === 0) return yaw;
  const k = 0.10;
  const cx = fx + pushX * k, cz = fz + pushZ * k;
  return Math.atan2(-cx, -cz);
}

function clampInside(pos, pad = 2) {
  pos.x = THREE.MathUtils.clamp(pos.x, -TANK.hw + pad, TANK.hw - pad);
  pos.z = THREE.MathUtils.clamp(pos.z, -TANK.hd + pad, TANK.hd - pad);
  pos.y = THREE.MathUtils.clamp(pos.y, 1.2, TANK.H - 1.6);
}

// 岩（楕円体）の内部にいたら位置をシェル外へ強制補正（貫通の最終保険）
function pushOutOfRocks(pos, rocks, pad) {
  if (!rocks) return;
  for (const r of rocks) {
    if (!r.ax) continue;
    const ax = r.ax * 1.15, ay = r.ay * 1.15, az = r.az * 1.15;
    const dx = (pos.x - r.pos.x) / ax, dy = (pos.y - r.pos.y) / ay, dz = (pos.z - r.pos.z) / az;
    const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (n < 1 + pad) {
      const s = (1 + pad) / Math.max(n, 1e-4);
      pos.x = r.pos.x + dx * s * ax;
      pos.y = r.pos.y + dy * s * ay;
      pos.z = r.pos.z + dz * s * az;
    }
  }
}

// ============================================================
// ジンベエザメ: 大旋回・ゆったり
// ============================================================
class WhaleShark {
  constructor(scene, env, seed) {
    const c = createWhaleShark();
    this.c = c; this.yaw = seed.yaw; this.pitch = 0;
    this.speed = 1.05 + seed.sp * 0.25;
    this.pos = new THREE.Vector3(seed.x, seed.y, seed.z);
    this.target = this.newTarget();
    this.turn = 0;
    this.bank = 0;
    this.env = env;
    scene.add(c.obj);
    enableCastShadow(c.obj);
    this.blob = makeShadowBlob(env.blobTex, 16, 0.5);
    scene.add(this.blob);
  }
  newTarget() {
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * (TANK.hw - 30),
      12 + Math.random() * 26,
      (Math.random() * 2 - 1) * (TANK.hd - 26)
    );
  }
  update(dt, t, avoiders) {
    // 目標針路
    let desired = Math.atan2(-(this.target.x - this.pos.x), -(this.target.z - this.pos.z));
    // 他生物回避: 近距離なら横へぶれる
    for (const o of avoiders) {
      const d = this.pos.distanceTo(o.pos);
      const R = (o.radius || 3) + 26;
      if (o.rock && Math.abs(this.pos.y - o.pos.y) > o.radius + 4) continue;
      if (d < R && o !== this) {
        const side = _v.subVectors(this.pos, o.pos);
        const oy = Math.atan2(-side.x, -side.z);
        let dd = oy - this.yaw;
        while (dd > Math.PI) dd -= Math.PI * 2;
        while (dd < -Math.PI) dd += Math.PI * 2;
        desired += THREE.MathUtils.clamp(dd, -1.2, 1.2) * (1 - d / R) * 1.6;
      }
    }
    desired = boundsYaw(this.pos, desired);
    // 旋回速度は遅く（大旋回）
    const maxYaw = 0.032;
    this.yaw = angleLerp(this.yaw, desired, maxYaw * dt + 0.0004);
    // 深度
    const dy = this.target.y - this.pos.y;
    this.pitch = THREE.MathUtils.clamp(dy * 0.015, -0.06, 0.06);
    const cp = Math.cos(this.pitch);
    _v.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.pos.addScaledVector(_v, this.speed * dt * 1.0);
    clampInside(this.pos);
    if (this.pos.distanceTo(this.target) < 30 || Math.random() < dt * 0.01) this.target = this.newTarget();

    this.c.obj.position.copy(this.pos);
    _t.copy(this.pos).addScaledVector(_v, 4);
    this.c.obj.lookAt(_t);
    const bankErr = wrapAngle(desired - this.yaw);
    const bankTarget = THREE.MathUtils.clamp(-bankErr * 6, -0.12, 0.12);
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 5);
    this.c.obj.rotateZ(this.bank);
    this.c.animate(dt, this.speed);
    updateBlob(this);
  }
}

// ============================================================
// マンタ: 滑空
// ============================================================
class Manta {
  constructor(scene, env, seed) {
    const c = createManta();
    this.c = c;
    this.yaw = seed.yaw;
    this.pos = new THREE.Vector3(seed.x, seed.y, seed.z);
    this.speed = 2.4 + seed.sp * 0.8;
    this.glide = Math.random() * 10;
    this.bank = 0;
    this.env = env;
    scene.add(c.obj);
    enableCastShadow(c.obj);
    this.blob = makeShadowBlob(env.blobTex, 9, 0.42);
    scene.add(this.blob);
  }
  update(dt, t, avoiders) {
    this.glide += dt * 0.13;
    const depthWave = Math.sin(this.glide) * 0.16;
    let desired = this.yaw + Math.sin(this.glide * 0.37 + 2.0) * 0.0021;
    desired = boundsYaw(this.pos, desired, 14);
    for (const o of avoiders) {
      if (o === this) continue;
      if (o.rock && Math.abs(this.pos.y - o.pos.y) > o.radius + 3) continue;
      const d = this.pos.distanceTo(o.pos);
      const R = (o.radius || 3) + 14;
      if (d < R) {
        const side = _v.subVectors(this.pos, o.pos);
        const oy = Math.atan2(-side.x, -side.z);
        let dd = oy - this.yaw;
        while (dd > Math.PI) dd -= Math.PI * 2;
        while (dd < -Math.PI) dd += Math.PI * 2;
        desired += THREE.MathUtils.clamp(dd, -1.4, 1.4) * (1 - d / R) * 2.2;
      }
    }
    this.yaw = angleLerp(this.yaw, desired, 0.11 * dt + 0.0004);
    const cp = Math.cos(depthWave);
    _v.set(-Math.sin(this.yaw) * cp, Math.sin(depthWave), -Math.cos(this.yaw) * cp);
    this.pos.addScaledVector(_v, this.speed * dt);
    clampInside(this.pos);

    this.c.obj.position.copy(this.pos);
    _t.copy(this.pos).addScaledVector(_v, 4);
    this.c.obj.lookAt(_t);
    const bankErr = wrapAngle(desired - this.yaw);
    const bankTarget = THREE.MathUtils.clamp(bankErr * 4, -0.16, 0.16);
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 5);
    this.c.obj.rotateZ(this.bank);
    this.c.animate(dt, this.speed);
    updateBlob(this);
  }
}

// ============================================================
// クロマグロ: ボイディング群泳
// ============================================================
class Tuna {
  constructor(scene, env, i, n, schoolCenter) {
    const c = createTuna();
    this.c = c;
    this.pos = new THREE.Vector3(
      schoolCenter.x + THREE.MathUtils.randFloatSpread(14),
      THREE.MathUtils.randFloat(8, 30),
      schoolCenter.z + THREE.MathUtils.randFloatSpread(14)
    );
    const a = Math.random() * Math.PI * 2;
    this.vel = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)).multiplyScalar(6.5);
    this.prevYaw = Math.atan2(-this.vel.x, -this.vel.z);
    this.env = env;
    scene.add(c.obj);
    enableCastShadow(c.obj);
    this.blob = makeShadowBlob(env.blobTex, 3.4, 0.28);
    scene.add(this.blob);
  }
}

class TunaSchool {
  constructor(scene, env, count, seed) {
    this.list = [];
    this.attractorT = Math.random() * 100;
    const c0 = new THREE.Vector3(seed, 16, 0);
    for (let i = 0; i < count; i++) this.list.push(new Tuna(scene, env, i, count, c0));
    this.attractor = new THREE.Vector3(seed, 16, 0);
  }
  update(dt, t, avoiders) {
    // ゆっくり大きく周回する群れ目標
    this.attractorT += dt;
    const at = this.attractorT;
    this.attractor.set(
      Math.cos(at * 0.045) * 72,
      15 + Math.sin(at * 0.05 + 1.3) * 7,
      Math.sin(at * 0.05 + 0.7) * 34
    );
    const L = this.list;
    const forces = new Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      const sep = _sep.set(0, 0, 0), ali = _ali.set(0, 0, 0), coh = _coh.set(0, 0, 0);
      let nA = 0, nC = 0;
      for (let j = 0; j < L.length; j++) {
        if (i === j) continue;
        const o = L[j];
        const d = b.pos.distanceTo(o.pos);
        if (d < 4.4) {
          sep.add(_v.subVectors(b.pos, o.pos).multiplyScalar((4.4 - d) / 4.4));
        } else if (d < 15) {
          ali.add(o.vel); nA++;
          coh.add(o.pos); nC++;
        }
      }
      const f = new THREE.Vector3();
      f.addScaledVector(sep, 3.4);
      if (nA) { ali.divideScalar(nA).setLength(6.8); f.add(ali.sub(b.vel).multiplyScalar(0.55)); }
      if (nC) {
        coh.divideScalar(nC).sub(b.pos);
        if (coh.length() > 12) f.add(coh.setLength(0.5));
      }
      // 群れ目標（ゆっくり）
      f.addScaledVector(_v.subVectors(this.attractor, b.pos).setLength(1), 0.085);
      // 壁回避
      const look = 5 + b.vel.length() * 1.1;
      _v.copy(b.vel).setLength(1);
      const px = b.pos.x + _v.x * look, pz = b.pos.z + _v.z * look, py = b.pos.y + _v.y * look;
      const cx = THREE.MathUtils.clamp(px, TANK.xMin, TANK.xMax);
      const cz = THREE.MathUtils.clamp(pz, TANK.zMin, TANK.zMax);
      const cy = THREE.MathUtils.clamp(py, 5, TANK.H - 6);
      if (cx !== px || cz !== pz || cy !== py) {
        _t.set(cx - px, cy - py, cz - pz).setLength(1);
        f.addScaledVector(_t, 3.2);
      }
      // 大型生物・岩回避（岩は楕円体で精密判定）
      let panic = 0;
      for (const o of avoiders) {
        if (o.rock && o.ax) {
          const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z;
          const nx = o.ax + 10, ny = o.ay + 6, nz = o.az + 10;
          const t = Math.sqrt((dx / nx) ** 2 + (dy / ny) ** 2 + (dz / nz) ** 2);
          if (t < 1.35) {
            f.addScaledVector(_v.set(dx / nx, dy / ny, dz / nz).normalize(), 5.5 * (1.35 - t));
            panic = Math.max(panic, 0.4 * (1.35 - t));
          }
          continue;
        }
        const d = b.pos.distanceTo(o.pos);
        const R = (o.radius || 3) + 15;
        if (d < R + 8) {
          f.addScaledVector(_v.subVectors(b.pos, o.pos).setLength(1), 3.4 * (1 - d / (R + 8)));
          if ((o.radius || 3) > 4) panic = Math.max(panic, 1 - d / (R + 8));
        }
      }
      forces[i] = f;
      b._panic = panic;
    }
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      b.vel.addScaledVector(forces[i], dt * 2.4);
      // 速度制限
      const max = 7.6 + b._panic * 3.4, min = 5.2;
      const s = b.vel.length();
      if (s > max) b.vel.multiplyScalar(max / s);
      if (s < min) b.vel.setLength(min);
      // 上下をやりすぎない
      b.vel.y = THREE.MathUtils.clamp(b.vel.y, -2.2, 2.2);
      b.pos.addScaledVector(b.vel, dt);
      clampInside(b.pos);
      // 姿勢
      b.c.obj.position.copy(b.pos);
      _t.copy(b.pos).addScaledVector(b.vel, 0.5);
      b.c.obj.lookAt(_t);
      const y = Math.atan2(-b.vel.x, -b.vel.z);
      let dyaw = y - b.prevYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      b.c.obj.rotateZ(THREE.MathUtils.clamp(-dyaw * 9, -0.5, 0.5));
      b.prevYaw = y;
      b.c.animate(dt, b.vel.length());
      updateBlob(b);
    }
  }
}
const _sep = new THREE.Vector3(), _ali = new THREE.Vector3(), _coh = new THREE.Vector3();

function updateBlob(creature) {
  const bl = creature.blob;
  // 実シャドウマップが有効なときは偽の足元デカールは不要（二重に暗くしない）
  if (creature.env && creature.env.shadowsEnabled) { bl.visible = false; return; }
  bl.visible = true;
  const p = creature.pos;
  bl.position.x = p.x; bl.position.z = p.z;
  const h = Math.max(p.y - 1, 0);
  const base = bl.userData.baseScale;
  const scale = base * (1 + h * 0.012);
  bl.scale.set(scale, scale, 1);
  bl.material.opacity = bl.userData.baseOpacity * THREE.MathUtils.clamp(1 - h / 46, 0.15, 1);
}

// ============================================================
export function spawnCreatures(scene, env) {
  const rng = (() => { let s = 24601 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const rand = (a, b) => a + rng() * (b - a);

  const whales = [
    new WhaleShark(scene, env, { x: -40, y: 22, z: 10, yaw: 0.6, sp: rng() }),
    new WhaleShark(scene, env, { x: 55, y: 30, z: -25, yaw: 3.4, sp: rng() }),
  ];
  const mantas = [];
  for (let i = 0; i < 4; i++) {
    mantas.push(new Manta(scene, env, {
      x: rand(-70, 70), y: rand(14, 40), z: rand(-40, 40), yaw: rand(0, 6.28), sp: rng(),
    }));
  }
  const school = new TunaSchool(scene, env, 30, -30);

  const all = [];
  for (const w of whales) all.push({ pos: w.pos, radius: 6 });
  for (const m of mantas) all.push({ pos: m.pos, radius: 3.2 });
  for (const r of (env.rocks || [])) all.push({ pos: r.pos, radius: r.radius, rock: true, ax: r.ax, ay: r.ay, az: r.az });

  const rockList = all.filter((a) => a.rock);
  let acc = 0;
  void acc;
  return {
    whales, mantas, school,
    update(dt, t) {
      for (const w of whales) w.update(dt, t, all.filter((a) => a.pos !== w.pos));
      for (const w of whales) pushOutOfRocks(w.pos, rockList, 0.45);
      for (const m of mantas) m.update(dt, t, all.filter((a) => a.pos !== m.pos));
      for (const m of mantas) pushOutOfRocks(m.pos, rockList, 0.35);
      school.update(dt, t, all);
      for (const t0 of school.list) pushOutOfRocks(t0.pos, rockList, 0.18);
    },
  };
}
