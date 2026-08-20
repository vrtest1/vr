(function () {
  const Stages = {};
  const MAP = 15;
  Stages.MAP = MAP;

  Stages.SPAWNS = [
    [1.0, 2.6],
    [1.0, 7.6],
    [2.6, 1.0],
    [7.6, 1.0],
    [12.4, 1.0]
  ];
  Stages.PLAYER_SPAWN = [13.4, 13.4];

  Stages.ETYPES = {
    scout: {
      name: 'スカウト', hp: 20, speed: 2.7, dmg: 8, cd: 1.7, bspd: 6.5, score: 100,
      size: 0.5, color: [128, 148, 126], r: 0.3
    },
    assault: {
      name: 'アサルト', hp: 36, speed: 2.0, dmg: 12, cd: 1.5, bspd: 7, score: 150,
      size: 0.58, color: [168, 124, 88], r: 0.32
    },
    heavy: {
      name: 'ヘビー', hp: 85, speed: 1.25, dmg: 20, cd: 2.3, bspd: 6, score: 300,
      size: 0.82, color: [112, 118, 128], r: 0.42
    },
    sniper: {
      name: 'スナイパー', hp: 30, speed: 1.9, dmg: 26, cd: 2.9, bspd: 10, score: 250,
      size: 0.5, color: [142, 100, 150], r: 0.28
    },
    exploder: {
      name: '爆走', hp: 26, speed: 3.1, dmg: 0, cd: 0, bspd: 0, score: 120,
      size: 0.52, color: [205, 122, 58], r: 0.3
    },
    turret: {
      name: '砲台', hp: 105, speed: 0, dmg: 15, cd: 1.3, bspd: 7.5, score: 200,
      size: 0.62, color: [118, 128, 148], r: 0.38
    }
  };

  Stages.BOSSES = {
    goliath: {
      name: 'ゴルアス', nameEn: 'GOLIATH', hp: 620, dmg: 14, r: 0.95, size: 1.6,
      color: [158, 62, 48], score: 5000
    },
    hydra: {
      name: 'ヒドラ', nameEn: 'HYDRA', hp: 850, dmg: 12, r: 0.9, size: 1.5,
      color: [62, 128, 92], score: 8000
    },
    carrier: {
      name: 'キャリアー', nameEn: 'CARRIER', hp: 1100, dmg: 13, r: 1.0, size: 1.7,
      color: [96, 108, 142], score: 12000
    },
    titan: {
      name: 'タイタン', nameEn: 'TITAN', hp: 1500, dmg: 16, r: 1.1, size: 1.9,
      color: [74, 74, 88], score: 20000
    }
  };

  Stages.config = function (stage) {
    const total = Math.min(60, 10 + stage * 2);
    const concurrent = Math.min(8, 4 + Math.floor(stage / 3));
    const interval = Math.max(0.9, 2.6 - stage * 0.12);
    const weights = {
      scout: 10,
      assault: stage >= 1 ? 8 : 0,
      exploder: stage >= 2 ? 5 : 0,
      heavy: stage >= 3 ? 5 : 0,
      sniper: stage >= 4 ? 4 : 0,
      turret: stage >= 6 ? 3 : 0
    };
    const eliteChance = Math.min(0.35, 0.04 + stage * 0.015);
    const hpMul = stage <= 5
      ? 0.7 + (stage - 1) * (1.52 - 0.7) / 4
      : 1 + (stage - 1) * 0.13;
    const spdMul = Math.min(1, 0.7 + (stage - 1) * 0.3 / 4);
    const dmgMul = 1 + (stage - 1) * 0.045;
    const boss = stage % 5 === 0;
    let bossType = null;
    if (boss) {
      const order = ['goliath', 'hydra', 'carrier', 'titan'];
      bossType = order[Math.floor((stage / 5 - 1)) % 4];
    }
    return {
      total, concurrent, interval, weights, eliteChance, hpMul, spdMul, dmgMul,
      boss, bossType,
      bossCycle: boss ? Math.floor((stage - 5) / 5) : 0
    };
  };

  Stages.bossStats = function (stage) {
    const cfg = Stages.config(stage);
    const def = Stages.BOSSES[cfg.bossType];
    const mult = Math.pow(1.7, cfg.bossCycle);
    return {
      type: cfg.bossType,
      name: def.name,
      nameEn: def.nameEn,
      hp: Math.round(def.hp * mult),
      dmg: Math.round(def.dmg * (1 + cfg.bossCycle * 0.25)),
      r: def.r,
      size: def.size,
      color: def.color,
      score: def.score * (1 + cfg.bossCycle)
    };
  };

  Stages.pickType = function (cfg) {
    let sum = 0;
    for (const k in cfg.weights) sum += cfg.weights[k];
    if (sum <= 0) return 'scout';
    let r = Math.random() * sum;
    for (const k in cfg.weights) {
      r -= cfg.weights[k];
      if (r <= 0) return k;
    }
    return 'scout';
  };

  Stages.cellAt = function (grid, x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= MAP || j >= MAP) return -1;
    return grid[j][i];
  };
  Stages.isSolid = function (grid, x, y) {
    const c = Stages.cellAt(grid, x, y);
    return c === 1 || c === 2;
  };

  Stages.los = function (grid, ax, ay, bx, by) {
    const d = U.dist(ax, ay, bx, by);
    const n = Math.max(1, Math.ceil(d / 0.1));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const c = Stages.cellAt(grid, x, y);
      if (c === 1 || c === 2) return false;
    }
    return true;
  };

  Stages.findPath = function (grid, sx, sy, tx, ty) {
    const ci = U.clamp(Math.floor(sx), 0, MAP - 1);
    const cj = U.clamp(Math.floor(sy), 0, MAP - 1);
    const ti = U.clamp(Math.floor(tx), 0, MAP - 1);
    const tj = U.clamp(Math.floor(ty), 0, MAP - 1);
    if (ci === ti && cj === tj) return null;
    const key = (i, j) => j * MAP + i;
    const pass = (i, j) => grid[j][i] !== 1 && grid[j][i] !== 2;
    const prev = new Int32Array(MAP * MAP).fill(-1);
    const q = [key(ci, cj)];
    prev[key(ci, cj)] = key(ci, cj);
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const cxi = cur % MAP, cyj = (cur / MAP) | 0;
      if (cxi === ti && cyj === tj) {
        const path = [];
        let c = cur;
        while (c !== key(ci, cj)) {
          path.push([c % MAP + 0.5, ((c / MAP) | 0) + 0.5]);
          c = prev[c];
        }
        path.reverse();
        return path;
      }
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let d = 0; d < 4; d++) {
        const ni = cxi + dirs[d][0], nj = cyj + dirs[d][1];
        if (ni < 0 || nj < 0 || ni >= MAP || nj >= MAP) continue;
        const nk = key(ni, nj);
        if (prev[nk] !== -1) continue;
        if (!pass(ni, nj)) continue;
        prev[nk] = cur;
        q.push(nk);
      }
    }
    return null;
  };

  Stages.genMap = function (stage) {
    const grid = new Array(MAP * MAP);
    for (let j = 0; j < MAP; j++) {
      grid[j] = new Array(MAP).fill(0);
    }
    const rng = U.mulberry32((stage * 7919 + 13) | 0);
    const r = () => rng();
    const rand = (a, b) => a + r() * (b - a);
    const randi = (a, b) => Math.floor(rand(a, b + 1));
    const chance = p => r() < p;

    const solidBudget = Math.min(64, 26 + stage * 2);
    let placed = 0;
    let guard = 0;
    const steelP = Math.min(0.38, 0.12 + stage * 0.015);
    while (placed < solidBudget && guard < 800) {
      guard++;
      const i = randi(0, MAP - 1), j = randi(0, MAP - 1);
      const w = randi(1, 3), h = randi(1, 2);
      if (chance(0.5)) {
        for (let x = 0; x < w; x++) {
          const gi = i + x;
          if (gi < 0 || gi >= MAP) continue;
          if (grid[j][gi] !== 0) continue;
          grid[j][gi] = chance(steelP) ? 2 : 1;
          placed++;
        }
      } else {
        for (let y = 0; y < h; y++) {
          const gj = j + y;
          if (gj < 0 || gj >= MAP) continue;
          if (grid[gj][i] !== 0) continue;
          grid[gj][i] = chance(steelP) ? 2 : 1;
          placed++;
        }
      }
    }

    const clearZone = (cx, cy, rad) => {
      const i0 = Math.max(0, Math.floor(cx - rad)), i1 = Math.min(MAP - 1, Math.floor(cx + rad));
      const j0 = Math.max(0, Math.floor(cy - rad)), j1 = Math.min(MAP - 1, Math.floor(cy + rad));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++)
          grid[j][i] = 0;
    };
    clearZone(Stages.PLAYER_SPAWN[0], Stages.PLAYER_SPAWN[1], 1.6);
    for (let s = 0; s < Stages.SPAWNS.length; s++)
      clearZone(Stages.SPAWNS[s][0], Stages.SPAWNS[s][1], 1.2);

    if (stage % 5 === 0) {
      clearZone(7.5, 7.5, 3.2);
    }

    let bushes = 0;
    const bushTarget = Math.min(14, 6 + Math.floor(stage / 2));
    guard = 0;
    while (bushes < bushTarget && guard < 400) {
      guard++;
      const i = randi(1, MAP - 2), j = randi(1, MAP - 2);
      if (grid[j][i] !== 0) continue;
      grid[j][i] = 3;
      bushes++;
      if (chance(0.7)) {
        const nj = j + (chance(0.5) ? 1 : -1);
        if (nj >= 0 && nj < MAP && grid[nj][i] === 0) { grid[nj][i] = 3; bushes++; }
      }
    }

    const passable = (i, j) => grid[j][i] !== 1 && grid[j][i] !== 2;
    const reachable = (fromX, fromY) => {
      const ci = U.clamp(Math.floor(fromX), 0, MAP - 1);
      const cj = U.clamp(Math.floor(fromY), 0, MAP - 1);
      const seen = new Uint8Array(MAP * MAP);
      const q = [cj * MAP + ci];
      seen[q[0]] = 1;
      let head = 0;
      const out = new Uint8Array(MAP * MAP);
      while (head < q.length) {
        const cur = q[head++];
        out[cur] = 1;
        const cxi = cur % MAP, cyj = (cur / MAP) | 0;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let d = 0; d < 4; d++) {
          const ni = cxi + dirs[d][0], nj = cyj + dirs[d][1];
          if (ni < 0 || nj < 0 || ni >= MAP || nj >= MAP) continue;
          const nk = nj * MAP + ni;
          if (seen[nk] || !passable(ni, nj)) continue;
          seen[nk] = 1;
          q.push(nk);
        }
      }
      return out;
    };
    let reach = reachable(Stages.PLAYER_SPAWN[0], Stages.PLAYER_SPAWN[1]);
    const spawnOK = () => {
      for (let s = 0; s < Stages.SPAWNS.length; s++) {
        const si = U.clamp(Math.floor(Stages.SPAWNS[s][0]), 0, MAP - 1);
        const sj = U.clamp(Math.floor(Stages.SPAWNS[s][1]), 0, MAP - 1);
        if (!reach[sj * MAP + si]) return false;
      }
      return true;
    };
    let fixGuard = 0;
    while (!spawnOK() && fixGuard < 300) {
      fixGuard++;
      let found = false;
      for (let tries = 0; tries < 30 && !found; tries++) {
        const i = randi(0, MAP - 1), j = randi(0, MAP - 1);
        if (grid[j][i] === 1 || grid[j][i] === 2) {
          grid[j][i] = 0;
          found = true;
        }
      }
      if (!found) break;
      reach = reachable(Stages.PLAYER_SPAWN[0], Stages.PLAYER_SPAWN[1]);
    }
    if (!spawnOK()) {
      for (let j = 0; j < MAP; j++)
        for (let i = 0; i < MAP; i++)
          if (grid[j][i] === 1 || grid[j][i] === 2) grid[j][i] = 0;
    }

    const walls = [];
    for (let j = 0; j < MAP; j++) {
      for (let i = 0; i < MAP; i++) {
        if (grid[j][i] === 1) walls.push({ i, j, type: 1, hp: 3, maxHp: 3, flash: 0, seed: randi(0, 9999) });
        else if (grid[j][i] === 2) walls.push({ i, j, type: 2, hp: 999, maxHp: 999, flash: 0, seed: randi(0, 9999) });
      }
    }
    const bushesList = [];
    for (let j = 0; j < MAP; j++) {
      for (let i = 0; i < MAP; i++) {
        if (grid[j][i] === 3) bushesList.push({ i, j, seed: randi(0, 9999) });
      }
    }
    return { grid, walls, bushes: bushesList, playerSpawn: Stages.PLAYER_SPAWN.slice() };
  };

  Stages.wallAt = function (game, i, j) {
    for (let k = 0; k < game.walls.length; k++) {
      const w = game.walls[k];
      if (w.i === i && w.j === j && w.hp > 0) return w;
    }
    return null;
  };

  Stages.spawnPoint = function (game) {
    for (let tries = 0; tries < 12; tries++) {
      const s = U.pick(Stages.SPAWNS);
      const x = s[0] + U.rand(-0.3, 0.3);
      const y = s[1] + U.rand(-0.3, 0.3);
      let ok = true;
      for (let k = 0; k < game.enemies.length; k++) {
        if (U.dist(game.enemies[k].x, game.enemies[k].y, x, y) < 1.2) { ok = false; break; }
      }
      if (ok) return [x, y];
    }
    const s = U.pick(Stages.SPAWNS);
    return [s[0], s[1]];
  };

  Stages.turretSpot = function (game) {
    for (let tries = 0; tries < 40; tries++) {
      const i = U.randi(1, 13), j = U.randi(1, 13);
      if (game.grid[j][i] !== 0) continue;
      const x = i + 0.5, y = j + 0.5;
      if (U.dist(x, y, game.player.x, game.player.y) < 5.5) continue;
      let ok = true;
      for (let k = 0; k < game.enemies.length; k++) {
        if (U.dist(game.enemies[k].x, game.enemies[k].y, x, y) < 1.5) { ok = false; break; }
      }
      if (ok) return [x, y];
    }
    return null;
  };

  window.Stages = Stages;
})();
