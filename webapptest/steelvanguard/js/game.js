class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.Q = Math.min(window.devicePixelRatio || 1, 2);
    this.cam = { s: 1, ox: 640, oy: 92 };
    this.baseCam = { ox: 640, oy: 92 };
    this.state = 'menu';
    this.paused = false;
    this.t = 0;
    this.stage = 0;
    this.score = 0;
    this.best = 0;
    try { this.best = parseInt(localStorage.getItem('sv_best')) || 0; } catch (e) { this.best = 0; }
    this.lives = 3;
    this.combo = 0;
    this.comboT = 0;
    this.timescale = 1;
    this.grid = null;
    this.walls = [];
    this.bushes = [];
    this.player = null;
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.mines = [];
    this.boss = null;
    this.cfg = null;
    this.toSpawn = 0;
    this.spawnT = 0;
    this.introT = 0;
    this.clearing = false;
    this.clearT = 0;
    this.bossWarn = 0;
    this.escT = 8;
    this.respawnT = 0;
    this.cards = null;
    this.cardT = 0;
    this.hoverCard = -1;
    this.flashT = 0;
    this.banner = null;
    this.fx = new FX();
    this.stageT = 0;
    this.floorC = null;
    this.vignetteC = null;
    Input.init(canvas);
    window.__game = this;
    window.__onBlur = () => {
      if ((this.state === 'play' || this.state === 'intro') && !this.paused) this.paused = true;
    };
    this.prerenderVignette();
  }

  prerenderVignette() {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 800;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(640, 400, 300, 640, 400, 780);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = g;
    x.fillRect(0, 0, 1280, 800);
    this.vignetteC = c;
  }

  prerenderFloor() {
    const c = document.createElement('canvas');
    c.width = this.canvas.width || 1280;
    c.height = this.canvas.height || 800;
    const q = this.Q || 1;
    const x = c.getContext('2d');
    x.setTransform(q, 0, 0, q, 0, 0);
    const cam = this.cam;
    const M = Stages.MAP;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const col = (i + j) % 2 === 0 ? '#242c40' : '#1f2637';
        M3D.drawQuad(x, cam, [[i, j, 0], [i + 1, j, 0], [i + 1, j + 1, 0], [i, j + 1, 0]], col, undefined, 'rgba(255,255,255,0.05)');
      }
    }
    M3D.drawQuad(x, cam, [[-0.4, -0.4, -0.16], [M + 0.4, -0.4, -0.16], [M + 0.4, M + 0.4, -0.16], [-0.4, M + 0.4, -0.16]], '#0b0e16');
    const edge = 'rgba(80,140,220,0.35)';
    M3D.drawQuad(x, cam, [[0, 0, 0], [M, 0, 0], [M, 0.12, 0], [0.12, 0.12, 0]], edge);
    M3D.drawQuad(x, cam, [[0, 0, 0], [0.12, 0.12, 0], [0.12, M, 0], [0, M, 0]], edge);
    this.floorC = c;
  }

  startRun() {
    this.score = 0;
    this.lives = 3;
    this.combo = 0;
    this.comboT = 0;
    this.paused = false;
    this.player = new Player(13.4, 13.4, this);
    this.startStage(1);
    SFX.startMusic(this.cfg.boss ? 'boss' : 'normal');
  }

  startStage(n) {
    this.stage = n;
    this.cfg = Stages.config(n);
    const map = Stages.genMap(n);
    this.grid = map.grid;
    this.walls = map.walls;
    this.bushes = map.bushes;
    this.enemies = [];
    this.bullets = [];
    this.pickups = [];
    this.mines = [];
    this.boss = null;
    this.toSpawn = this.cfg.boss ? 0 : this.cfg.total;
    this.spawnT = 1.2;
    this.stageT = 0;
    this.introT = this.cfg.boss ? 3.2 : 2.1;
    this.bossWarn = this.cfg.boss ? 3.2 : 0;
    this.clearing = false;
    this.clearT = 0;
    this.escT = 9;
    this.respawnT = 0;
    this.banner = null;
    this.timescale = 1;
    this.hoverCard = -1;
    if (this.player) {
      this.player.x = map.playerSpawn[0];
      this.player.y = map.playerSpawn[1];
      this.player.cdT = 0.6;
      this.player.invT = Math.max(this.player.invT, 2);
      if (!this.player.alive) {
        this.player.alive = true;
        this.player.hp = this.player.maxHp;
        this.player.shield = 0;
      }
    }
    this.prerenderFloor();
    this.state = 'intro';
  }

  spawnBoss() {
    const st = Stages.bossStats(this.stage);
    this.boss = new Boss(this, st);
  }

  update(dt) {
    this.t += dt;
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.life) this.banner = null;
    }
    if (Input.pressed('KeyM')) SFX.toggleMute();
    if (this.state === 'menu') {
      if (Input.pressed('Enter') || Input.pressed('Space') || Input.mouse.downOnce) {
        SFX.init();
        SFX.resume();
        SFX.click();
        this.startRun();
      }
      SFX.update();
      return;
    }
    if (this.state === 'gameover') {
      if (Input.pressed('Enter')) {
        this.state = 'menu';
        SFX.startMusic('menu');
        SFX.click();
      }
      if (Input.pressed('KeyR')) {
        SFX.click();
        this.startRun();
      }
      SFX.update();
      return;
    }
    if (Input.pressed('KeyP')) {
      this.paused = !this.paused;
      SFX.click();
    }
    if (this.paused) {
      SFX.update();
      return;
    }
    if (this.state === 'upgrade') {
      this.cardT += dt;
      this.hoverCard = -1;
      for (let i = 0; i < this.cards.length; i++) {
        const rc = UI.cardRect(i);
        if (Input.mouse.x >= rc.x && Input.mouse.x <= rc.x + rc.w && Input.mouse.y >= rc.y && Input.mouse.y <= rc.y + rc.h) this.hoverCard = i;
      }
      if (Input.pressed('Digit1') || Input.pressed('Numpad1')) this.pickCard(0);
      else if (Input.pressed('Digit2') || Input.pressed('Numpad2')) this.pickCard(1);
      else if (Input.pressed('Digit3') || Input.pressed('Numpad3')) this.pickCard(2);
      else if (Input.mouse.downOnce && this.hoverCard >= 0) this.pickCard(this.hoverCard);
      SFX.update();
      return;
    }
    let gdt = dt * this.timescale;
    if (this.fx.slowmo > 0) this.timescale = Math.min(this.timescale, 0.35);
    else this.timescale = Math.min(1, this.timescale + dt * 2.5);
    if (this.state === 'intro') {
      this.introT -= dt;
      if (this.introT <= 0) this.state = 'play';
    }
    if (this.clearing) {
      this.clearT -= dt;
      if (this.clearT <= 0) {
        this.clearing = false;
        this.state = 'upgrade';
        this.cardT = 0;
        this.cards = Upgrades.roll(this.player.mods, 3);
      }
    }
    this.updateWorld(gdt);
    SFX.update();
    this.fx.update(gdt);
    this.flashT -= dt;
  }

  updateWorld(dt) {
    this.stageT += dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    const p = this.player;

    if (this.state === 'play' && !this.clearing) {
      if (this.cfg.boss) {
        if (this.bossWarn > 0) {
          this.bossWarn -= dt;
          if (this.bossWarn <= 0) {
            this.spawnBoss();
            SFX.boss();
          }
        } else if (this.boss && this.boss.alive) {
          this.escT -= dt;
          if (this.escT <= 0 && this.enemies.length < 4) {
            this.escT = 9;
            const sp = Stages.spawnPoint(this);
            this.enemies.push(new Enemy(this, 'scout', sp[0], sp[1], false, this.stage));
            this.fx.addSpawn(sp[0], sp[1]);
          }
        }
      } else if (this.toSpawn > 0) {
        this.spawnT -= dt;
        if (this.spawnT <= 0 && this.enemies.length < this.cfg.concurrent) {
          const type = Stages.pickType(this.cfg);
          let x, y;
          if (type === 'turret') {
            const sp = Stages.turretSpot(this);
            if (sp) { x = sp[0]; y = sp[1]; }
            else { this.spawnT = 1; }
          }
          if (type !== 'turret' || (x !== undefined && y !== undefined)) {
            const sp = type === 'turret' ? [x, y] : Stages.spawnPoint(this);
            const elite = U.chance(this.cfg.eliteChance);
            this.enemies.push(new Enemy(this, type, sp[0], sp[1], elite, this.stage));
            this.fx.addSpawn(sp[0], sp[1]);
            this.toSpawn--;
            this.spawnT = this.cfg.interval * U.rand(0.7, 1.4);
          }
        }
      }
    }

    if (p && p.alive) p.update(dt);
    if (!p.alive && this.respawnT > 0 && this.state === 'play') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        p.shield = 0;
        p.invT = 3;
        const sp = Stages.PLAYER_SPAWN;
        p.x = sp[0];
        p.y = sp[1];
        for (let i = this.bullets.length - 1; i >= 0; i--) {
          const b = this.bullets[i];
          if (b.from !== 'player' && U.dist(b.x, b.y, p.x, p.y) < 4) b.alive = false;
        }
        this.fx.addSpawn(p.x, p.y);
      }
    }

    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);
    if (this.boss && this.boss.alive) this.boss.update(dt, this);
    for (let i = 0; i < this.bullets.length; i++) this.bullets[i].update(dt, this);
    for (let i = 0; i < this.mines.length; i++) this.mines[i].update(dt, this);
    for (let i = 0; i < this.pickups.length; i++) this.pickups[i].update(dt, this);
    for (let i = 0; i < this.walls.length; i++) this.walls[i].flash = Math.max(0, this.walls[i].flash - dt);

    this.cleanupDead();

    if (this.state === 'play' && !this.clearing && !this.cfg.boss && this.toSpawn === 0 && this.enemies.length === 0) {
      this.clearing = true;
      this.clearT = 1.3;
      SFX.clear();
      this.banner = { txt: 'STAGE CLEAR', sub: 'STAGE ' + this.stage + ' 突破', t: 0, life: 1.6, col: '#9fe8ff' };
      this.fx.addConfetti(p.x, p.y, 0.5);
      this.fx.addSlowmo(0.4);
    }
    if (this.state === 'play' && !this.clearing && this.cfg.boss && this.boss && !this.boss.alive && this.enemies.length === 0) {
      this.clearing = true;
      this.clearT = 1.5;
      SFX.clear();
      this.banner = { txt: 'STAGE CLEAR', sub: 'BOSS撃破 !', t: 0, life: 1.8, col: '#ffd27a' };
      this.fx.addConfetti(p.x, p.y, 0.5);
    }
  }

  cleanupDead() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.alive && e.hp <= 0) this.killEnemy(e);
    }
    this.enemies = this.enemies.filter(e => e.alive);
    this.bullets = this.bullets.filter(b => b.alive);
    this.mines = this.mines.filter(m => m.alive);
    this.pickups = this.pickups.filter(pk => pk.alive);
  }

  killEnemy(e) {
    e.alive = false;
    this.combo++;
    this.comboT = 3;
    const mult = Math.min(3, 1 + this.combo * 0.1);
    this.score += Math.round(e.score * mult / 5) * 5;
    const sc = e.size > 0.7 ? 1.5 : 1;
    this.fx.addExplosion(e.x, e.y, 0.3, sc, e.elite ? [255, 210, 90] : [255, 160, 60]);
    this.fx.addShake(e.size > 0.7 ? 5 : 3);
    SFX.boom(e.size > 0.7);
    const dropMul = e.elite ? 2 : 1;
    const r = Math.random();
    if (r < 0.08 * dropMul) this.pickups.push(new Pickup(e.x, e.y, 'heal'));
    else if (r < 0.11 * dropMul) this.pickups.push(new Pickup(e.x, e.y, 'over'));
    else if (r < 0.13 * dropMul) this.pickups.push(new Pickup(e.x, e.y, 'nuke'));
    if (this.player.mods.chain > 0 && this.player.alive) this.chainDamage(e);
  }

  chainDamage(src) {
    const lv = this.player.mods.chain;
    const range = 2 + 0.7 * lv;
    const dmg = this.player.stats.dmg * 0.6;
    let best = null, bd = 1e9;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.alive || e === src) continue;
      const d = U.dist(src.x, src.y, e.x, e.y);
      if (d < range && d < bd) { bd = d; best = e; }
    }
    if (this.boss && this.boss.alive && this.boss !== src) {
      const d = U.dist(src.x, src.y, this.boss.x, this.boss.y);
      if (d < range && d < bd) { bd = d; best = this.boss; }
    }
    if (best) {
      this.fx.addBolt(src.x, src.y, 0.4, best.x, best.y, 0.4, [160, 220, 255]);
      if (best === this.boss) this.boss.takeDamage(dmg);
      else {
        best.hp -= dmg;
        best.flash = 0.1;
        this.fx.addNumber(best.x, best.y, 0.7, Math.round(dmg), [160, 220, 255]);
      }
      SFX.hit();
    }
  }

  onBossDeath(boss) {
    const mult = Math.min(3, 1 + this.combo * 0.1);
    this.score += Math.round(boss.score * mult / 5) * 5;
    this.combo = 0;
    this.fx.addSlowmo(1.0);
    this.fx.addShake(14);
    SFX.boom(true);
    SFX.boom(true);
    for (let k = 0; k < 4; k++) {
      this.fx.addExplosion(boss.x + U.rand(-1, 1), boss.y + U.rand(-1, 1), 0.4, 1.8 + U.rand(0, 1), [255, 150, 70]);
    }
    this.fx.addConfetti(boss.x, boss.y, 0.6);
    this.pickups.push(new Pickup(boss.x - 0.8, boss.y, 'heal'));
    this.pickups.push(new Pickup(boss.x + 0.8, boss.y, 'over'));
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      this.fx.addExplosion(e.x, e.y, 0.3, 0.8);
      this.score += e.score;
      e.alive = false;
    }
  }

  onPlayerDeath() {
    this.fx.addExplosion(this.player.x, this.player.y, 0.4, 2.4, [255, 170, 80]);
    this.fx.addShake(13);
    this.fx.addSlowmo(0.7);
    SFX.die();
    this.lives--;
    this.combo = 0;
    if (this.lives > 0) {
      this.respawnT = 1.6;
      this.banner = { txt: '再出撃', sub: '残りライフ ' + this.lives, t: 0, life: 1.4, col: '#9fe8ff' };
    } else {
      this.respawnT = 0;
      this.state = 'gameover';
      if (this.score > this.best) {
        this.best = this.score;
        try { localStorage.setItem('sv_best', String(this.best)); } catch (e) {}
      }
      SFX.stopMusic();
    }
  }

  explodeAt(x, y, r, dmg, col, fromPlayer) {
    this.fx.addExplosion(x, y, 0.25, r * 0.9, col || [255, 160, 60]);
    this.fx.addShake(4);
    SFX.boom(false);
    const p = this.player;
    if (fromPlayer) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e.alive) continue;
        const d = U.dist(x, y, e.x, e.y);
        if (d < r + e.r) {
          e.hp -= dmg * (1 - 0.5 * d / (r + e.r));
          e.flash = 0.12;
        }
      }
      if (this.boss && this.boss.alive) {
        const d = U.dist(x, y, this.boss.x, this.boss.y);
        if (d < r + this.boss.r) this.boss.takeDamage(dmg * (1 - 0.4 * d / (r + this.boss.r)));
      }
      for (let i = 0; i < this.mines.length; i++) {
        const m = this.mines[i];
        if (m.alive && U.dist(x, y, m.x, m.y) < r + 0.3) m.hp -= 30;
      }
    } else if (p && p.alive) {
      if (U.dist(x, y, p.x, p.y) < r + p.r) p.takeDamage(dmg);
    }
    const M = Stages.MAP;
    const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(M - 1, Math.floor(x + r));
    const j0 = Math.max(0, Math.floor(y - r)), j1 = Math.min(M - 1, Math.floor(y + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.grid[j][i] === 1) {
          const w = Stages.wallAt(this, i, j);
          if (w) {
            w.hp -= 3;
            w.flash = 0.2;
            if (w.hp <= 0) this.destroyWall(w);
          }
        }
      }
    }
  }

  destroyWall(w) {
    if (w.hp <= 0 && w.dead) return;
    w.hp = 0;
    w.dead = true;
    this.grid[w.j][w.i] = 0;
    this.fx.addDebris(w.i + 0.5, w.j + 0.5, 0.2, w.type === 1 ? [160, 90, 60] : [150, 158, 172], w.type === 1 ? 8 : 10);
    SFX.brick();
    this.fx.addShake(1.5);
  }

  collectPickup(pk) {
    const p = this.player;
    SFX.pickup();
    if (pk.type === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + 22);
      this.fx.addNumber(p.x, p.y, 0.9, '+22', [120, 235, 140], true);
    } else if (pk.type === 'over') {
      p.overT = 5;
      this.fx.addNumber(p.x, p.y, 0.9, 'OVER DRIVE!', [255, 180, 80], true);
    } else {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.hp -= 30;
        e.flash = 0.15;
      }
      if (this.boss && this.boss.alive) this.boss.hp -= 30;
      this.fx.addShake(7);
      SFX.nuke();
      this.banner = { txt: 'TACTICAL NUKES', sub: '全敵に30ダメージ', t: 0, life: 1.2, col: '#ff9d7a' };
    }
  }

  pickCard(i) {
    if (i < 0 || i >= this.cards.length) return;
    const def = this.cards[i];
    SFX.upgrade();
    this.flashT = 0.3;
    Upgrades.apply(this, def);
    this.startStage(this.stage + 1);
    if (this.cfg.boss) SFX.startMusic('boss');
    else SFX.startMusic('normal');
  }

  draw(ctx) {
    const cam = this.cam;
    const shake = this.fx.shake;
    cam.ox = this.baseCam.ox + (Math.random() * 2 - 1) * shake;
    cam.oy = this.baseCam.oy + (Math.random() * 2 - 1) * shake;

    const bg = ctx.createLinearGradient(0, 0, 0, 800);
    bg.addColorStop(0, '#0a0d18');
    bg.addColorStop(0.6, '#0d1120');
    bg.addColorStop(1, '#080a12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1280, 800);

    if (this.state === 'menu') {
      UI.drawMenu(ctx, this);
      ctx.drawImage(this.vignetteC, 0, 0, 1280, 800);
      return;
    }

    if (this.floorC) ctx.drawImage(this.floorC, 0, 0, 1280, 800);

    for (let s = 0; s < Stages.SPAWNS.length; s++) {
      const sp = Stages.SPAWNS[s];
      M3D.diamond(ctx, cam, sp[0], sp[1], 0.55, 0.03, U.rgb([90, 150, 230]), 0.16 + 0.1 * Math.sin(this.t * 3 + s));
    }

    const list = [];
    const add = (key, fn) => list.push({ key, fn });
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      if (w.hp <= 0) continue;
      add(M3D.depth(w.i + 0.5, w.j + 0.5, 0.5), () => this.drawWall(ctx, cam, w));
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      add(M3D.depth(e.x, e.y, 0.2), () => e.draw(ctx, cam, this));
    }
    if (this.boss) {
      const b = this.boss;
      add(M3D.depth(b.x, b.y, 0.2), () => b.draw(ctx, cam, this));
    }
    if (this.player && this.player.alive) {
      const p = this.player;
      add(M3D.depth(p.x, p.y, 0.2), () => p.draw(ctx, cam));
    }
    for (let i = 0; i < this.mines.length; i++) {
      const m = this.mines[i];
      add(M3D.depth(m.x, m.y, 0.1), () => m.draw(ctx, cam, this));
    }
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      add(M3D.depth(pk.x, pk.y, 0.3), () => pk.draw(ctx, cam));
    }
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      add(M3D.depth(b.x, b.y, b.z), () => b.draw(ctx, cam));
    }
    list.sort((a, b2) => b2.key - a.key);
    for (let i = 0; i < list.length; i++) list[i].fn();

    this.drawBushes(ctx, cam);
    this.fx.draw(ctx, cam);

    UI.drawHUD(ctx, this);
    UI.drawBanner(ctx, this);

    if (this.state === 'intro') UI.drawIntro(ctx, this);
    if (this.state === 'upgrade' && this.cards) UI.drawUpgrade(ctx, this);
    if (this.state === 'gameover') UI.drawGameOver(ctx, this);
    if (this.paused && this.state !== 'gameover') UI.drawPause(ctx);

    if (this.flashT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.7, this.flashT * 2) + ')';
      ctx.fillRect(0, 0, 1280, 800);
    }
    ctx.drawImage(this.vignetteC, 0, 0, 1280, 800);
  }

  drawWall(ctx, cam, w) {
    const cx = w.i + 0.5, cy = w.j + 0.5;
    if (w.type === 1) {
      const h = 0.42 * (0.6 + 0.4 * (w.hp / w.maxHp));
      const col = w.hp === 3 ? [156, 84, 56] : w.hp === 2 ? [140, 74, 50] : [120, 62, 44];
      M3D.drawBox(ctx, cam, cx, cy, h, 0.48, 0.48, h, 0, col, { glow: w.flash * 5, edge: true });
      if (w.seed % 3 === 0)
        M3D.drawBox(ctx, cam, cx + 0.12, cy - 0.1, h + 0.05, 0.12, 0.1, 0.08, 0.4, U.darken(col, 0.2));
    } else {
      M3D.drawBox(ctx, cam, cx, cy, 0.45, 0.47, 0.47, 0.45, 0, [148, 158, 174], { glow: w.flash * 5, edge: true });
      M3D.drawBox(ctx, cam, cx, cy, 0.45, 0.3, 0.3, 0.06, 0, [100, 108, 122]);
      M3D.drawBox(ctx, cam, cx, cy, 0.72, 0.1, 0.1, 0.12, w.seed % 6, [190, 198, 214], { glow: 0.2 });
    }
  }

  drawBushes(ctx, cam) {
    const hash = n => {
      const s = Math.sin(n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let b = 0; b < this.bushes.length; b++) {
      const bu = this.bushes[b];
      const cx = bu.i + 0.5, cy = bu.j + 0.5;
      for (let k = 0; k < 4; k++) {
        const hx = cx + (hash(bu.seed + k * 1.7) - 0.5) * 0.75;
        const hy = cy + (hash(bu.seed + k * 2.3 + 5) - 0.5) * 0.75;
        const hr = 0.16 + 0.12 * hash(bu.seed + k * 3.1);
        const hz = 0.04 + 0.1 * hash(bu.seed + k * 4.7);
        const pr = M3D.proj(cam, hx, hy, hz);
        const rr = hr * 30 * cam.s;
        ctx.globalAlpha = 0.82;
        ctx.beginPath();
        ctx.arc(pr[0], pr[1], rr, 0, U.TAU);
        ctx.fillStyle = '#2c5c33';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pr[0], pr[1] - rr * 0.35, rr * 0.62, 0, U.TAU);
        ctx.fillStyle = '#3d7a42';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}
window.Game = Game;
