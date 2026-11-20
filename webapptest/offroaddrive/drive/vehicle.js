// A 4WD pickup as a rigid body on four raycast suspensions.
//
// Body frame: +X right, +Y up, -Z forward (the three.js convention), origin at
// the centre of mass. Units are SI. The world is reached only through the
// `ground` object passed to step(), so this file knows nothing about the
// engines:
//
//   ground.height(x, z)                 terrain height (m)
//   ground.normal(x, z, outVector3)     unit terrain normal
//   ground.grip(x, z)                   friction coefficient (about 0.3..1)
//   ground.water(x, z)                  water surface height (m)
//   ground.trees(x, z, range, visit)    visit(tx, ty, tz, radius) per trunk
import { Matrix3, Quaternion, Vector3 } from 'three';

const G = 9.81;
const STEP = 1 / 200; // fixed physics step (s)

export const DEFAULT_SPEC = {
  mass: 1750,
  size: [1.8, 1.7, 5.0], // body box for inertia and ground contact: width, height, length
  wheelRadius: 0.38,
  wheelWidth: 0.26,
  // Suspension hardpoints (wheel centres at full droop are `restLength` below these).
  track: 1.52,
  wheelbase: 3.1,
  frontOffset: 0, // + moves the axles forward relative to the centre of mass
  hardpointY: -0.08,
  restLength: 0.42,
  travel: 0.3, // compression before the bump stop
  frequency: 1.45, // suspension natural frequency (Hz)
  dampingRatio: 0.38,
  antiRoll: 9000, // N/m of difference in compression across an axle
  bodyBottom: -0.3, // body box, relative to the centre of mass
  bodyTop: 1.05,
  // Drivetrain: a petrol V6 with a four-speed automatic, transfer case with low range.
  idleRpm: 800,
  redline: 5600,
  peakTorque: 290, // N m
  gears: [3.54, 2.18, 1.42, 1.0, 0.75],
  reverse: 3.1,
  finalDrive: 4.37,
  lowRange: 2.48,
  efficiency: 0.82,
  brakeForce: 9500, // N per wheel at full pedal
  handbrakeForce: 9000,
  maxSteer: 0.6, // rad
  steerRate: 2.4, // rad/s
  corneringStiffness: 70000, // N/rad per tyre at static load
  dragArea: 1.55, // 0.5 * rho * Cd * A
  rollingResistance: 0.016,
  // Afloat: the spinning tyres paddle a little, the front ones steer, and
  // after a while the engine drinks water and dies.
  paddleForce: 3200, // N at full throttle, the truck well afloat
  paddleSteer: 0.6,  // share of the front tyres' push that turns with the steering
  paddleTurn: 4000,  // N m of yaw per rad of steering at full throttle (front tyres as a rudder)
  floodTime: 45,     // s afloat before the engine stalls
  restartTime: 3,    // s back on dry land before it starts again
  armorRighting: 30000, // N m per sin(tilt) pulling back upright (super armour)
  armorDamping: 7000,   // N m s against rolling and pitching (super armour)
};

const _v = new Vector3(), _w = new Vector3(), _r = new Vector3(), _p = new Vector3();
const _n = new Vector3(), _f = new Vector3(), _s = new Vector3(), _c = new Vector3();
const _up = new Vector3(), _fwd = new Vector3(), _right = new Vector3(), _d = new Vector3();
const _wy = new Vector3(0, 1, 0); // the up that super armour steers toward
const _q = new Quaternion(), _m3 = new Matrix3(), _rt = new Matrix3();

export class Vehicle {
  spec;
  position = new Vector3();
  quaternion = new Quaternion();
  velocity = new Vector3();
  angularVelocity = new Vector3();
  input = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  steerAngle = 0;
  gear = 1; // -1 reverse, 0 neutral, 1.. forward
  rpm = 800;
  low = false; // transfer case in low range
  shiftTimer = 0;
  speed = 0; // signed, along the body (m/s)
  submerged = 0; // 0..1
  engineOn = true;
  // Power-ups (stars.js): engine torque and tyre grip multipliers.
  power = 1;
  gripBoost = 1;
  // Super armour (rainbow star): through trees, others bounce off, we barely move.
  armor = false;
  // Help against rolling over, 0..1 (the armour has it in full; the grip star
  // in part, since more grip also means more force tipping the truck over).
  rollAssist = 0;
  flood = 0; // 0..1, the engine stalls at 1
  #dry = 0;
  /** Things for sound and effects, refreshed every step. */
  fx = { slip: 0, roughness: 0, impact: 0, splash: 0, load: 0, crash: 0 };
  /** Called when we hit another player's truck: (id, impulseOnThem {x, z} in N·s, strength m/s). */
  onCarHit = null;

