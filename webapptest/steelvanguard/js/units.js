(function () {
  let nextId = 1;
  const M = Stages.MAP;

  function circleSolid(grid, x, y, r) {
    const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(M - 1, Math.floor(x + r));
    const j0 = Math.max(0, Math.floor(y - r)), j1 = Math.min(M - 1, Math.floor(y + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = grid[j][i];
        if (c !== 1 && c !== 2) continue;
        const cx = U.clamp(x, i, i + 1), cy = U.clamp(y, j, j + 1);
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  function moveCircle(game, obj, dx, dy) {
    const r = obj.r * 0.85;
    const nx = U.clamp(obj.x + dx, r, M - r);
    if (!circleSolid(game.grid, nx, obj.y, r)) obj.x = nx;
    const ny = U.clamp(obj.y + dy, r, M - r);
    if (!circleSolid(game.grid, obj.x, ny, r)) obj.y = ny;
  }

  class Player {
    constructor(x, y, game) {
      this.x = x;
      this.y = y;
      this.mods = {};
      this.stats = Upgrades.stats(this.mods);
      this.maxHp = this.stats.maxHp;
      this.hp = this.maxHp;
      this.shield = 0;
      this.shieldT = 10;
      this.angle = -Math.PI / 2;
      this.bodyAng = Math.PI;
      this.cdT = 0;
      this.invT = 2;
      this.hitI = 0;
      this.overT = 0;
      this.flash = 0;
      this.muzzleT = 0;
      this.alive = true;
      this.r = 0.34;
      this.size = 0.64;
      this.id = 'player';
      this.game = game;
    }
    update(dt) {
      const K = Input.keys;
      const up = K.has('KeyW') || K.has('ArrowUp');
      const dn = K.has('KeyS') || K.has('ArrowDown');
      const lf = K.has('KeyA') || K.has('ArrowLeft');
      const rt = K.has('KeyD') || K.has('ArrowRight');
      let vx = (dn ? 1 : 0) - (up ? 1 : 0) + (rt ? 1 : 0) - (lf ? 1 : 0);
      let vy = (dn ? 1 : 0) - (up ? 1 : 0) - (rt ? 1 : 0) + (lf ? 1 : 0);
      if (window.Gamepad && Gamepad.active) {
        const gx = Gamepad.axes[0];
        const gy = Gamepad.axes[1];
        vx += gx + gy;
        vy += -gx + gy;
      }
      if (vx !== 0 || vy !== 0) {
        const l = Math.hypot(vx, vy);
        vx /= l; vy /= l;
        moveCircle(this.game, this, vx * this.stats.speed * dt, vy * this.stats.speed * dt);
        const ta = Math.atan2(vy, vx);
        this.bodyAng += U.angDiff(this.bodyAng, ta) * Math.min(1, dt * 10);
      }
      const cam = this.game.cam;
      const mw = M3D.unproj(cam, Input.mouse.x, Input.mouse.y, 0.3);
      this.angle = Math.atan2(mw[1] - this.y, mw[0] - this.x);
      this.cdT -= dt;
      this.invT -= dt;
      this.hitI -= dt;
      this.overT -= dt;
      this.flash -= dt;
      this.muzzleT -= dt;
      if (this.shield > 0 && this.stats.shieldMax > 0) {
        this.shieldT += dt;
        if (this.shieldT > 2.5) this.shield = Math.min(this.stats.shieldMax * this.maxHp, this.shield + this.maxHp * 0.08 * dt);
      }
      if (Input.mouse.down || K.has('Space') || (window.Gamepad && Gamepad.down(0))) this.tryFire();
    }
    tryFire() {
      if (this.cdT > 0 || !this.alive) return;
      const st = this.stats;
      this.cdT = st.cd * (this.overT > 0 ? 0.62 : 1);
      const n = st.shots;
      for (let s = 0; s < n; s++) {
        const off = (s - (n - 1) / 2) * 0.15;
        const a = this.angle + off;
        const mx = this.x + Math.cos(a) * 0.55;
        const my = this.y + Math.sin(a) * 0.55;
        const dmg = st.dmg * (this.overT > 0 ? 1.3 : 1);
        this.game.bullets.push(new Bullet(mx, my, 0.32, a, st.bspd, dmg, 'player', st.pierce, st.explodeR, st.explodePct, st.homing, [255, 224, 130], 0.1));
      }
      SFX.fire();
      this.game.fx.addMuzzle(this.x + Math.cos(this.angle) * 0.6, this.y + Math.sin(this.angle) * 0.6, 0.34, this.angle);
      this.game.fx.addShake(1.1);
      this.muzzleT = 0.06;
    }
    takeDamage(d) {
      if (!this.alive || this.invT > 0 || this.hitI > 0) return;
      d *= this.stats.armor;
      if (this.shield > 0) {
        const ab = Math.min(this.shield, d);
        this.shield -= ab;
        d -= ab;
      }
      this.hp -= d;
      this.flash = 0.12;
      this.hitI = 0.6;
      this.shieldT = 0;
      SFX.hurt();
      this.game.fx.addShake(5);
      this.game.fx.addNumber(this.x, this.y, 0.9, Math.round(d), [255, 120, 100], true);
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        this.game.onPlayerDeath();
      }
    }
    draw(ctx, cam) {
      const s = this.size;
      if (this.invT > 0 && Math.floor(this.game.t * 16) % 2 === 0) ctx.globalAlpha = 0.55;
      drawTank(ctx, cam, this, [212, 172, 62], s, 0.62, this.muzzleT, this.flash, false);
      const sideC = [235, 235, 225];
      M3D.drawBox(ctx, cam, this.x - Math.sin(this.bodyAng) * s * 0.26, this.y + Math.cos(this.bodyAng) * s * 0.26, 0.2, s * 0.3, 0.03, 0.03, this.bodyAng, sideC);
      M3D.drawBox(ctx, cam, this.x + Math.sin(this.bodyAng) * s * 0.26, this.y - Math.cos(this.bodyAng) * s * 0.26, 0.2, s * 0.3, 0.03, 0.03, this.bodyAng, sideC);
      const ax = this.x - Math.cos(this.bodyAng) * s * 0.28;
      const ay = this.y - Math.sin(this.bodyAng) * s * 0.28;
      M3D.drawBox(ctx, cam, ax, ay, 0.42, 0.02, 0.02, 0.16, this.bodyAng, [60, 62, 66]);
      if (Math.floor(this.game.t * 3) % 2 === 0)
        M3D.drawBox(ctx, cam, ax, ay, 0.6, 0.035, 0.035, 0.03, this.bodyAng, [255, 70, 60], { glow: 0.6 });
      if (this.overT > 0) {
        M3D.diamond(ctx, cam, this.x, this.y, s * 0.85, 0.03, U.rgb([255, 150, 50]), 0.35 + 0.2 * Math.sin(this.game.t * 12));
      }
      ctx.globalAlpha = 1;
    }
  }

  class Enemy {
    constructor(game, type, x, y, elite, stage) {
      const def = Stages.ETYPES[type];
      const cfg = Stages.config(stage);
      this.id = nextId++;
      this.type = type;
      this.x = x;
      this.y = y;
      this.elite = elite;
      this.maxHp = def.hp * cfg.hpMul * (elite ? 2.2 : 1);
      this.hp = this.maxHp;
      this.dmg = def.dmg * cfg.dmgMul * (elite ? 1.4 : 1);
      this.cd = def.cd * U.rand(0.85, 1.2);
      this.cdT = U.rand(0.6, 1.6);
      this.speed = def.speed * cfg.spdMul;
      this.bspd = def.bspd;
      this.score = Math.round(def.score * (elite ? 2 : 1));
      this.size = def.size * (elite ? 1.12 : 1);
      this.color = def.color;
      this.r = def.r;
      this.angle = U.rand(0, U.TAU);
      this.bodyAng = this.angle;
      this.path = null;
      this.pathT = 0;
      this.wpt = 0;
      this.strafeDir = U.chance(0.5) ? 1 : -1;
      this.strafeT = U.rand(1, 2.4);
      this.tele = 0;
      this.flash = 0;
      this.alive = true;
      this.spawnT = 0.45;
      this.wanderA = U.rand(0, U.TAU);
      this.wanderT = 0;
      this.seed = U.rand(0, 10);
    }
    steer(dt, game, tx, ty) {
      const dx = tx - this.x, dy = ty - this.y;
      const d = Math.hypot(dx, dy) || 1;
      moveCircle(game, this, dx / d * this.speed * dt, dy / d * this.speed * dt);
      this.bodyAng += U.angDiff(this.bodyAng, Math.atan2(dy, dx)) * Math.min(1, dt * 8);
    }
    update(dt, game) {
      const p = game.player;
      this.spawnT -= dt;
      this.flash -= dt;
      this.cdT -= dt;
      const d = p.alive ? U.dist(this.x, this.y, p.x, p.y) : 99;
      if (this.type === 'turret') {
        if (p.alive) {
          const ta = Math.atan2(p.y - this.y, p.x - this.x);
          this.angle += U.angDiff(this.angle, ta) * Math.min(1, dt * 2.2);
        }
        if (p.alive && this.cdT <= 0 && d < 10 && Math.abs(U.angDiff(this.angle, Math.atan2(p.y - this.y, p.x - this.x))) < 0.06 && Stages.los(game.grid, this.x, this.y, p.x, p.y)) {
          this.fire(game);
          this.cdT = this.cd * U.rand(0.85, 1.25);
        }
        return;
      }
      if (!p.alive) {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderA = U.rand(0, U.TAU);
          this.wanderT = U.rand(0.8, 2);
        }
        moveCircle(game, this, Math.cos(this.wanderA) * this.speed * 0.4 * dt, Math.sin(this.wanderA) * this.speed * 0.4 * dt);
        return;
      }
      this.pathT -= dt;
      if (this.pathT <= 0 || this.path === null) {
        this.path = Stages.findPath(game.grid, this.x, this.y, p.x, p.y);
        this.pathT = 0.8 + Math.random() * 0.5;
        this.wpt = 0;
      }
      if (this.type === 'sniper') {
        if (d > 6) this.followPath(dt, game);
        else if (d < 3.4) this.steer(dt, game, this.x + (this.x - p.x), this.y + (this.y - p.y));
        else {
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = U.rand(1.2, 2.5); }
          const sa = Math.atan2(p.y - this.y, p.x - this.x) + Math.PI / 2 * this.strafeDir;
          moveCircle(game, this, Math.cos(sa) * this.speed * 0.8 * dt, Math.sin(sa) * this.speed * 0.8 * dt);
          this.bodyAng += U.angDiff(this.bodyAng, sa) * Math.min(1, dt * 6);
        }
      } else       if (this.type === 'exploder') {
        if (d < 0.65) {
          game.explodeAt(this.x, this.y, 1.8, 34 * Stages.config(game.stage).dmgMul, [255, 140, 60], false);
          this.hp = 0;
          return;
        }
        this.followPath(dt, game);
      } else {
        this.followPath(dt, game);
      }
      if (this.type !== 'exploder' && this.cdT <= 0 && d < 9.5) {
        const ta = Math.atan2(p.y - this.y, p.x - this.x);
        const los = Stages.los(game.grid, this.x, this.y, p.x, p.y);
        if (los) {
          if (this.type === 'sniper') {
            this.tele += dt;
            if (this.tele > 0.75) {
              this.fire(game);
              this.cdT = this.cd * U.rand(0.9, 1.2);
              this.tele = 0;
            }
          } else if (Math.abs(U.angDiff(this.angle, ta)) < 0.6) {
            this.fire(game);
            this.cdT = this.cd * U.rand(0.85, 1.3);
          }
        } else {
          this.tele = 0;
        }
      } else {
        this.tele = Math.max(0, this.tele - dt * 2);
      }
      if (p.alive) {
        const ta = Math.atan2(p.y - this.y, p.x - this.x);
        this.angle += U.angDiff(this.angle, ta) * Math.min(1, dt * (this.type === 'sniper' ? 5 : 6));
      }
      const es = game.enemies;
      for (let i = 0; i < es.length; i++) {
        const o = es[i];
        if (o === this || !o.alive) continue;
        const dx = this.x - o.x, dy = this.y - o.y;
        const dd = Math.hypot(dx, dy);
        const min = this.r + o.r;
        if (dd > 0.001 && dd < min) {
          const push = (min - dd) * 0.5;
          moveCircle(game, this, dx / dd * push * dt * 8, dy / dd * push * dt * 8);
        }
      }
    }
    followPath(dt, game) {
      const p = game.player;
      if (this.path && this.wpt < this.path.length) {
        const wp = this.path[this.wpt];
        const dx = wp[0] - this.x, dy = wp[1] - this.y;
        const dd = Math.hypot(dx, dy);
        if (dd < 0.35) { this.wpt++; return; }
        moveCircle(game, this, dx / dd * this.speed * dt, dy / dd * this.speed * dt);
        this.bodyAng += U.angDiff(this.bodyAng, Math.atan2(dy, dx)) * Math.min(1, dt * 8);
      } else {
        this.steer(dt, game, p.x, p.y);
      }
    }
    fire(game) {
      const p = game.player;
      const a = Math.atan2(p.y - this.y, p.x - this.x) + U.rand(-0.09, 0.09) * (this.type === 'sniper' ? 0.5 : 1);
      const off = this.type === 'sniper' ? 0.8 : 0.5;
      game.bullets.push(new Bullet(
        this.x + Math.cos(a) * off, this.y + Math.sin(a) * off, 0.3, a, this.bspd, this.dmg,
        'enemy', 0, 0, 0, 0, this.type === 'sniper' ? [255, 140, 220] : [255, 110, 90], this.type === 'sniper' ? 0.09 : 0.1
      ));
      SFX.efire();
      game.fx.addMuzzle(this.x + Math.cos(a) * off, this.y + Math.sin(a) * off, 0.32, a);
    }
    draw(ctx, cam, game) {
      const s = this.size;
      if (this.spawnT > 0) {
        const k = this.spawnT / 0.45;
        M3D.diamond(ctx, cam, this.x, this.y, s * (1 + k), 0.04, U.rgb([120, 180, 255]), (1 - k) * 0.5);
      }
      if (this.elite) {
        M3D.diamond(ctx, cam, this.x, this.y, s * 0.8, 0.02, U.rgb([255, 200, 60]), 0.4 + 0.2 * Math.sin(game.t * 5 + this.seed));
      }
      const barrelLen = this.type === 'sniper' ? 1.05 : (this.type === 'heavy' ? 0.75 : 0.6);
      drawTank(ctx, cam, this, this.color, s, barrelLen, 0, this.flash, this.elite);
      if (this.type === 'exploder') {
        const bl = 0.5 + 0.5 * Math.sin(game.t * 12 + this.seed);
        M3D.drawBox(ctx, cam, this.x, this.y, 0.5, 0.05, 0.05, 0.04, this.angle, [255, 60, 40], { glow: bl });
      }
      if (this.type === 'sniper' && this.tele > 0 && game.player.alive) {
        const p = game.player;
        const p1 = M3D.proj(cam, this.x, this.y, 0.35);
        const p2 = M3D.proj(cam, p.x, p.y, 0.3);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.strokeStyle = U.rgba([255, 80, 120], Math.min(0.8, this.tele / 0.75) * 0.7);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (this.hp < this.maxHp) {
        const pp = M3D.proj(cam, this.x, this.y, s * 0.9);
        const w = 34 * cam.s;
        const k = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(pp[0] - w / 2, pp[1] - 8, w, 4);
        ctx.fillStyle = k > 0.4 ? '#6fe06f' : '#e05555';
        ctx.fillRect(pp[0] - w / 2, pp[1] - 8, w * k, 4);
      }
    }
  }

  class Boss {
    constructor(game, st) {
      this.id = nextId++;
      this.type = st.type;
      this.name = st.name;
      this.nameEn = st.nameEn;
      this.x = 7.5;
      this.y = 7.5;
      this.hp = st.hp;
      this.maxHp = st.hp;
      this.dmg = st.dmg;
      this.r = st.r;
      this.size = st.size;
      this.color = st.color;
      this.score = st.score;
      this.alive = true;
      this.flash = 0;
      this.invT = 2.2;
      this.state = 'enter';
      this.stateT = 1.4;
      this.scale = 0;
      this.angle = Math.PI;
      this.bodyAng = Math.PI;
      this.atkT = 1.6;
      this.atkIdx = 0;
      this.burstN = 0;
      this.burstT = 0;
      this.spiralT = 0;
      this.spiralStep = 0;
      this.spiralTurn = 0;
      this.headA = 0;
      this.mineT = 3.5;
      this.summonT = 6;
      this.chargeVx = 0;
      this.chargeVy = 0;
      this.chargeT = 0;
      this.teleA = 0;
      this.phase = 1;
      this.seenPhase = 0;
    }
    update(dt, game) {
      if (!this.alive) return;
      this.flash -= dt;
      this.invT -= dt;
      if (this.state === 'enter') {
        this.stateT -= dt;
        this.scale = Math.max(0, 1 - this.stateT / 1.4);
        if (this.stateT <= 0) {
          this.scale = 1;
          this.state = 'active';
          SFX.boss();
          game.fx.addShake(9);
          game.fx.addExplosion(this.x, this.y, 0.4, 2.2, [255, 120, 80]);
        }
        return;
      }
      const p = game.player;
      const ratio = this.hp / this.maxHp;
      if (ratio < 0.66 && this.seenPhase < 2) {
        this.seenPhase = 2;
        this.phase = 2;
        this.invT = Math.max(this.invT, 0.8);
        SFX.warn();
        game.fx.addShake(7);
        game.fx.addBolt(this.x - 2, this.y - 2, 0.5, this.x + 2, this.y + 2, 0.5, [255, 90, 90]);
      }
      if (ratio < 0.33 && this.seenPhase < 3) {
        this.seenPhase = 3;
        this.phase = 3;
        this.invT = Math.max(this.invT, 0.8);
        SFX.warn();
        game.fx.addShake(9);
      }
      const speedMul = this.phase >= 2 ? 1.18 : 1;
      if (this.state === 'chargeTele') {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.state = 'charge';
          this.chargeT = 0.75;
          this.chargeVx = Math.cos(this.teleA) * 9.5;
          this.chargeVy = Math.sin(this.teleA) * 9.5;
          SFX.hurt();
          game.fx.addShake(6);
        }
      } else if (this.state === 'charge') {
        this.chargeT -= dt;
        this.x += this.chargeVx * dt;
        this.y += this.chargeVy * dt;
        const i = Math.floor(this.x), j = Math.floor(this.y);
        if (i >= 0 && j >= 0 && i < M && j < M && game.grid[j][i] === 1) {
          const w = Stages.wallAt(game, i, j);
          if (w) {
            w.hp -= 3;
            w.flash = 0.2;
          }
        }
        this.x = U.clamp(this.x, 0.8, M - 0.8);
        this.y = U.clamp(this.y, 0.8, M - 0.8);
        if (p.alive && U.dist(this.x, this.y, p.x, p.y) < this.r + p.r + 0.15) {
          p.takeDamage(26 * speedMul);
        }
        game.fx.addHitSpark(this.x, this.y, 0.1, [255, 160, 90]);
        if (this.chargeT <= 0 || Stages.isSolid(game.grid, this.x + this.chargeVx * 0.1, this.y + this.chargeVy * 0.1)) {
          this.state = 'active';
          this.atkT = 1.6;
          game.fx.addExplosion(this.x, this.y, 0.2, 1.4);
          game.fx.addShake(8);
        }
      } else {
        if (p.alive) {
          const d = U.dist(this.x, this.y, p.x, p.y);
          const want = this.type === 'carrier' ? 3.2 : 4.5;
          if (d > want + 0.8) {
            const a = Math.atan2(p.y - this.y, p.x - this.x);
            moveCircle(game, this, Math.cos(a) * 0.85 * speedMul * dt, Math.sin(a) * 0.85 * speedMul * dt);
          } else if (d < want - 1.5) {
            const a = Math.atan2(this.y - p.y, this.x - p.x);
            moveCircle(game, this, Math.cos(a) * 0.6 * dt, Math.sin(a) * 0.6 * dt);
          }
          this.bodyAng += U.angDiff(this.bodyAng, Math.atan2(p.y - this.y, p.x - this.x)) * Math.min(1, dt * 2);
        }
        if (p.alive) {
          const ta = Math.atan2(p.y - this.y, p.x - this.x);
          this.angle += U.angDiff(this.angle, ta) * Math.min(1, dt * 2.5);
        }
        this.headA += dt * 0.9;
        if (this.burstN > 0) {
          this.burstT -= dt;
          while (this.burstT <= 0 && this.burstN > 0) {
            const a = this.angle + U.rand(-0.16, 0.16);
            this.shoot(a, 7.5, this.dmg);
            this.burstN--;
            this.burstT += 0.17;
          }
        }
        if (this.spiralT > 0) {
          this.spiralT -= dt;
          this.spiralStep -= dt;
          while (this.spiralStep <= 0 && this.spiralT > 0) {
            this.spiralTurn += 0.55;
            const heads = this.type === 'hydra' ? 3 : 1;
            for (let h = 0; h < heads; h++) {
              const ha = this.type === 'hydra' ? this.headA + h * (U.TAU / 3) : this.spiralTurn;
              this.shoot(ha, 6, this.dmg * 0.8, this.type === 'hydra' ? [Math.cos(ha) * 0.6, Math.sin(ha) * 0.6] : null);
            }
            this.spiralStep += this.phase >= 3 ? 0.09 : 0.12;
          }
        }
        this.atkT -= dt * speedMul;
        if (this.atkT <= 0) this.nextAttack(game);
        if (this.type === 'carrier' || this.type === 'titan') {
          this.mineT -= dt;
          if (this.mineT <= 0 && p.alive) {
            this.mineT = this.type === 'titan' ? 4.5 : 3.8;
            const a = U.rand(0, U.TAU);
            const mx = U.clamp(this.x + Math.cos(a) * 0.9, 1, M - 1);
            const my = U.clamp(this.y + Math.sin(a) * 0.9, 1, M - 1);
            game.mines.push(new Mine(mx, my));
            SFX.click();
          }
          this.summonT -= dt;
          if (this.summonT <= 0 && game.enemies.length < (this.type === 'titan' ? 3 : 4)) {
            this.summonT = this.type === 'titan' ? 10 : 8;
            const sp = Stages.spawnPoint(game);
            game.enemies.push(new Enemy(game, 'scout', sp[0], sp[1], false, game.stage));
            game.fx.addSpawn(sp[0], sp[1]);
          }
        }
      }
    }
    nextAttack(game) {
      const p = game.player;
      const cyc = this.phase >= 2 ? 0.86 : 1;
      if (this.type === 'goliath') {
        const idx = this.atkIdx % 3;
        if (idx === 0) { this.burstN = 3; this.burstT = 0; this.atkT = 2.4 * cyc; }
        else if (idx === 1) {
          const off = U.rand(0, U.TAU);
          for (let i = 0; i < 12; i++) this.shoot(off + i * (U.TAU / 12), 5.5, this.dmg * 0.85);
          this.atkT = 3.0 * cyc;
        } else {
          this.state = 'chargeTele';
          this.stateT = 0.95;
          this.teleA = Math.atan2(p.y - this.y, p.x - this.x);
          this.atkT = 3.4 * cyc;
        }
      } else if (this.type === 'hydra') {
        const idx = this.atkIdx % 2;
        if (idx === 0) {
          this.spiralT = 1.15;
          this.spiralStep = 0;
          this.atkT = 4.2 * cyc;
        } else {
          for (let h = 0; h < 3; h++) {
            const ha = this.headA + h * (U.TAU / 3);
            const off = [Math.cos(ha) * 0.6, Math.sin(ha) * 0.6];
            this.shoot(this.angle + U.rand(-0.08, 0.08), 7, this.dmg, off);
          }
          this.atkT = 2.6 * cyc;
        }
      } else if (this.type === 'carrier') {
        const idx = this.atkIdx % 2;
        if (idx === 0) {
          this.burstN = 2;
          this.burstT = 0;
          this.atkT = 2.8 * cyc;
        } else {
          for (let i = 0; i < 8; i++) this.shoot(i * (U.TAU / 8) + this.headA, 4.8, this.dmg * 0.7);
          this.atkT = 3.6 * cyc;
        }
      } else {
        const idx = this.atkIdx % 4;
        if (idx === 0) {
          const off = U.rand(0, U.TAU);
          for (let i = 0; i < 14; i++) this.shoot(off + i * (U.TAU / 14), 6, this.dmg * 0.8);
          this.atkT = 3.2 * cyc;
        } else if (idx === 1) {
          this.burstN = 4;
          this.burstT = 0;
          this.atkT = 2.6 * cyc;
        } else if (idx === 2) {
          this.spiralT = 1.3;
          this.spiralStep = 0;
          this.atkT = 3.8 * cyc;
        } else {
          this.state = 'chargeTele';
          this.stateT = 0.9;
          this.teleA = Math.atan2(p.y - this.y, p.x - this.x);
          this.atkT = 4.0 * cyc;
        }
      }
      this.atkIdx++;
    }
    shoot(a, spd, dmg, off) {
      const ox = off ? off[0] : Math.cos(a) * 0.85;
      const oy = off ? off[1] : Math.sin(a) * 0.85;
      const bx = this.x + ox;
      const by = this.y + oy;
      const g = window.__game;
      if (!g) return;
      g.bullets.push(new Bullet(bx, by, 0.35, a, spd, dmg, 'boss', 0, 0, 0, 0, [255, 170, 120], 0.12));
      SFX.efire();
      g.fx.addMuzzle(bx, by, 0.38, a);
    }
    takeDamage(d) {
      if (!this.alive || this.invT > 0) return 0;
      this.hp -= d;
      this.flash = 0.08;
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        window.__game.onBossDeath(this);
      }
      return d;
    }
    draw(ctx, cam, game) {
      const s = this.size * this.scale;
      if (this.scale <= 0.01) return;
      M3D.drawShadow(ctx, cam, this.x, this.y, s * 0.75);
      const t = game.t;
      const c = this.color;
      if (this.type === 'hydra') {
        M3D.drawBox(ctx, cam, this.x, this.y, 0.2, s * 0.4, s * 0.4, 0.2, this.bodyAng, c, { glow: this.flash * 6 });
        for (let h = 0; h < 3; h++) {
          const ha = this.headA + h * (U.TAU / 3);
          const hx = this.x + Math.cos(ha) * s * 0.42;
          const hy = this.y + Math.sin(ha) * s * 0.42;
          M3D.drawBox(ctx, cam, hx, hy, 0.32, 0.16, 0.16, 0.14, ha, U.darken(c, 0.15), { glow: this.flash * 6 });
          M3D.drawBox(ctx, cam, hx + Math.cos(ha) * 0.3, hy + Math.sin(ha) * 0.3, 0.34, 0.2, 0.05, 0.05, ha, [70, 72, 78], { glow: this.flash * 6 });
        }
        M3D.drawBox(ctx, cam, this.x, this.y, 0.52, 0.12, 0.12, 0.06, t, [255, 90, 70], { glow: 0.5 + 0.3 * Math.sin(t * 6) });
      } else if (this.type === 'carrier') {
        M3D.drawBox(ctx, cam, this.x, this.y, 0.18, s * 0.55, s * 0.36, 0.18, this.bodyAng, c, { glow: this.flash * 6 });
        for (let k = 0; k < 4; k++) {
          const gx = (k % 2 === 0 ? -1 : 1) * s * 0.32;
          const gy = (k < 2 ? -1 : 1) * s * 0.2;
          const px = this.x + Math.cos(this.bodyAng) * gx - Math.sin(this.bodyAng) * gy;
          const py = this.y + Math.sin(this.bodyAng) * gx + Math.cos(this.bodyAng) * gy;
          M3D.drawBox(ctx, cam, px, py, 0.42, 0.13, 0.13, 0.1, this.bodyAng, U.darken(c, 0.25));
        }
        M3D.drawBox(ctx, cam, this.x + Math.cos(this.angle) * s * 0.5, this.y + Math.sin(this.angle) * s * 0.5, 0.34, s * 0.45, 0.09, 0.09, this.angle, [80, 82, 90], { glow: this.flash * 6 });
      } else {
        M3D.drawBox(ctx, cam, this.x, this.y, 0.22, s * 0.5, s * 0.44, 0.22, this.bodyAng, c, { glow: this.flash * 6 });
        M3D.drawBox(ctx, cam, this.x - Math.sin(this.bodyAng) * s * 0.42, this.y + Math.cos(this.bodyAng) * s * 0.42, 0.16, s * 0.4, s * 0.12, 0.12, this.bodyAng, U.darken(c, 0.3));
        M3D.drawBox(ctx, cam, this.x + Math.sin(this.bodyAng) * s * 0.42, this.y - Math.cos(this.bodyAng) * s * 0.42, 0.16, s * 0.4, s * 0.12, 0.12, this.bodyAng, U.darken(c, 0.3));
        const bl = s * 0.55;
        if (this.type === 'titan') {
          M3D.drawBox(ctx, cam, this.x + Math.cos(this.angle - 0.12) * bl * 0.6, this.y + Math.sin(this.angle - 0.12) * bl * 0.6, 0.4, bl * 0.5, 0.06, 0.06, this.angle - 0.12, [70, 72, 78], { glow: this.flash * 6 });
          M3D.drawBox(ctx, cam, this.x + Math.cos(this.angle + 0.12) * bl * 0.6, this.y + Math.sin(this.angle + 0.12) * bl * 0.6, 0.4, bl * 0.5, 0.06, 0.06, this.angle + 0.12, [70, 72, 78], { glow: this.flash * 6 });
          M3D.drawBox(ctx, cam, this.x, this.y, 0.56, 0.16, 0.16, 0.08, t, [255, 200, 80], { glow: 0.6 + 0.3 * Math.sin(t * 5) });
        } else {
          M3D.drawBox(ctx, cam, this.x + Math.cos(this.angle - 0.14) * bl * 0.6, this.y + Math.sin(this.angle - 0.14) * bl * 0.6, 0.4, bl * 0.55, 0.07, 0.07, this.angle - 0.14, [70, 72, 78], { glow: this.flash * 6 });
          M3D.drawBox(ctx, cam, this.x + Math.cos(this.angle + 0.14) * bl * 0.6, this.y + Math.sin(this.angle + 0.14) * bl * 0.6, 0.4, bl * 0.55, 0.07, 0.07, this.angle + 0.14, [70, 72, 78], { glow: this.flash * 6 });
          M3D.drawBox(ctx, cam, this.x, this.y, 0.54, 0.14, 0.14, 0.07, t, [255, 90, 60], { glow: 0.5 + 0.3 * Math.sin(t * 7) });
        }
      }
      if (this.state === 'chargeTele') {
        const p = M3D.proj(cam, this.x, this.y, 0.05);
        const p2 = M3D.proj(cam, this.x + Math.cos(this.teleA) * 9, this.y + Math.sin(this.teleA) * 9, 0.05);
        const k = 0.4 + 0.4 * Math.sin(t * 20);
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.strokeStyle = U.rgba([255, 70, 50], k);
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = U.rgba([255, 200, 180], k);
        ctx.stroke();
      }
      if (this.invT > 0 && this.state === 'active' && Math.floor(t * 10) % 2 === 0) {
        M3D.diamond(ctx, cam, this.x, this.y, s * 0.9, 0.06, U.rgb([160, 200, 255]), 0.25);
      }
    }
  }

  class Bullet {
    constructor(x, y, z, ang, spd, dmg, from, pierce, explodeR, explodePct, homing, color, size) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.vx = Math.cos(ang) * spd;
      this.vy = Math.sin(ang) * spd;
      this.spd = spd;
      this.dmg = dmg;
      this.from = from;
      this.pierceLeft = pierce;
      this.explodeR = explodeR;
      this.explodePct = explodePct || 0.5;
      this.homing = homing;
      this.life = 2.6;
      this.color = color || (from === 'player' ? [255, 224, 130] : [255, 110, 90]);
      this.size = size || 0.1;
      this.alive = true;
      this.hitIds = {};
    }
    _target(game) {
      if (this.from === 'player') {
        let best = null, bd = 1e9;
        for (let i = 0; i < game.enemies.length; i++) {
          const e = game.enemies[i];
          if (!e.alive) continue;
          const d = U.dist(this.x, this.y, e.x, e.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (game.boss && game.boss.alive) {
          const d = U.dist(this.x, this.y, game.boss.x, game.boss.y);
          if (d < bd) { bd = d; best = game.boss; }
        }
        return best;
      }
      return game.player.alive ? game.player : null;
    }
    update(dt, game) {
      this.life -= dt;
      if (this.life <= 0) { this.alive = false; return; }
      if (this.homing > 0) {
        const t = this._target(game);
        if (t && this.life > 0.25) {
          const cur = Math.atan2(this.vy, this.vx);
          const des = Math.atan2(t.y - this.y, t.x - this.x);
          const na = cur + U.clamp(U.angDiff(cur, des), -this.homing * dt, this.homing * dt);
          this.vx = Math.cos(na) * this.spd;
          this.vy = Math.sin(na) * this.spd;
        }
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy) * dt / 0.12));
      const sdt = dt / steps;
      for (let s = 0; s < steps && this.alive; s++) {
        this.x += this.vx * sdt;
        this.y += this.vy * sdt;
        if (this.x < 0.05 || this.y < 0.05 || this.x > M - 0.05 || this.y > M - 0.05) {
          game.fx.addHitSpark(this.x, this.y, this.z, this.color);
          this.alive = false;
          if (this.explodeR > 0) game.explodeAt(this.x, this.y, this.explodeR, this.dmg * this.explodePct, this.color, this.from === 'player');
          break;
        }
        const i = Math.floor(this.x), j = Math.floor(this.y);
        if (i >= 0 && j >= 0 && i < M && j < M) {
          const c = game.grid[j][i];
          if (c === 1 || c === 2) {
            const w = Stages.wallAt(game, i, j);
            if (w) {
              w.flash = 0.15;
              if (c === 1) {
                w.hp -= 1;
                SFX.brick();
                if (w.hp <= 0) game.destroyWall(w);
              } else {
                SFX.metal();
              }
            }
            game.fx.addHitSpark(this.x, this.y, this.z, c === 1 ? [220, 150, 100] : [210, 220, 235]);
            this.alive = false;
            if (this.explodeR > 0 && this.from === 'player') game.explodeAt(this.x, this.y, this.explodeR, this.dmg * this.explodePct, this.color, true);
            break;
          }
        }
        if (this.from === 'player') {
          let hit = false;
          if (game.boss && game.boss.alive && !this.hitIds['b']) {
            if (U.dist(this.x, this.y, game.boss.x, game.boss.y) < game.boss.r * game.boss.scale + this.size) {
              const dealt = game.boss.takeDamage(this.dmg);
              if (dealt > 0) {
                game.fx.addHitSpark(this.x, this.y, this.z, [255, 230, 160]);
                game.fx.addNumber(this.x, this.y, 0.8, Math.round(this.dmg), [255, 230, 160]);
                SFX.hit();
                this.hitIds['b'] = true;
                hit = true;
              }
            }
          }
          if (!hit) {
            for (let i = 0; i < game.enemies.length; i++) {
              const e = game.enemies[i];
              if (!e.alive || this.hitIds[e.id]) continue;
              if (U.dist(this.x, this.y, e.x, e.y) < e.r + this.size) {
                e.hp -= this.dmg;
                e.flash = 0.1;
                game.fx.addHitSpark(this.x, this.y, this.z, [255, 230, 160]);
                game.fx.addNumber(e.x, e.y, 0.7, Math.round(this.dmg), [255, 240, 200]);
                SFX.hit();
                this.hitIds[e.id] = true;
                hit = true;
                break;
              }
            }
          }
          if (!hit) {
            for (let i = 0; i < game.mines.length; i++) {
              const mn = game.mines[i];
              if (U.dist(this.x, this.y, mn.x, mn.y) < 0.35 + this.size) {
                mn.hp -= this.dmg;
                mn.flash = 0.1;
                game.fx.addHitSpark(this.x, this.y, this.z, [255, 200, 120]);
                SFX.hit();
                hit = true;
                break;
              }
            }
          }
          if (!hit) {
            for (let i = 0; i < game.bullets.length; i++) {
              const b2 = game.bullets[i];
              if (b2 === this || !b2.alive || b2.from === 'player') continue;
              if (U.dist(this.x, this.y, b2.x, b2.y) < this.size + b2.size + 0.05) {
                b2.alive = false;
                game.fx.addHitSpark(this.x, this.y, this.z, b2.color);
                SFX.hit();
                hit = true;
                break;
              }
            }
          }
          if (hit) {
            if (this.pierceLeft > 0) this.pierceLeft--;
            else {
              this.alive = false;
              if (this.explodeR > 0) game.explodeAt(this.x, this.y, this.explodeR, this.dmg * this.explodePct, this.color, true);
            }
          }
        } else {
          const p = game.player;
          if (p.alive && U.dist(this.x, this.y, p.x, p.y) < p.r + this.size) {
            p.takeDamage(this.dmg);
            this.alive = false;
          }
        }
      }
    }
    draw(ctx, cam) {
      const p = M3D.proj(cam, this.x, this.y, this.z);
      const pv = M3D.proj(cam, this.x - this.vx * 0.035, this.y - this.vy * 0.035, this.z);
      ctx.beginPath();
      ctx.moveTo(pv[0], pv[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.strokeStyle = U.rgba(this.color, 0.75);
      ctx.lineWidth = Math.max(1.5, this.size * 26 * cam.s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p[0], p[1], (2 + this.size * 26) * cam.s, 0, U.TAU);
      ctx.fillStyle = U.rgba(U.lighten(this.color, 0.55), 0.95);
      ctx.fill();
    }
  }

  class Mine {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.hp = 22;
      this.t = 9;
      this.flash = 0;
      this.alive = true;
      this.seed = U.rand(0, 10);
    }
    update(dt, game) {
      this.t -= dt;
      this.flash -= dt;
      const p = game.player;
      if (p.alive && U.dist(this.x, this.y, p.x, p.y) < 0.55) {
        this.explode(game);
        return;
      }
      if (this.t <= 0) this.explode(game);
    }
    explode(game) {
      if (!this.alive) return;
      this.alive = false;
      game.explodeAt(this.x, this.y, 1.6, 24, [255, 150, 70], false);
      SFX.boom(false);
    }
    draw(ctx, cam, game) {
      M3D.drawShadow(ctx, cam, this.x, this.y, 0.25);
      M3D.drawBox(ctx, cam, this.x, this.y, 0.14, 0.16, 0.16, 0.14, 0.6, [70, 74, 82], { glow: this.flash * 5 });
      const bl = this.t < 3 ? (Math.floor(game.t * 10) % 2 === 0 ? 1 : 0.2) : 0.6;
      M3D.drawBox(ctx, cam, this.x, this.y, 0.34, 0.05, 0.05, 0.04, 0, [255, 70, 50], { glow: bl });
    }
  }

  class Pickup {
    constructor(x, y, type) {
      this.x = x;
      this.y = y;
      this.type = type;
      this.t = U.rand(0, 10);
      this.alive = true;
    }
    update(dt, game) {
      this.t += dt;
      const p = game.player;
      if (!p.alive) return;
      const d = U.dist(this.x, this.y, p.x, p.y);
      if (d < p.stats.magnet) {
        const a = Math.atan2(p.y - this.y, p.x - this.x);
        const sp = Math.min(9, 3 + (p.stats.magnet - d) * 3);
        this.x += Math.cos(a) * sp * dt;
        this.y += Math.sin(a) * sp * dt;
      }
      if (d < 0.5) {
        this.alive = false;
        game.collectPickup(this);
      }
    }
    draw(ctx, cam) {
      const z = 0.3 + 0.1 * Math.sin(this.t * 3);
      M3D.drawShadow(ctx, cam, this.x, this.y, 0.2);
      if (this.type === 'heal') {
        M3D.drawBox(ctx, cam, this.x, this.y, z, 0.14, 0.045, 0.045, 0.7, [90, 220, 120], { glow: 0.3 });
        M3D.drawBox(ctx, cam, this.x, this.y, z, 0.045, 0.14, 0.045, 0.7, [90, 220, 120], { glow: 0.3 });
      } else if (this.type === 'over') {
        M3D.drawBox(ctx, cam, this.x, this.y, z, 0.11, 0.11, 0.11, this.t * 2, [255, 160, 50], { glow: 0.5 + 0.2 * Math.sin(this.t * 8) });
      } else {
        M3D.drawBox(ctx, cam, this.x, this.y, z, 0.13, 0.13, 0.13, this.t, [235, 70, 55], { glow: 0.4 });
        M3D.drawBox(ctx, cam, this.x, this.y, z + 0.16, 0.03, 0.03, 0.05, 0, [230, 230, 230]);
      }
    }
  }

  function drawTank(ctx, cam, e, col, s, barrelLen, muzzleT, flash, elite) {
    M3D.drawShadow(ctx, cam, e.x, e.y, s * 0.62);
    const trackC = [42, 44, 48];
    const lx = Math.cos(e.bodyAng), ly = Math.sin(e.bodyAng);
    const px = -ly, py = lx;
    M3D.drawBox(ctx, cam, e.x + px * s * 0.26, e.y + py * s * 0.26, 0.08, s * 0.31, s * 0.1, 0.08, e.bodyAng, trackC, { glow: flash * 5 });
    M3D.drawBox(ctx, cam, e.x - px * s * 0.26, e.y - py * s * 0.26, 0.08, s * 0.31, s * 0.1, 0.08, e.bodyAng, trackC, { glow: flash * 5 });
    M3D.drawBox(ctx, cam, e.x, e.y, 0.16, s * 0.3, s * 0.24, 0.12, e.bodyAng, col, { glow: flash * 6, edge: true });
    M3D.drawBox(ctx, cam, e.x, e.y, 0.32, s * 0.18, s * 0.18, 0.1, e.angle, U.lighten(col, 0.12), { glow: flash * 6, edge: true });
    M3D.drawBox(ctx, cam, e.x + Math.cos(e.angle) * (barrelLen * s) * 0.55, e.y + Math.sin(e.angle) * (barrelLen * s) * 0.55, 0.34, barrelLen * s * 0.5, 0.045, 0.045, e.angle, [72, 74, 80], { glow: flash * 6 });
    if (elite) {
      M3D.drawBox(ctx, cam, e.x, e.y, 0.44, 0.06, 0.06, 0.03, e.angle, [255, 200, 60], { glow: 0.5 });
    }
    if (muzzleT > 0) {
      const mx = e.x + Math.cos(e.angle) * (barrelLen * s + 0.15);
      const my = e.y + Math.sin(e.angle) * (barrelLen * s + 0.15);
      const mp = M3D.proj(cam, mx, my, 0.34);
      ctx.beginPath();
      ctx.arc(mp[0], mp[1], 9 * cam.s, 0, U.TAU);
      ctx.fillStyle = 'rgba(255,230,150,0.9)';
      ctx.fill();
    }
  }

  window.Player = Player;
  window.Enemy = Enemy;
  window.Boss = Boss;
  window.Bullet = Bullet;
  window.Mine = Mine;
  window.Pickup = Pickup;
})();
