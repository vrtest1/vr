(function () {
  class FX {
    constructor() {
      this.particles = [];
      this.rings = [];
      this.numbers = [];
      this.bolts = [];
      this.shake = 0;
      this.slowmo = 0;
    }
    addShake(m) {
      this.shake = Math.max(this.shake, m);
    }
    addSlowmo(t) {
      this.slowmo = Math.max(this.slowmo, t);
    }
    _spawn(p) {
      if (this.particles.length < 900) this.particles.push(p);
    }
    addExplosion(x, y, z, scale, hue) {
      scale = scale || 1;
      hue = hue || [255, 160, 50];
      const n = (10 * scale) | 0;
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(0.8, 4.2) * scale;
        this._spawn({
          x, y, z: z + U.rand(0, 0.3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(1, 4) * scale,
          t: 0, life: U.rand(0.25, 0.5), size: U.rand(0.08, 0.2) * scale,
          col: [255, U.rand(120, 220), U.rand(20, 80)], grav: 6, type: 'flame'
        });
      }
      for (let i = 0; i < 8 * scale; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(2, 8) * scale;
        this._spawn({
          x, y, z: z + 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(2, 7) * scale,
          t: 0, life: U.rand(0.2, 0.45), size: U.rand(0.03, 0.07),
          col: [255, 240, 180], grav: 10, type: 'spark'
        });
      }
      for (let i = 0; i < 4 * scale; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(0.3, 1.4);
        this._spawn({
          x, y, z: z + 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(1, 2.4),
          t: 0, life: U.rand(0.6, 1.1), size: U.rand(0.18, 0.34) * scale,
          col: [90, 88, 86], grav: -0.4, type: 'smoke'
        });
      }
      this.rings.push({ x, y, z: z + 0.1, t: 0, life: 0.35, r0: 0.1, r1: 1.4 * scale, col: [255, 200, 120] });
    }
    addMuzzle(x, y, z, ang) {
      for (let i = 0; i < 5; i++) {
        const a = ang + U.rand(-0.5, 0.5), sp = U.rand(3, 7);
        this._spawn({
          x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(0.5, 2),
          t: 0, life: U.rand(0.06, 0.14), size: U.rand(0.05, 0.12),
          col: [255, 230, 140], grav: 0, type: 'spark'
        });
      }
    }
    addHitSpark(x, y, z, col) {
      col = col || [255, 255, 255];
      for (let i = 0; i < 6; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(1, 4);
        this._spawn({
          x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(1, 3),
          t: 0, life: U.rand(0.12, 0.3), size: U.rand(0.03, 0.08),
          col, grav: 6, type: 'spark'
        });
      }
    }
    addDebris(x, y, z, col, n) {
      n = n || 6;
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(0.5, 2.6);
        this._spawn({
          x, y, z: z + U.rand(0, 0.3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(2, 5),
          t: 0, life: U.rand(0.4, 0.8), size: U.rand(0.05, 0.12),
          col, grav: 12, type: 'debris'
        });
      }
    }
    addSpawn(x, y) {
      this.rings.push({ x, y, z: 0.1, t: 0, life: 0.6, r0: 0.9, r1: 0.15, col: [120, 180, 255] });
      for (let i = 0; i < 8; i++) {
        const a = U.rand(0, U.TAU);
        this._spawn({
          x: x + Math.cos(a) * 0.5, y: y + Math.sin(a) * 0.5, z: 0.1,
          vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, vz: U.rand(2, 4),
          t: 0, life: U.rand(0.3, 0.5), size: 0.07, col: [120, 180, 255], grav: 0, type: 'flame'
        });
      }
    }
    addNumber(x, y, z, txt, col, big) {
      if (this.numbers.length < 60) this.numbers.push({ x, y, z, txt: String(txt), t: 0, life: 0.8, col: col || [255, 255, 255], big: !!big });
    }
    addBolt(x1, y1, z1, x2, y2, z2, col) {
      this.bolts.push({ x1, y1, z1, x2, y2, z2, t: 0, life: 0.18, col: col || [160, 220, 255] });
    }
    addConfetti(x, y, z) {
      for (let i = 0; i < 40; i++) {
        const a = U.rand(0, U.TAU), sp = U.rand(1, 5);
        this._spawn({
          x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: U.rand(4, 9),
          t: 0, life: U.rand(0.8, 1.6), size: U.rand(0.05, 0.1),
          col: [[255, 210, 80], [120, 200, 255], [255, 120, 160], [180, 255, 140]][i % 4], grav: 8, type: 'spark'
        });
      }
    }
    update(dt) {
      this.shake = Math.max(0, this.shake - dt * 14);
      this.slowmo = Math.max(0, this.slowmo - dt);
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.t += dt;
        if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
        p.vz -= (p.grav || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.z < 0.02) {
          p.z = 0.02;
          p.vz *= -0.3;
          p.vx *= 0.6;
          p.vy *= 0.6;
        }
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.t += dt;
        if (r.t >= r.life) this.rings.splice(i, 1);
      }
      for (let i = this.numbers.length - 1; i >= 0; i--) {
        const n = this.numbers[i];
        n.t += dt;
        n.z += dt * 1.4;
        if (n.t >= n.life) this.numbers.splice(i, 1);
      }
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        b.t += dt;
        if (b.t >= b.life) this.bolts.splice(i, 1);
      }
    }
    draw(ctx, cam) {
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i];
        const k = r.t / r.life;
        const rad = U.lerp(r.r0, r.r1, k);
        const p = M3D.proj(cam, r.x, r.y, r.z);
        const rr = rad * M3D.A * cam.s;
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], rr, rr * 0.5, 0, 0, U.TAU);
        ctx.strokeStyle = U.rgba(r.col, (1 - k) * 0.9);
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const k = 1 - p.t / p.life;
        const pr = M3D.proj(cam, p.x, p.y, p.z);
        if (p.type === 'spark') {
          const pv = M3D.proj(cam, p.x - p.vx * 0.02, p.y - p.vy * 0.02, p.z - p.vz * 0.02);
          ctx.beginPath();
          ctx.moveTo(pv[0], pv[1]);
          ctx.lineTo(pr[0], pr[1]);
          ctx.strokeStyle = U.rgba(p.col, k);
          ctx.lineWidth = Math.max(1, p.size * 30 * cam.s);
          ctx.stroke();
        } else if (p.type === 'flame') {
          const rr = p.size * 26 * cam.s * (0.5 + k * 0.5);
          ctx.beginPath();
          ctx.arc(pr[0], pr[1], Math.max(0.5, rr), 0, U.TAU);
          ctx.fillStyle = U.rgba(p.col, k * 0.9);
          ctx.fill();
        } else if (p.type === 'debris') {
          ctx.save();
          ctx.translate(pr[0], pr[1]);
          ctx.rotate(p.t * 8);
          const s = p.size * 22 * cam.s;
          ctx.fillStyle = U.rgba(p.col, k);
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.restore();
        }
      }
      for (let i = 0; i < this.bolts.length; i++) {
        const b = this.bolts[i];
        const k = 1 - b.t / b.life;
        const p1 = M3D.proj(cam, b.x1, b.y1, b.z1);
        const p2 = M3D.proj(cam, b.x2, b.y2, b.z2);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        const segs = 5;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const x = U.lerp(p1[0], p2[0], t) + (s < segs ? U.rand(-9, 9) : 0);
          const y = U.lerp(p1[1], p2[1], t) + (s < segs ? U.rand(-9, 9) : 0);
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = U.rgba(b.col, k);
        ctx.lineWidth = 2.5 * k + 0.5;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < this.numbers.length; i++) {
        const n = this.numbers[i];
        const k = 1 - n.t / n.life;
        const p = M3D.proj(cam, n.x, n.y, n.z);
        ctx.font = (n.big ? 'bold 20px' : 'bold 14px') + " 'Arial', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillStyle = U.rgba(n.col, k);
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 3;
        ctx.strokeText(n.txt, p[0], p[1]);
        ctx.fillText(n.txt, p[0], p[1]);
      }
    }
  }
  window.FX = FX;
})();
