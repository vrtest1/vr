(function () {
  const UI = {};
  UI.LW = 1280;
  UI.LH = 800;

  UI.cardRect = function (i) {
    const w = 250, h = 348;
    const cx = 640 + (i - 1) * 285;
    return { x: cx - w / 2, y: 168, w, h, cx };
  };

  UI.drawBar = function (ctx, x, y, w, h, k, colBg, colFg, border) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = colBg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colFg;
    ctx.fillRect(x, y, w * U.clamp(k, 0, 1), h);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    }
  };

  UI.drawTankIcon = function (ctx, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = col;
    ctx.fillRect(-s, -s * 0.7, s * 2, s * 1.4);
    ctx.fillRect(-s * 0.5, -s * 0.45, s, s * 0.9);
    ctx.fillRect(-s * 0.12, -s * 1.3, s * 0.24, s * 1.0);
    ctx.restore();
  };

  UI.drawHUD = function (ctx, game) {
    const p = game.player;
    ctx.textAlign = 'left';
    ctx.font = "bold 17px 'Arial', sans-serif";
    ctx.fillStyle = '#9fb2c8';
    ctx.fillText('STAGE', 24, 34);
    ctx.font = "bold 30px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = '#eef4ff';
    ctx.fillText(String(game.stage), 92, 38);
    if (game.stage % 5 === 0) {
      ctx.font = "bold 14px 'Arial', sans-serif";
      ctx.fillStyle = '#ff8a6a';
      ctx.fillText('BOSS戦', 92, 56);
    }

    const hpW = 230;
    UI.drawBar(ctx, 24, 66, hpW, 16, p.hp / p.maxHp, '#3a1214', p.hp / p.maxHp > 0.35 ? '#5fd97a' : '#e05555', 'rgba(255,255,255,0.25)');
    ctx.font = "bold 12px 'Arial', sans-serif";
    ctx.fillStyle = '#dff2ff';
    ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, 30, 79);
    if (p.stats.shieldMax > 0) {
      UI.drawBar(ctx, 24, 88, hpW, 8, p.shield / (p.stats.shieldMax * p.maxHp), '#10203a', '#5fc9ff', 'rgba(255,255,255,0.18)');
    }
    if (p.overT > 0) {
      UI.drawBar(ctx, 24, 102, hpW * (p.overT / 5), 6, p.overT / 5, '#3a2410', '#ffb347', 'rgba(255,255,255,0.18)');
      ctx.font = "bold 11px 'Arial', sans-serif";
      ctx.fillStyle = '#ffb347';
      ctx.fillText('OVER DRIVE', 30, 120);
    }

    for (let i = 0; i < game.lives; i++) {
      UI.drawTankIcon(ctx, 30 + i * 26, 138, 8, i < game.lives ? '#f2c14e' : '#3a4150');
    }

    ctx.textAlign = 'right';
    ctx.font = "bold 15px 'Arial', sans-serif";
    ctx.fillStyle = '#9fb2c8';
    ctx.fillText('SCORE', UI.LW - 26, 30);
    ctx.font = "bold 28px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(String(game.score).padStart(8, '0'), UI.LW - 26, 58);
    ctx.font = "bold 14px 'Arial', sans-serif";
    ctx.fillStyle = '#8fa3bb';
    ctx.fillText('BEST ' + String(game.best).padStart(8, '0'), UI.LW - 26, 80);

    const remain = game.toSpawn + game.enemies.length + (game.boss && game.boss.alive ? 1 : 0);
    ctx.textAlign = 'center';
    ctx.font = "bold 15px 'Arial', sans-serif";
    ctx.fillStyle = '#9fb2c8';
    ctx.fillText('残敵', 640, 30);
    ctx.font = "bold 26px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = remain > 0 ? '#ff9d7a' : '#7df29a';
    ctx.fillText(String(remain), 640, 58);

    if (game.combo > 1) {
      const k = game.comboT / 3;
      ctx.font = "bold 22px 'Arial Black', 'Arial', sans-serif";
      ctx.fillStyle = U.rgba([255, 200, 90], 0.5 + 0.5 * k);
      ctx.fillText('COMBO x' + Math.min(3, 1 + game.combo * 0.1).toFixed(1), 640, 92);
      UI.drawBar(ctx, 600, 98, 80, 4, k, 'rgba(0,0,0,0.5)', '#ffc85a');
    }

    if (game.boss && game.boss.alive) {
      const bw = 560;
      const bx = 640 - bw / 2;
      ctx.textAlign = 'center';
      ctx.font = "bold 16px 'Arial', sans-serif";
      ctx.fillStyle = '#ff8a6a';
      ctx.fillText(game.boss.nameEn + ' - ' + game.boss.name, 640, 128);
      UI.drawBar(ctx, bx, 136, bw, 12, game.boss.hp / game.boss.maxHp, '#2a0d0d', '#ff5d4a', 'rgba(255,255,255,0.3)');
    }

    if (SFX.muted) {
      ctx.textAlign = 'right';
      ctx.font = "bold 13px 'Arial', sans-serif";
      ctx.fillStyle = '#66788f';
      ctx.fillText('MUTE (M)', UI.LW - 26, UI.LH - 18);
    }
    ctx.textAlign = 'left';
    ctx.font = "12px 'Arial', sans-serif";
    ctx.fillStyle = 'rgba(150,170,195,0.55)';
    ctx.fillText('移動:WASD/矢印  照準:マウス  射撃:クリック/Space  一時停止:P', 24, UI.LH - 18);
  };

  UI.drawBossBar = UI.drawHUD;

  UI.star = function (ctx, x, y, r, points, inner) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / points;
      const rr = i % 2 === 0 ? r : r * inner;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  UI.drawIcon = function (ctx, id, x, y, s, col) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = s * 0.14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (id) {
      case 'dmg':
        ctx.beginPath();
        ctx.arc(0, s * 0.15, s * 0.34, 0, U.TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.22, 0);
        ctx.lineTo(0, -s * 0.55);
        ctx.lineTo(s * 0.22, 0);
        ctx.closePath();
        ctx.fill();
        break;
      case 'rate':
        for (let i = 0; i < 3; i++) {
          const yy = (i - 1) * s * 0.36;
          ctx.beginPath();
          ctx.arc(-s * 0.1, yy, s * 0.16, 0, U.TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s * 0.05, yy - s * 0.1);
          ctx.lineTo(s * 0.45, yy);
          ctx.lineTo(s * 0.05, yy + s * 0.1);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case 'hp':
      case 'repair':
        ctx.fillRect(-s * 0.14, -s * 0.5, s * 0.28, s);
        ctx.fillRect(-s * 0.5, -s * 0.14, s, s * 0.28);
        break;
      case 'speed':
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-s * 0.55 + i * s * 0.4, -s * 0.4);
          ctx.lineTo(-s * 0.15 + i * s * 0.4, 0);
          ctx.lineTo(-s * 0.55 + i * s * 0.4, s * 0.4);
          ctx.stroke();
        }
        break;
      case 'bspd':
        ctx.beginPath();
        ctx.arc(s * 0.2, 0, s * 0.24, 0, U.TAU);
        ctx.fill();
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-s * 0.6, (i - 1) * s * 0.25);
          ctx.lineTo(-s * 0.12, (i - 1) * s * 0.25);
          ctx.stroke();
        }
        break;
      case 'luck':
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26, s * 0.26, 0, U.TAU);
          ctx.fill();
        }
        break;
      case 'armor':
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.55);
        ctx.lineTo(s * 0.45, -s * 0.3);
        ctx.lineTo(s * 0.38, s * 0.2);
        ctx.lineTo(0, s * 0.55);
        ctx.lineTo(-s * 0.38, s * 0.2);
        ctx.lineTo(-s * 0.45, -s * 0.3);
        ctx.closePath();
        ctx.fill();
        break;
      case 'multishot':
        for (let i = 0; i < 3; i++) {
          const yy = (i - 1) * s * 0.34;
          ctx.fillRect(-s * 0.5, yy - s * 0.08, s * 0.9, s * 0.16);
          ctx.beginPath();
          ctx.moveTo(s * 0.4, yy - s * 0.14);
          ctx.lineTo(s * 0.62, yy);
          ctx.lineTo(s * 0.4, yy + s * 0.14);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case 'pierce':
        ctx.strokeRect(-s * 0.5, -s * 0.28, s * 0.4, s * 0.56);
        ctx.strokeRect(s * 0.1, -s * 0.28, s * 0.4, s * 0.56);
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, 0);
        ctx.lineTo(s * 0.75, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 0.5, -s * 0.16);
        ctx.lineTo(s * 0.78, 0);
        ctx.lineTo(s * 0.5, s * 0.16);
        ctx.closePath();
        ctx.fill();
        break;
      case 'explode':
        UI.star(ctx, 0, 0, s * 0.6, 8, 0.45);
        ctx.fill();
        break;
      case 'magnet':
        ctx.beginPath();
        ctx.arc(0, -s * 0.1, s * 0.42, Math.PI, 0);
        ctx.stroke();
        ctx.fillRect(-s * 0.62, -s * 0.12, s * 0.24, s * 0.6);
        ctx.fillRect(s * 0.38, -s * 0.12, s * 0.24, s * 0.6);
        break;
      case 'homing':
        ctx.beginPath();
        ctx.arc(0, s * 0.1, s * 0.45, -Math.PI * 0.9, Math.PI * 0.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 0.3, -s * 0.32);
        ctx.lineTo(s * 0.55, -s * 0.5);
        ctx.lineTo(s * 0.68, -s * 0.18);
        ctx.closePath();
        ctx.fill();
        break;
      case 'shield':
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          const px = Math.cos(a) * s * 0.55, py = Math.sin(a) * s * 0.55;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        break;
      case 'chain':
        ctx.beginPath();
        ctx.moveTo(s * 0.15, -s * 0.6);
        ctx.lineTo(-s * 0.35, s * 0.08);
        ctx.lineTo(0, s * 0.08);
        ctx.lineTo(-s * 0.15, s * 0.6);
        ctx.lineTo(s * 0.38, -s * 0.1);
        ctx.lineTo(s * 0.05, -s * 0.1);
        ctx.closePath();
        ctx.fill();
        break;
      case 'nuke':
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.55, 0, U.TAU);
        ctx.fill();
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, s * 0.5, -Math.PI / 6 + i * (U.TAU / 3), Math.PI / 6 + i * (U.TAU / 3));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        break;
      case 'plasma':
        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s * 0.38, -s * 0.38, s * 0.76, s * 0.76);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.16, 0, U.TAU);
        ctx.fill();
        break;
      case 'godmode':
        UI.star(ctx, 0, 0, s * 0.62, 5, 0.45);
        ctx.fill();
        break;
      default:
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.4, 0, U.TAU);
        ctx.fill();
    }
    ctx.restore();
  };

  UI.drawMenu = function (ctx, game) {
    const t = game.t;
    const grd = ctx.createLinearGradient(0, 0, 0, UI.LH);
    grd.addColorStop(0, '#0a0e1c');
    grd.addColorStop(0.55, '#101830');
    grd.addColorStop(1, '#070910');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, UI.LW, UI.LH);

    ctx.save();
    ctx.globalAlpha = 0.16;
    for (let i = -8; i < 20; i++) {
      for (let j = -8; j < 20; j++) {
        const ox = ((i * 68 + t * 12) % (UI.LW + 136)) - 68;
        const oy = j * 44 + ((i % 2) * 22);
        ctx.beginPath();
        ctx.moveTo(ox, oy + 22);
        ctx.lineTo(ox + 34, oy);
        ctx.lineTo(ox + 68, oy + 22);
        ctx.lineTo(ox + 34, oy + 44);
        ctx.closePath();
        ctx.strokeStyle = '#3d5580';
        ctx.stroke();
      }
    }
    ctx.restore();

    const tanks = [
      { x: 320, y: 560, a: t * 0.5, c: [212, 172, 62] },
      { x: 950, y: 520, a: -t * 0.4 + 2, c: [158, 62, 48] },
      { x: 640, y: 620, a: t * 0.3 + 4, c: [62, 128, 92] }
    ];
    for (let i = 0; i < tanks.length; i++) {
      const tk = tanks[i];
      const px = tk.x + Math.sin(t * 0.3 + i * 2) * 30;
      ctx.save();
      ctx.translate(px, tk.y);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 16, 34, 14, 0, 0, U.TAU);
      ctx.fill();
      ctx.rotate(Math.sin(tk.a) * 0.2);
      ctx.fillStyle = U.rgb(U.darken(tk.c, 0.35));
      ctx.fillRect(-30, -18, 60, 34);
      ctx.fillStyle = U.rgb(U.lighten(tk.c, 0.1));
      ctx.fillRect(-16, -10, 32, 22);
      ctx.rotate(Math.sin(tk.a * 1.3) * 1.2);
      ctx.fillStyle = '#484c55';
      ctx.fillRect(-4, -40, 8, 34);
      ctx.restore();
    }

    ctx.textAlign = 'center';
    const ty = 210;
    ctx.save();
    ctx.shadowColor = 'rgba(90,160,255,0.8)';
    ctx.shadowBlur = 28;
    ctx.font = "900 84px 'Arial Black', 'Arial', sans-serif";
    const tg = ctx.createLinearGradient(0, ty - 60, 0, ty + 20);
    tg.addColorStop(0, '#f4f8ff');
    tg.addColorStop(0.5, '#9fc4ff');
    tg.addColorStop(1, '#4a6fa8');
    ctx.fillStyle = tg;
    ctx.fillText('STEEL VANGUARD', 640, ty);
    ctx.restore();
    ctx.font = "bold 30px 'Arial', sans-serif";
    ctx.fillStyle = '#ffce7a';
    ctx.fillText('鋼 鉄 突 撃 3D', 640, ty + 48);
    ctx.font = "15px 'Arial', sans-serif";
    ctx.fillStyle = '#7d92ad';
    ctx.fillText('— TANK ROGUE - AUTO STAGE / 3-CHOOSE UPGRADE / BOSS EVERY 5 —', 640, ty + 82);

    ctx.font = "bold 17px 'Arial', sans-serif";
    ctx.fillStyle = '#c4d4e8';
    const lines = [
      '移動 : WASD / 矢印キー',
      '照準 : マウス',
      '射撃 : マウス左ボタン / Space (長押し連射)',
      '一時停止 : P      音量切替 : M'
    ];
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 640, 420 + i * 30);

    if (Math.floor(t * 2) % 2 === 0) {
      ctx.font = "bold 30px 'Arial Black', 'Arial', sans-serif";
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('CLICK / ENTER TO START', 640, 640);
    }
    ctx.font = "bold 15px 'Arial', sans-serif";
    ctx.fillStyle = '#8fa3bb';
    ctx.fillText('BEST SCORE : ' + String(game.best).padStart(8, '0'), 640, 686);
    ctx.textAlign = 'left';
  };

  UI.drawIntro = function (ctx, game) {
    ctx.fillStyle = 'rgba(4,6,12,0.55)';
    ctx.fillRect(0, 0, UI.LW, UI.LH);
    ctx.textAlign = 'center';
    if (game.stage % 5 === 0 && game.bossWarn > 0) {
      const k = 0.5 + 0.5 * Math.sin(game.t * 8);
      ctx.save();
      ctx.shadowColor = 'rgba(255,60,40,0.9)';
      ctx.shadowBlur = 30 * k;
      ctx.font = "900 76px 'Arial Black', 'Arial', sans-serif";
      ctx.fillStyle = U.rgba([255, 70, 45], 0.55 + 0.45 * k);
      ctx.fillText('WARNING', 640, 360);
      ctx.restore();
      ctx.font = "bold 26px 'Arial', sans-serif";
      ctx.fillStyle = '#ffd9c8';
      const st = Stages.bossStats(game.stage);
      ctx.fillText('BOSS : ' + st.nameEn + ' - ' + st.name, 640, 412);
    } else {
      ctx.font = "900 72px 'Arial Black', 'Arial', sans-serif";
      ctx.fillStyle = '#eef4ff';
      ctx.fillText('STAGE ' + game.stage, 640, 370);
      ctx.font = "bold 22px 'Arial', sans-serif";
      ctx.fillStyle = '#9fb2c8';
      ctx.fillText('敵戦力 : ' + game.cfg.total, 640, 420);
    }
    ctx.textAlign = 'left';
  };

  UI.drawUpgrade = function (ctx, game) {
    ctx.fillStyle = 'rgba(3,5,10,0.78)';
    ctx.fillRect(0, 0, UI.LW, UI.LH);
    ctx.textAlign = 'center';
    ctx.save();
    ctx.shadowColor = 'rgba(120,190,255,0.7)';
    ctx.shadowBlur = 18;
    ctx.font = "900 46px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = '#f2f7ff';
    ctx.fillText('UPGRADE SELECT', 640, 96);
    ctx.restore();
    ctx.font = "bold 18px 'Arial', sans-serif";
    ctx.fillStyle = '#9fb2c8';
    ctx.fillText('3つの中から1つ選択 (1 / 2 / 3 キー または クリック)', 640, 132);

    const pop = U.clamp((game.cardT - 0.1) * 4, 0, 1);
    for (let i = 0; i < game.cards.length; i++) {
      const def = game.cards[i];
      const rc = UI.cardRect(i);
      const rar = Upgrades.RARITY[def.rar];
      const hov = game.hoverCard === i;
      const lift = hov ? -10 : 0;
      const y = rc.y + (1 - pop) * 30 + lift;
      ctx.save();
      ctx.globalAlpha = pop;
      ctx.fillStyle = hov ? 'rgba(24,32,52,0.98)' : 'rgba(14,19,32,0.97)';
      ctx.strokeStyle = U.rgb(rar.color);
      ctx.lineWidth = hov ? 3.5 : 2;
      ctx.shadowColor = U.rgba(rar.color, hov ? 0.95 : 0.55);
      ctx.shadowBlur = hov ? 26 : 12;
      ctx.beginPath();
      const r = 14;
      ctx.moveTo(rc.x + r, y);
      ctx.arcTo(rc.x + rc.w, y, rc.x + rc.w, y + rc.h, r);
      ctx.arcTo(rc.x + rc.w, y + rc.h, rc.x, y + rc.h, r);
      ctx.arcTo(rc.x, y + rc.h, rc.x, y, r);
      ctx.arcTo(rc.x, y, rc.x + rc.w, y, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      const ig = ctx.createRadialGradient(rc.cx, y + 86, 6, rc.cx, y + 86, 62);
      ig.addColorStop(0, U.rgba(rar.color, 0.5));
      ig.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ig;
      ctx.beginPath();
      ctx.arc(rc.cx, y + 86, 62, 0, U.TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(8,11,20,0.9)';
      ctx.beginPath();
      ctx.arc(rc.cx, y + 86, 48, 0, U.TAU);
      ctx.fill();
      ctx.strokeStyle = U.rgba(rar.color, 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();
      UI.drawIcon(ctx, def.id, rc.cx, y + 86, 34, U.rgb(U.lighten(rar.color, 0.25)));

      ctx.textAlign = 'center';
      ctx.font = "bold 14px 'Arial', sans-serif";
      ctx.fillStyle = U.rgb(rar.color);
      ctx.fillText(rar.name, rc.cx, y + 162);
      ctx.font = "bold 21px 'Arial', sans-serif";
      ctx.fillStyle = '#eef4ff';
      ctx.fillText(def.name, rc.cx, y + 192);
      ctx.font = "bold 12px 'Arial', sans-serif";
      ctx.fillStyle = '#7d92ad';
      ctx.fillText(def.en, rc.cx, y + 210);
      ctx.font = "14px 'Arial', sans-serif";
      ctx.fillStyle = '#b9c9de';
      const words = def.desc;
      ctx.fillText(words, rc.cx, y + 238);

      const lvl = game.player.mods[def.id] || 0;
      const max = def.max >= 99 ? null : def.max;
      if (max !== null) {
        const pips = max;
        const pw = 16;
        const sx = rc.cx - (pips * (pw + 5) - 5) / 2;
        for (let k = 0; k < pips; k++) {
          ctx.fillStyle = k < lvl ? U.rgb(rar.color) : 'rgba(255,255,255,0.14)';
          ctx.fillRect(sx + k * (pw + 5), y + 258, pw, 8);
        }
        ctx.font = "12px 'Arial', sans-serif";
        ctx.fillStyle = '#8fa3bb';
        ctx.fillText('LV ' + lvl + ' / ' + max, rc.cx, y + 284);
      } else {
        ctx.font = "12px 'Arial', sans-serif";
        ctx.fillStyle = '#8fa3bb';
        ctx.fillText('繰り返し取得可能', rc.cx, y + 272);
      }

      ctx.fillStyle = hov ? '#ffe9a8' : 'rgba(255,255,255,0.35)';
      ctx.font = "bold 20px 'Arial Black', 'Arial', sans-serif";
      ctx.fillText('[' + (i + 1) + ']', rc.cx, y + 322);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  };

  UI.drawGameOver = function (ctx, game) {
    ctx.fillStyle = 'rgba(4,5,10,0.82)';
    ctx.fillRect(0, 0, UI.LW, UI.LH);
    ctx.textAlign = 'center';
    ctx.save();
    ctx.shadowColor = 'rgba(255,60,40,0.8)';
    ctx.shadowBlur = 30;
    ctx.font = "900 80px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = '#ff5d4a';
    ctx.fillText('GAME OVER', 640, 330);
    ctx.restore();
    ctx.font = "bold 24px 'Arial', sans-serif";
    ctx.fillStyle = '#eef4ff';
    ctx.fillText('SCORE  ' + String(game.score).padStart(8, '0'), 640, 400);
    ctx.font = "bold 18px 'Arial', sans-serif";
    ctx.fillStyle = game.score >= game.best && game.score > 0 ? '#ffe9a8' : '#9fb2c8';
    ctx.fillText('BEST    ' + String(game.best).padStart(8, '0') + (game.score >= game.best && game.score > 0 ? '  NEW RECORD!' : ''), 640, 434);
    ctx.fillText('到達ステージ : ' + game.stage, 640, 468);
    if (Math.floor(game.t * 2) % 2 === 0) {
      ctx.font = "bold 26px 'Arial Black', 'Arial', sans-serif";
      ctx.fillStyle = '#c4d4e8';
      ctx.fillText('ENTER : タイトルへ / R : もう一度', 640, 540);
    }
    ctx.textAlign = 'left';
  };

  UI.drawPause = function (ctx) {
    ctx.fillStyle = 'rgba(4,5,10,0.6)';
    ctx.fillRect(0, 0, UI.LW, UI.LH);
    ctx.textAlign = 'center';
    ctx.font = "900 64px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = '#eef4ff';
    ctx.fillText('PAUSE', 640, 400);
    ctx.font = "bold 18px 'Arial', sans-serif";
    ctx.fillStyle = '#9fb2c8';
    ctx.fillText('P : 再開', 640, 444);
    ctx.textAlign = 'left';
  };

  UI.drawBanner = function (ctx, game) {
    const b = game.banner;
    if (!b) return;
    const k = b.t / b.life;
    const a = k < 0.15 ? k / 0.15 : (k > 0.75 ? (1 - k) / 0.25 : 1);
    ctx.textAlign = 'center';
    ctx.save();
    ctx.globalAlpha = U.clamp(a, 0, 1);
    ctx.shadowColor = 'rgba(120,220,255,0.8)';
    ctx.shadowBlur = 24;
    ctx.font = "900 64px 'Arial Black', 'Arial', sans-serif";
    ctx.fillStyle = b.col || '#eef4ff';
    ctx.fillText(b.txt, 640, 380);
    if (b.sub) {
      ctx.font = "bold 22px 'Arial', sans-serif";
      ctx.fillStyle = '#9fb2c8';
      ctx.fillText(b.sub, 640, 420);
    }
    ctx.restore();
    ctx.textAlign = 'left';
  };

  window.UI = UI;
})();