  wheels;
  #mass; #invInertia; #inertia;
  #k; #c;
  #accumulator = 0;
  #steps = 0;
  #corners;

  constructor(spec = {}) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    this.#configure();
  }

  #configure() {
    const s = this.spec;
    this.#mass = s.mass;
    const [w, h, l] = s.size;
    // Mass is concentrated lower and more central than a uniform box: scale down a little.
    const k = 0.85;
    this.#inertia = new Vector3((s.mass / 12) * (h * h + l * l) * k, (s.mass / 12) * (w * w + l * l) * k, (s.mass / 12) * (w * w + h * h) * k);
    this.#invInertia = new Vector3(1 / this.#inertia.x, 1 / this.#inertia.y, 1 / this.#inertia.z);
    const sprung = s.mass / 4;
    const omega = 2 * Math.PI * s.frequency;
    this.#k = omega * omega * sprung;
    this.#c = 2 * s.dampingRatio * Math.sqrt(this.#k * sprung);
    const half = s.wheelbase / 2;
    const make = (x, z, front) => ({
      local: new Vector3(x, s.hardpointY, z),
      front,
      side: Math.sign(x),
      length: s.restLength, // current suspension length
      compression: 0,
      contact: false,
      load: 0,
      spin: 0, // visual rotation angle
      spinRate: 0,
      slip: 0,
      grip: 0.9,
      surface: 0, // 0 grass/dirt, 1 rock, 2 sand, 3 snow
    });
    this.wheels = [
      make(-s.track / 2, -half - s.frontOffset, true),
      make(s.track / 2, -half - s.frontOffset, true),
      make(-s.track / 2, half - s.frontOffset, false),
      make(s.track / 2, half - s.frontOffset, false),
    ];
    // Body box corners that touch the ground when the truck rolls or bottoms out.
    const hx = w / 2 - 0.05, hz = l / 2 - 0.05;
    this.#corners = [];
    for (const y of [s.bodyBottom, s.bodyTop]) {
      for (const x of [-hx, hx]) for (const z of [-hz, 0, hz]) this.#corners.push(new Vector3(x, y, z));
    }
  }

  /** Put the truck at (x, z), wheels on the ground, facing `heading` (rad, 0 = -Z). */
  place(x, z, heading, ground) {
    // Heading first, then tilt onto the slope under the truck.
    this.quaternion.setFromAxisAngle(_up.set(0, 1, 0), heading);
    ground.normal(x, z, _n);
    _q.setFromUnitVectors(_up, _n);
    this.quaternion.premultiply(_q);
    const s = this.spec;
    let h = -Infinity;
    for (const wh of this.wheels) {
      _p.copy(wh.local).applyQuaternion(this.quaternion);
      h = Math.max(h, ground.height(x + _p.x, z + _p.z), ground.water(x + _p.x, z + _p.z) - 0.6);
    }
    const ride = (-s.hardpointY + s.restLength - (s.mass * G / 4) / this.#k + s.wheelRadius) / Math.max(_n.y, 0.5);
    this.position.set(x, h + ride + 0.05, z);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.gear = 1;
    this.steerAngle = 0;
    this.engineOn = true;
    this.flood = 0;
    for (const wh of this.wheels) { wh.spinRate = 0; }
  }

  /** Heading of the body's forward axis on the horizontal plane (rad, 0 = -Z, + turns left). */
  get heading() {
    _fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    return Math.atan2(-_fwd.x, -_fwd.z);
  }

  get forward() { return new Vector3(0, 0, -1).applyQuaternion(this.quaternion); }

  get gearLabel() {
    if (this.gear < 0) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }

  update(dt, ground) {
    this.#accumulator = Math.min(this.#accumulator + dt, 0.1);
    this.fx.impact = 0;
    this.fx.crash = 0;
    while (this.#accumulator >= STEP) {
      this.#step(STEP, ground);
      this.#accumulator -= STEP;
    }
    for (const wh of this.wheels) wh.spin = (wh.spin + wh.spinRate * dt) % (Math.PI * 2);
  }

  // --- one physics step -----------------------------------------------------

  #step(dt, ground) {
    this.#steps++;
    const s = this.spec;
    const m = this.#mass;
    const q = this.quaternion;
    _up.set(0, 1, 0).applyQuaternion(q);
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _right.set(1, 0, 0).applyQuaternion(q);
    const force = new Vector3(0, -m * G, 0);
    const torque = new Vector3();
    const addForce = (f, at) => {
      force.add(f);
      _r.subVectors(at, this.position);
      torque.add(_c.crossVectors(_r, f));
    };
    const pointVelocity = (at, out) => {
      _r.subVectors(at, this.position);
      return out.crossVectors(this.angularVelocity, _r).add(this.velocity);
    };

    this.speed = this.velocity.dot(_fwd);
    this.#drivetrain(dt);

    // Steering: slower at speed, rate limited.
    const v = Math.abs(this.speed);
    const target = -this.input.steer * s.maxSteer / (1 + v * 0.055);
    const ds = target - this.steerAngle;
    this.steerAngle += Math.sign(ds) * Math.min(Math.abs(ds), s.steerRate * dt);

    // --- suspension and tyres
    const contacts = this.wheels.filter((w) => w.contact).length || 1;
    const driveTotal = this.#driveForce();
    let slipSum = 0, rough = 0;
    for (const wh of this.wheels) {
      _p.copy(wh.local).applyQuaternion(q).add(this.position); // hardpoint (world)
      _d.copy(_up).negate();
      const h = ground.height(_p.x, _p.z);
      ground.normal(_p.x, _p.z, _n);
      const denom = -_n.dot(_d);
      let t = Infinity;
      if (denom > 0.25) t = ((_p.y - h) * _n.y) / denom;
      const len = t - s.wheelRadius;
      if (!(len < s.restLength)) {
        wh.contact = false;
        wh.length = s.restLength;
        wh.compression = 0;
        wh.load = 0;
        // A free wheel coasts down, or with the throttle spins up with the
        // engine (all four are driven: in the air or afloat, the front ones too).
        const r = this.#ratio();
        if (this.engineOn && this.pedal > 0.05 && r !== 0 && this.shiftTimer <= 0.1) {
          const engine = (this.rpm * 2 * Math.PI / 60) / r; // rad/s at the wheel, signed by gear
          wh.spinRate += (engine - wh.spinRate) * Math.min(1, dt * 4);
        } else wh.spinRate *= 1 - 0.6 * dt;
        if (this.input.handbrake && !wh.front) wh.spinRate = 0;
        continue;
      }
      wh.contact = true;
      const comp = Math.min(s.restLength - len, s.restLength + 0.05);
      wh.length = s.restLength - comp;
      wh.compression = comp;
    }
    // Anti-roll bars: extra force from the difference across each axle.
    const roll = [this.wheels[0].compression - this.wheels[1].compression, this.wheels[2].compression - this.wheels[3].compression];

    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      if (!wh.contact) continue;
      _p.copy(wh.local).applyQuaternion(q).add(this.position);
      _d.copy(_up).negate();
      ground.normal(_p.x, _p.z, _n);
      const comp = wh.compression;
      pointVelocity(_p, _v);
      const rate = _v.dot(_d); // > 0 when compressing
      const bar = (i % 2 === 0 ? 1 : -1) * roll[i >> 1] * s.antiRoll;
      let fs = this.#k * comp + this.#c * rate + bar;
      if (comp > s.travel) fs += 260000 * (comp - s.travel) + 9000 * Math.max(0, rate);
      fs = Math.max(0, fs);
      wh.load = fs;
      if (comp > s.travel && rate > 2) this.fx.impact = Math.max(this.fx.impact, rate);
      addForce(_f.copy(_up).multiplyScalar(fs), _p);

      // Contact patch.
      _c.copy(_p).addScaledVector(_d, wh.length + s.wheelRadius);
      const contact = _c.clone();
      const a = wh.front ? this.steerAngle : 0;
      const wf = _f.copy(_fwd).multiplyScalar(Math.cos(a)).addScaledVector(_right, -Math.sin(a));
      wf.addScaledVector(_n, -wf.dot(_n)).normalize();
      const wr = _s.crossVectors(wf, _n).normalize(); // right of the tyre, on the ground plane
      pointVelocity(contact, _v);
      const vLong = _v.dot(wf), vLat = _v.dot(wr);
      const share = m / 4;

      // The surface under the tyre: looked up every tenth step.
      if ((this.#steps + i * 3) % 10 === 0) {
        const g = ground.grip(contact.x, contact.z);
        wh.grip = g.mu;
        wh.surface = g.surface;
      }
      const load = Math.min(fs, share * G * 3);
      const mu = wh.grip * this.gripBoost;
      const fMax = mu * load;

      // Longitudinal: drive, brakes, rolling resistance.
      let fl = driveTotal / contacts;
      // S brakes in forward gears; in reverse S drives and W brakes.
      let brake = (this.gear < 0 ? this.input.throttle : this.input.brake) * s.brakeForce;
      // Hill hold: with no pedal at a crawl, the brakes keep the truck where it is.
      if (this.input.throttle < 0.05 && this.input.brake < 0.05 && Math.abs(this.speed) < 1.5) brake = s.brakeForce;
      if (this.input.handbrake && !wh.front) brake += s.handbrakeForce;
      const stopping = Math.min(share * Math.abs(vLong) / dt * 0.5, brake);
      fl -= Math.sign(vLong) * stopping;
      fl -= Math.sign(vLong) * Math.min(s.rollingResistance * load * (1 + 2 * (wh.surface === 2)), share * Math.abs(vLong) / dt * 0.5);

      // Lateral: slip angle, softened at walking pace so the truck can sit still.
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5));
      let ft = -s.corneringStiffness * Math.min(load / (share * G), 1.6) * alpha;
      ft = Math.sign(ft) * Math.min(Math.abs(ft), share * Math.abs(vLat) / dt * 0.6);

      // Friction circle. A locked rear wheel slides.
      let limit = fMax;
      if (this.input.handbrake && !wh.front) limit *= 0.55;
      const total = Math.hypot(fl, ft);
      let slip = 0;
      if (total > limit) {
        const k = limit / total;
        slip = Math.min(1, (total - limit) / (limit + 1) * 1.5 + Math.abs(vLat) * 0.1);
        fl *= k; ft *= k;
      }
      slip = Math.max(slip, Math.min(1, Math.abs(vLat) / 6));
      wh.slip = slip;
      slipSum += slip * Math.min(1, (Math.abs(vLong) + Math.abs(vLat)) / 4);
      rough += (wh.surface === 1 ? 1 : wh.surface === 2 ? 0.6 : 0.4) * Math.min(1, Math.abs(vLong) / 15);
      _v.copy(wf).multiplyScalar(fl).addScaledVector(wr, ft);
      addForce(_v, contact);

      // Wheel rotation for the picture: roll with the ground, spin up when the drive overpowers grip.
      let rateTarget = vLong / s.wheelRadius;
      if (this.input.handbrake && !wh.front) rateTarget = 0;
      else if (driveTotal !== 0 && Math.abs(driveTotal / contacts) > limit) rateTarget += Math.sign(driveTotal) * 12 * slip;
      wh.spinRate += (rateTarget - wh.spinRate) * Math.min(1, dt * 30);
    }
    this.fx.slip = slipSum / 4;
    this.fx.roughness = rough / 4;
    this.fx.load = this.wheels.reduce((a, w) => a + w.load, 0) / (m * G);

    // --- body against the ground (rollovers, bottoming out)
    for (const corner of this.#corners) {
      _p.copy(corner).applyQuaternion(q).add(this.position);
      const h = ground.height(_p.x, _p.z);
      if (_p.y >= h) continue;
      ground.normal(_p.x, _p.z, _n);
      const depth = (h - _p.y) * _n.y;
      pointVelocity(_p, _v);
      const vn = _v.dot(_n);
      const fn = Math.max(0, 180000 * depth - 14000 * vn);
      _f.copy(_n).multiplyScalar(fn);
      // Sliding friction on the body.
      _s.copy(_v).addScaledVector(_n, -vn);
      const vt = _s.length();
      if (vt > 1e-3) _f.addScaledVector(_s, -Math.min(0.6 * fn, (m / 4) * vt / dt * 0.5) / vt);
      addForce(_f, _p);
      if (-vn > 2) this.fx.impact = Math.max(this.fx.impact, -vn);
    }

    // --- water: buoyancy and drag
    let wet = 0;
    const points = this.#corners;
    for (const corner of points) {
      _p.copy(corner).applyQuaternion(q).add(this.position);
      const wy = ground.water(_p.x, _p.z);
      const depth = wy - _p.y;
      if (depth <= 0) continue;
      const f = Math.min(depth / (s.bodyTop - s.bodyBottom), 1);
      wet += f / points.length;
      if (this.armor) continue; // super armour: no buoyancy or drag, it drives along the bottom
      pointVelocity(_p, _v);
      _f.set(0, 1000 * G * (4.4 / points.length) * f, 0); // ~4.4 m³ of sealed cab and body
      _f.addScaledVector(_v, -650 * f);
      addForce(_f, _p);
    }
    if (wet > 0 && this.submerged === 0 && this.velocity.y < -1.5) this.fx.splash = Math.max(this.fx.splash, Math.min(1, -this.velocity.y / 6));
    this.submerged = wet;

    // Paddling: tyres spinning in the water push a little, the front pair
    // along where they are steered, so the truck can creep and turn.
    const swim = Math.min(1, Math.max(0, (wet - 0.12) / 0.2));
    const r = this.#ratio();
    if (swim > 0 && !this.armor && this.engineOn && r !== 0 && this.pedal > 0.02) {
      const push = s.paddleForce * this.pedal * swim * Math.sign(r) / 4;
      for (const wh of this.wheels) {
        _d.copy(_fwd);
        if (wh.front) _d.multiplyScalar(1 - s.paddleSteer).addScaledVector(_d.clone().applyAxisAngle(_up, this.steerAngle), s.paddleSteer);
        _d.y = 0;
        if (_d.lengthSq() < 1e-6) continue;
        _d.normalize().multiplyScalar(push);
        _p.copy(wh.local).applyQuaternion(q).add(this.position);
        addForce(_d, _p);
      }
      torque.addScaledVector(_up, s.paddleTurn * this.steerAngle * this.pedal * swim * Math.sign(r));
    }
    // Water in the intake: afloat for long enough, the engine dies; on dry
    // land again it dries out and starts.
    if (this.engineOn) {
      if (wet > 0.25 && !this.armor) this.flood = Math.min(1, this.flood + dt / s.floodTime);
      else this.flood = Math.max(0, this.flood - dt / (s.floodTime * 2));
      if (this.flood >= 1) { this.engineOn = false; this.#dry = 0; }
    } else if (wet < 0.02 && this.wheels.some((w) => w.contact)) {
      this.#dry += dt;
      if (this.#dry > s.restartTime) { this.engineOn = true; this.flood = 0; }
    } else this.#dry = 0;

    // Super armour keeps the wheels down: a self-righting torque toward
    // upright and strong damping of roll and pitch (yaw is left alone).
    const assist = this.armor ? 1 : this.rollAssist;
    if (assist > 0) {
      // Upright means "along the ground" when on it (so slopes are fine), else straight up.
      if (this.wheels.some((w) => w.contact)) ground.normal(this.position.x, this.position.z, _wy);
      else _wy.set(0, 1, 0);
      _c.crossVectors(_up, _wy);                         // axis to turn back upright, |sin(tilt)|
      torque.addScaledVector(_c, s.armorRighting * assist);
      _s.copy(this.angularVelocity).addScaledVector(_up, -this.angularVelocity.dot(_up));
      torque.addScaledVector(_s, -s.armorDamping * assist);
    }

    // Air drag.
    const sp = this.velocity.length();
    force.addScaledVector(this.velocity, -s.dragArea * sp);

    // --- integrate
    this.velocity.addScaledVector(force, dt / m);
    // Angular: torque into the body frame, divide by the principal inertia, back out.
    _q.copy(q).invert();
    const tb = torque.applyQuaternion(_q);
    const wb = _w.copy(this.angularVelocity).applyQuaternion(_q);
    const I = this.#inertia;
    // Gyroscopic term ω × Iω.
    const gx = wb.y * (I.z * wb.z) - wb.z * (I.y * wb.y);
    const gy = wb.z * (I.x * wb.x) - wb.x * (I.z * wb.z);
    const gz = wb.x * (I.y * wb.y) - wb.y * (I.x * wb.x);
    wb.x += (tb.x - gx) * this.#invInertia.x * dt;
    wb.y += (tb.y - gy) * this.#invInertia.y * dt;
    wb.z += (tb.z - gz) * this.#invInertia.z * dt;
    this.angularVelocity.copy(wb.applyQuaternion(q)).multiplyScalar(1 - (0.15 + 2 * wet) * dt);

    // Trees: push the body out of trunks with an impulse.
    this.#treeCollisions(ground);

    this.position.addScaledVector(this.velocity, dt);
    const av = this.angularVelocity;
    _q.set(av.x * dt * 0.5, av.y * dt * 0.5, av.z * dt * 0.5, 0).multiply(q);
    q.set(q.x + _q.x, q.y + _q.y, q.z + _q.z, q.w + _q.w).normalize();
  }

  // --- trees ---------------------------------------------------------------

  #treeCollisions(ground) {
    const s = this.spec;
    const q = this.quaternion;
    const half = s.size[2] / 2;
    const radius = s.size[0] / 2;
    const centres = [-half + radius, 0, half - radius].map((z) => new Vector3(0, 0, z).applyQuaternion(q).add(this.position));
    // `other` is set for another player's truck: { id, vx, vz, mass }. We take our share
    // of the impulse and hand theirs over (onCarHit), since their view of us lags behind.
    ground.trees(this.position.x, this.position.z, half + 3, (tx, ty, tz, tr, other = null) => {
      if (this.armor && !other) return; // trees don't stop us
      if (ty > this.position.y + 1.2 || ty < this.position.y - 4) return;
      for (const c of centres) {
        const dx = c.x - tx, dz = c.z - tz;
        const dist = Math.hypot(dx, dz);
        const pen = radius + tr - dist;
        if (pen <= 0 || dist < 1e-4) continue;
        _n.set(dx / dist, 0, dz / dist);
        // Contact point on the body's surface toward the trunk, at bumper height.
        _p.set(tx + _n.x * tr, this.position.y, tz + _n.z * tr);
        _r.subVectors(_p, this.position);
        const vRel = _v.crossVectors(this.angularVelocity, _r).add(this.velocity);
        if (other) vRel.x -= other.vx, vRel.z -= other.vz;
        const vn = vRel.dot(_n);
        this.position.addScaledVector(_n, pen * (other ? 0.35 : 0.6));
        if (vn >= 0) continue;
        // Impulse with the yaw inertia only (good enough for a glancing blow).
        const rn = _r.x * _n.z - _r.z * _n.x;
        const invMass = 1 / this.#mass + (rn * rn) * this.#invInertia.y + (other ? 1 / other.mass : 0);
        const j = (-(1 + (other ? 0.3 : 0.15)) * vn) / invMass;
        const self = this.armor && other ? 0.12 : 1; // armoured: we hardly feel it
        this.velocity.addScaledVector(_n, (j * self) / this.#mass);
        this.angularVelocity.y -= rn * j * self * this.#invInertia.y;
        // Scrub some sideways speed too.
        _s.copy(vRel).addScaledVector(_n, -vn);
        this.velocity.addScaledVector(_s, -0.25);
        if (other) {
          this.fx.crash = Math.max(this.fx.crash, -vn);
          // Their half: the same impulse the other way (they apply it when it arrives).
          const k = this.armor ? 3 : 1; // armoured: they fly
          this.onCarHit?.(other.id, { x: -_n.x * j * k, z: -_n.z * j * k }, -vn * (this.armor ? 2.5 : 1), this.armor);
        } else this.fx.impact = Math.max(this.fx.impact, -vn);
      }
    });
  }

  // --- engine and gearbox -------------------------------------------------

  #ratio(gear = this.gear) {
    const s = this.spec;
    if (gear === 0) return 0;
    const g = gear < 0 ? -s.reverse : s.gears[gear - 1];
    return g * s.finalDrive * (this.low ? s.lowRange : 1);
  }

  #torque(rpm) {
    const s = this.spec;
    if (rpm >= s.redline) return 0;
    // Broad petrol curve: 70 % at idle, peak around 3200, falling to 80 % at the redline.
    const x = rpm / 3200;
    const t = x < 1 ? 0.7 + 0.3 * Math.sin((x * Math.PI) / 2) : 1 - 0.2 * Math.pow((rpm - 3200) / (s.redline - 3200), 2);
    return s.peakTorque * t;
  }

  /** Throttle pedal: W in forward gears, S in reverse. */
  get pedal() {
    return this.gear < 0 ? this.input.brake : this.input.throttle;
  }

  #drivetrain(dt) {
    const s = this.spec;
    const fwdSpeed = this.speed;
    // Automatic forward / reverse selection when nearly stopped.
    if (Math.abs(fwdSpeed) < 0.8) {
      if (this.gear > 0 && this.input.brake > 0.1 && this.input.throttle < 0.05) this.gear = -1;
      else if (this.gear < 0 && this.input.throttle > 0.1) this.gear = 1;
    }
    const wheelOmega = Math.abs(fwdSpeed) / s.wheelRadius;
    let rpm = wheelOmega * Math.abs(this.#ratio()) * 60 / (2 * Math.PI);
    // Torque converter: the engine can rev above the wheels at low speed.
    const stall = s.idleRpm + this.pedal * 1900;
    rpm = Math.max(rpm, s.idleRpm, Math.min(stall, s.idleRpm + 2200));
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (this.gear > 0) {
      const up = this.pedal > 0.7 ? s.redline - 500 : 2600 + this.pedal * 2200;
      if (rpm > up && this.gear < s.gears.length) { this.gear++; this.shiftTimer = 0.35; }
      else if (this.gear > 1) {
        const lower = wheelOmega * Math.abs(this.#ratio(this.gear - 1)) * 60 / (2 * Math.PI);
        const down = this.pedal > 0.7 ? 3600 : 1700;
        if (lower < down && lower < s.redline - 600) { this.gear--; this.shiftTimer = 0.3; }
      }
    }
    if (!this.engineOn) rpm = 0;
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * (this.engineOn ? 12 : 4));
  }

  /** Total drive force at the ground from the engine, along the body (N). */
  #driveForce() {
    const s = this.spec;
    if (this.gear === 0 || this.shiftTimer > 0.1) return 0;
    if (!this.engineOn) return -Math.sign(this.speed) * Math.min(Math.abs(this.speed) * 40, 300); // a dead engine still drags a little
    const pedal = this.pedal;
    if (pedal <= 0) {
      // Engine braking.
      const r = this.#ratio();
      return -Math.sign(this.speed) * Math.min(Math.abs(this.speed) * 40, 0.12 * s.peakTorque * Math.abs(r) / s.wheelRadius);
    }
    const r = this.#ratio();
    // Torque converter multiplication near stall.
    const speedRatio = Math.min(1, (Math.abs(this.speed) / s.wheelRadius) * Math.abs(r) * 60 / (2 * Math.PI) / Math.max(this.rpm, 1));
    const conv = 1 + 0.9 * (1 - speedRatio);
    // Reverse is limited to a sensible pace.
    const cut = this.gear < 0 ? Math.max(0, Math.min(1, (28 / 3.6 + this.speed) / 2)) : 1;
    return this.#torque(this.rpm) * this.power * pedal * cut * conv * r * s.efficiency / s.wheelRadius;
  }
}
