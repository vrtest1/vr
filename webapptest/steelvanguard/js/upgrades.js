(function () {
  const Upgrades = {};
  Upgrades.RARITY = [
    { name: 'ノーマル', color: [154, 167, 184], weight: 100 },
    { name: 'レア', color: [77, 163, 255], weight: 40 },
    { name: 'エピック', color: [180, 92, 255], weight: 15 },
    { name: 'レジェンド', color: [255, 201, 60], weight: 5 }
  ];
  Upgrades.DEFS = [
    { id: 'dmg', name: '火力強化', en: 'DMG UP', rar: 0, max: 8, desc: 'ダメージ +14%' },
    { id: 'rate', name: '射撃強化', en: 'FIRE RATE', rar: 0, max: 8, desc: '連射速度 +11%' },
    { id: 'hp', name: '装甲増強', en: 'HP UP', rar: 0, max: 8, desc: '最大HP +25 回復+25' },
    { id: 'speed', name: 'エンジン強化', en: 'SPEED', rar: 0, max: 5, desc: '移動速度 +7%' },
    { id: 'bspd', name: '弾頭強化', en: 'BULLET SPD', rar: 0, max: 4, desc: '弾速 +12%' },
    { id: 'luck', name: 'ラッキーチャーム', en: 'LUCK', rar: 0, max: 5, desc: 'レア度が高い強化出現率アップ' },
    { id: 'armor', name: '耐弾コーティング', en: 'ARMOR', rar: 1, max: 5, desc: '被ダメージ -7%' },
    { id: 'multishot', name: 'マルチバレル', en: 'MULTISHOT', rar: 1, max: 3, desc: '同時発射弾数 +1' },
    { id: 'pierce', name: '貫通弾頭', en: 'PIERCE', rar: 1, max: 3, desc: '弾が敵を貫通 +1' },
    { id: 'explode', name: '爆装弾', en: 'EXPLOSIVE', rar: 1, max: 4, desc: '弾が着弾時爆発(周辺ダメージ)' },
    { id: 'magnet', name: 'サルベージマグネット', en: 'MAGNET', rar: 1, max: 3, desc: 'アイテム吸引範囲 +50%' },
    { id: 'repair', name: '応急修理', en: 'REPAIR', rar: 1, max: 99, desc: 'HPを40%回復' },
    { id: 'homing', name: 'シーキング制御', en: 'HOMING', rar: 2, max: 3, desc: '弾が敵を追跡する(追尾強化)' },
    { id: 'shield', name: 'シールド発生器', en: 'SHIELD', rar: 2, max: 3, desc: '最大HP比率分のシールド(自動回復)' },
    { id: 'chain', name: 'チェインシステム', en: 'CHAIN', rar: 2, max: 3, desc: '撃破時に周囲の敵へ連鎖ダメージ' },
    { id: 'nuke', name: '戦術兵器発動', en: 'TACTICAL NUKES', rar: 2, max: 99, desc: '画面内全敵に40ダメージ' },
    { id: 'plasma', name: 'プラズマコア', en: 'PLASMA CORE', rar: 3, max: 2, desc: '全弾に爆発+貫通を付与' },
    { id: 'godmode', name: 'ゴッドモード', en: 'GOD MODE', rar: 3, max: 99, desc: '6秒無敵 + HP30%回復' }
  ];
  Upgrades.defById = function (id) {
    for (let i = 0; i < Upgrades.DEFS.length; i++)
      if (Upgrades.DEFS[i].id === id) return Upgrades.DEFS[i];
    return null;
  };

  Upgrades.stats = function (mods) {
    const lv = id => (mods[id] || 0);
    const twin = lv('twin');
    const multishot = lv('multishot');
    const plasma = lv('plasma');
    return {
      maxHp: 100 + lv('hp') * 25,
      dmg: 10 * Math.pow(1.14, lv('dmg')),
      cd: 0.55 * Math.pow(0.89, lv('rate')) * Math.pow(0.85, twin),
      bspd: 10 * Math.pow(1.12, lv('bspd')),
      speed: 3.4 * Math.pow(1.07, lv('speed')),
      armor: Math.max(0.4, 1 - 0.07 * lv('armor')),
      shots: 1 + multishot + twin,
      pierce: lv('pierce') + plasma,
      explodeR: lv('explode') > 0 ? 0.7 + 0.25 * lv('explode') : (plasma > 0 ? 1.0 + 0.4 * plasma : 0),
      explodePct: 0.4 + 0.15 * Math.max(lv('explode'), plasma),
      homing: lv('homing') * 1.6,
      shieldMax: lv('shield') > 0 ? (0.2 + 0.15 * lv('shield')) : 0,
      chain: lv('chain'),
      magnet: 0.9 * (1 + 0.5 * lv('magnet')),
      luck: lv('luck')
    };
  };

  Upgrades.roll = function (mods, count) {
    count = count || 3;
    const luck = mods.luck || 0;
    const pool = [];
    for (let i = 0; i < Upgrades.DEFS.length; i++) {
      const d = Upgrades.DEFS[i];
      if ((mods[d.id] || 0) >= d.max) continue;
      let w = Upgrades.RARITY[d.rar].weight;
      if (d.rar > 0) w *= 1 + luck * 0.25;
      if (d.rar === 0 && luck > 2) w *= 0.85;
      pool.push({ d, w });
    }
    const out = [];
    while (out.length < count && pool.length > 0) {
      let sum = 0;
      for (let i = 0; i < pool.length; i++) sum += pool[i].w;
      let r = Math.random() * sum;
      let idx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r <= 0) { idx = i; break; }
      }
      out.push(pool[idx].d);
      pool.splice(idx, 1);
    }
    const fillers = [Upgrades.defById('repair'), Upgrades.defById('nuke'), Upgrades.defById('godmode')];
    while (out.length < count) out.push(fillers[out.length % fillers.length]);
    return out;
  };

  Upgrades.apply = function (game, def) {
    const p = game.player;
    p.mods[def.id] = (p.mods[def.id] || 0) + 1;
    const st = Upgrades.stats(p.mods);
    if (def.id === 'hp') {
      p.maxHp = st.maxHp;
      p.hp = Math.min(p.maxHp, p.hp + 25);
    }
    if (def.id === 'repair') p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4);
    if (def.id === 'godmode') {
      p.invT = Math.max(p.invT, 6);
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
    }
    if (def.id === 'nuke') {
      SFX.nuke();
      game.fx.addSlowmo(0.5);
      game.fx.addShake(10);
      for (let i = game.enemies.length - 1; i >= 0; i--) {
        const e = game.enemies[i];
        e.hp -= 40;
        e.flash = 0.15;
        game.fx.addHitSpark(e.x, e.y, 0.3, [255, 120, 60]);
        game.fx.addNumber(e.x, e.y, 0.6, 40, [255, 180, 90]);
      }
      if (game.boss && game.boss.alive) {
        game.boss.hp -= 40;
        game.boss.flash = 0.15;
        game.fx.addHitSpark(game.boss.x, game.boss.y, 0.5, [255, 120, 60]);
      }
      game.cleanupDead();
    }
    p.stats = st;
  };

  window.Upgrades = Upgrades;
})();
