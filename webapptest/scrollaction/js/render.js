/* =========================================================================
 * render.js
 * -------------------------------------------------------------------------
 * Canvas 描画。480x288 の論理解像度でピクセルアート風に描画する。
 * 背景の多重スクロール、タイル、キャラクター、HUD、各種オーバーレイ。
 * ========================================================================= */
(function (global) {
  'use strict';

  const E = global.Engine;
  const TILE = E.TILE;
  const VIEW_W = E.VIEW_W;
  const VIEW_H = E.VIEW_H;
  const HUD_H = E.HUD_H;
  const T = E.T;

  const Renderer = {
    ctx: null,
    frame: 0,

    init(canvas) {
      canvas.width = VIEW_W;
      canvas.height = VIEW_H;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
    },

    /* ============ 背景 ============ */
    drawBackground(game) {
      const ctx = this.ctx;
      const cam = game.cameraX;
      const theme = game.level ? game.level.theme : 'grass';

      if (theme === 'cave') {
        // 洞窟: 暗い茶色のグラデーション
        const g = ctx.createLinearGradient(0, HUD_H, 0, VIEW_H);
        g.addColorStop(0, '#1a0f08');
        g.addColorStop(1, '#0d0704');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        // 鍾乳石のような装飾
        this.drawCaveDecor(cam);
      } else if (theme === 'night') {
        const g = ctx.createLinearGradient(0, HUD_H, 0, VIEW_H);
        g.addColorStop(0, '#0b1030');
        g.addColorStop(1, '#1a2350');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        // 星(多重スクロール)
        this.drawStars(cam);
        this.drawMoon(cam);
        // 遠景の山(夜)
        this.drawHills(cam, '#101a3a', '#16224a', 0.2);
      } else {
        // 草原: 空
        const g = ctx.createLinearGradient(0, HUD_H, 0, VIEW_H);
        g.addColorStop(0, '#5cb8ff');
        g.addColorStop(1, '#9fe0ff');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        this.drawClouds(cam);
        this.drawHills(cam, '#4aa84a', '#63c263', 0.3);
        this.drawHills(cam, '#3e9a3e', '#55b855', 0.55);
      }
    },

    drawClouds(cam) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const speed = 0.15;
      for (let i = 0; i < 7; i++) {
        const seed = i * 137.5;
        const w = 60 + (i % 3) * 25;
        let x = ((seed + cam * speed) % (VIEW_W + 200)) - 100;
        const y = HUD_H + 20 + (i % 4) * 30;
        this.cloud(x, y, w);
      }
    },

    cloud(x, y, w) {
      const ctx = this.ctx;
      const h = w * 0.42;
      ctx.beginPath();
      ctx.arc(x, y + h * 0.4, h * 0.6, 0, Math.PI * 2);
      ctx.arc(x + w * 0.3, y + h * 0.2, h * 0.5, 0, Math.PI * 2);
      ctx.arc(x + w * 0.55, y + h * 0.35, h * 0.6, 0, Math.PI * 2);
      ctx.arc(x + w, y + h * 0.45, h * 0.5, 0, Math.PI * 2);
      ctx.fill();
    },

    drawHills(cam, c1, c2, speed) {
      const ctx = this.ctx;
      const baseY = LEVEL_TOPS;
      ctx.fillStyle = c1;
      for (let i = 0; i < 8; i++) {
        const seed = i * 211.3;
        const w = 120 + (i % 3) * 50;
        const x = ((seed + cam * speed) % (VIEW_W + 260)) - 130;
        const h = 40 + (i % 4) * 22;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, baseY);
        ctx.quadraticCurveTo(x, baseY - h, x + w / 2, baseY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = c2;
      for (let i = 0; i < 6; i++) {
        const seed = i * 173.7;
        const w = 60 + (i % 3) * 30;
        const x = ((seed + cam * speed * 1.4) % (VIEW_W + 200)) - 100;
        const h = 18 + (i % 3) * 8;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, baseY);
        ctx.quadraticCurveTo(x, baseY - h, x + w / 2, baseY);
        ctx.closePath();
        ctx.fill();
      }
    },

    drawStars(cam) {
      const ctx = this.ctx;
      const speed = 0.06;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) {
        const seed = i * 97.3;
        const x = ((seed + cam * speed) % (VIEW_W + 40)) - 20;
        const y = HUD_H + ((i * 37) % (LEVEL_TOPS - HUD_H - 10));
        const tw = 0.5 + 0.5 * Math.sin(this.frame * 0.08 + i);
        ctx.globalAlpha = tw;
        ctx.fillRect(x, y, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    },

    drawMoon(cam) {
      const ctx = this.ctx;
      const x = 380 - (cam * 0.04) % 100;
      const y = HUD_H + 34;
      ctx.fillStyle = '#f8f6d8';
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b1030';
      ctx.beginPath();
      ctx.arc(x + 8, y - 5, 18, 0, Math.PI * 2);
      ctx.fill();
    },

    drawCaveDecor(cam) {
      const ctx = this.ctx;
      // 下からの揺らめき(溶岩風)
      ctx.fillStyle = 'rgba(255,140,40,0.18)';
      for (let i = 0; i < 5; i++) {
        const seed = i * 151.2;
        const x = ((seed + cam * 0.3) % (VIEW_W + 120)) - 60;
        const h = 20 + 10 * Math.sin(this.frame * 0.05 + i * 2);
        ctx.fillRect(x, LEVEL_TOPS - h, 30 + i * 8, h);
      }
    },

    /* ============ タイル ============ */
    drawTiles(game) {
      const ctx = this.ctx;
      const level = game.level;
      const cam = game.cameraX;
      const tx0 = Math.floor(cam / TILE);
      const tx1 = Math.min(level.width - 1, Math.ceil((cam + VIEW_W) / TILE));
      const theme = level.theme;

      for (let ty = 0; ty < level.height; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const t = level.grid[ty][tx];
          if (t === T.EMPTY) continue;
          const x = tx * TILE - cam;
          const y = ty * TILE + LEVEL_OFFSET;
          // バンプアニメーション
          const bump = game.bumps.get(tx + ',' + ty);
          const offY = bump ? this.bumpOffset(bump) : 0;

          switch (t) {
            case T.GROUND:
              this.drawGround(x, y + offY, theme);
              break;
            case T.BLOCK:
              this.drawBlock(x, y + offY);
              break;
            case T.BRICK:
              this.drawBrick(x, y + offY, theme);
              break;
            case T.POWER:
              this.drawQuestion(x, y + offY, '?', '#ff8c1a');
              break;
            case T.COINBLOCK:
              this.drawQuestion(x, y + offY, '•', '#ffd23e');
              break;
            case T.USED:
              this.drawUsed(x, y + offY);
              break;
            case T.PIPE_TL:
            case T.PIPE_TR:
            case T.PIPE_L:
            case T.PIPE_R:
              this.drawPipeTile(x, y + offY, t);
              break;
            case T.COIN:
              this.drawCoin(x + 3, y + 3 + offY, 10);
              break;
            case T.PLAT:
              this.drawPlatform(x, y + offY, theme);
              break;
          }
        }
      }
    },

    bumpOffset(timer) {
      // 12フレームで上へ3px → 戻る
      const t = 12 - timer;
      if (t < 5) return -t * 0.7;
      return -(5 * 0.7) + (t - 5) * 0.7;
    },

    drawGround(x, y, theme) {
      const ctx = this.ctx;
      if (theme === 'cave') {
        ctx.fillStyle = '#6b4a30';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#7d5839';
        ctx.fillRect(x + 2, y + 2, 12, 4);
        ctx.fillStyle = '#5a3c26';
        ctx.fillRect(x + 4, y + 9, 8, 4);
      } else if (theme === 'night') {
        ctx.fillStyle = '#3a3f66';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#464c78';
        ctx.fillRect(x + 1, y + 1, 14, 4);
        ctx.fillStyle = '#2e3352';
        ctx.fillRect(x + 3, y + 9, 9, 4);
      } else {
        // 草原: 土 + 草
        ctx.fillStyle = '#c67b3a';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#a8612b';
        ctx.fillRect(x, y + 10, TILE, 3);
        ctx.fillStyle = '#4caf4c';
        ctx.fillRect(x, y, TILE, 4);
        ctx.fillStyle = '#5fd05f';
        ctx.fillRect(x, y, TILE, 2);
      }
    },

    drawBlock(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = '#e08a3c';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#f0a24e';
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = '#c06e2c';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#f0a24e';
      ctx.fillRect(x + 3, y + 3, TILE - 6, 2);
    },

    drawBrick(x, y, theme) {
      const ctx = this.ctx;
      const base = theme === 'cave' ? '#a04a2a' : theme === 'night' ? '#5a4a8a' : '#c05838';
      const light = theme === 'cave' ? '#c06a42' : theme === 'night' ? '#7866aa' : '#e07050';
      const dark = theme === 'cave' ? '#7a3418' : theme === 'night' ? '#3c3060' : '#94301c';
      ctx.fillStyle = base;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = light;
      ctx.fillRect(x + 1, y + 1, 6, 6);
      ctx.fillRect(x + 9, y + 1, 6, 6);
      ctx.fillRect(x + 1, y + 9, 6, 6);
      ctx.fillRect(x + 9, y + 9, 6, 6);
      ctx.fillStyle = dark;
      ctx.fillRect(x, y + 7, TILE, 2);
      ctx.fillRect(x + 7, y, 2, TILE);
    },

    drawQuestion(x, y, mark, color) {
      const ctx = this.ctx;
      ctx.fillStyle = '#d8922c';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#f0b84e';
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = '#b8741c';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      // 光るマーク
      const pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.12);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7 + 0.3 * pulse;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark, x + TILE / 2, y + TILE / 2 + 1);
      ctx.globalAlpha = 1;
    },

    drawUsed(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = '#9a6a3a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#8a5a2c';
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = '#6a3e18';
      ctx.fillRect(x + 2, y + 2, TILE - 4, 2);
      ctx.fillStyle = '#6a3e18';
      ctx.fillRect(x + 2, y + 2, 2, TILE - 4);
    },

    drawPipeTile(x, y, t) {
      const ctx = this.ctx;
      const isTop = t === T.PIPE_TL || t === T.PIPE_TR;
      const isLeft = t === T.PIPE_TL || t === T.PIPE_L;
      if (isTop) {
        ctx.fillStyle = '#3fae4a';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#5fd86a';
        ctx.fillRect(x, y, TILE, 4);
        ctx.fillStyle = '#2d8a36';
        ctx.fillRect(x + (isLeft ? 0 : TILE - 3), y, 3, TILE);
        ctx.fillStyle = '#7ae882';
        ctx.fillRect(x + (isLeft ? 0 : TILE - 3), y, 1, TILE);
      } else {
        ctx.fillStyle = '#2d8a36';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#3fae4a';
        ctx.fillRect(x + (isLeft ? 1 : 2), y, TILE - 1, TILE);
        ctx.fillStyle = '#1f6b26';
        ctx.fillRect(x + (isLeft ? 0 : TILE - 3), y, 3, TILE);
        ctx.fillStyle = '#5fd86a';
        ctx.fillRect(x + (isLeft ? 1 : 2), y, 1, TILE);
      }
    },

    drawPlatform(x, y, theme) {
      const ctx = this.ctx;
      const c = theme === 'cave' ? '#8a6a4a' : theme === 'night' ? '#6a6aa0' : '#b87848';
      ctx.fillStyle = c;
      ctx.fillRect(x, y + 8, TILE, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y + 8, TILE, 2);
    },

    /* ============ コイン ============ */
    drawCoin(x, y, size) {
      const ctx = this.ctx;
      const squash = Math.abs(Math.sin(this.frame * 0.15));
      const w = size * (0.3 + 0.7 * squash);
      const h = size;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + size / 2, Math.max(w / 2, 1.5), h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffec8a';
      ctx.fillRect(x + size / 2 - 1, y + 2, 2, size - 4);
    },

    /* ============ ゴール旗・城 ============ */
    drawGoal(game) {
      if (!game.level) return;
      const ctx = this.ctx;
      const flagWorldX = game.level.flagX * TILE;
      const flagX = flagWorldX - game.cameraX;
      const groundY = LEVEL_OFFSET + E.SURFACE_ROW_TOP; // 240
      const poleTop = LEVEL_OFFSET + 22;

      // ポール
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(flagX + 7, poleTop, 2, groundY - poleTop);
      // 玉
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(flagX + 5, poleTop - 4, 6, 6);
      // 旗(はためき)
      const wave = Math.sin(this.frame * 0.1) * 2;
      ctx.fillStyle = '#e03a3a';
      ctx.beginPath();
      ctx.moveTo(flagX + 9, poleTop + 3);
      ctx.lineTo(flagX + 34 + wave, poleTop + 13);
      ctx.lineTo(flagX + 9, poleTop + 23);
      ctx.closePath();
      ctx.fill();
      // 台座
      ctx.fillStyle = '#888';
      ctx.fillRect(flagX + 3, groundY - 2, 10, 3);

      // 城(ゴールの向こう側)
      const castleX = flagWorldX + 10 * TILE - game.cameraX;
      if (castleX < VIEW_W + 40) {
        const baseY = groundY;
        // 本体
        ctx.fillStyle = '#c8b8a0';
        ctx.fillRect(castleX, baseY - 34, 56, 34);
        // 胸壁
        ctx.fillStyle = '#a89880';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(castleX + i * 20, baseY - 42, 12, 10);
        }
        // 門
        ctx.fillStyle = '#3a2417';
        ctx.fillRect(castleX + 20, baseY - 16, 16, 16);
        ctx.fillStyle = '#5a3a20';
        ctx.fillRect(castleX + 20, baseY - 16, 16, 3);
        // 旗
        ctx.fillStyle = '#e03a3a';
        ctx.fillRect(castleX + 26, baseY - 52, 3, 12);
        ctx.fillRect(castleX + 26, baseY - 52, 12, 4);
      }
    },

    /* ============ 敵 ============ */
    drawEnemies(game) {
      const cam = game.cameraX;
      for (const e of game.enemies) {
        const x = e.x - cam;
        const y = e.y + LEVEL_OFFSET;
        if (x < -40 || x > VIEW_W + 40) continue;
        if (e.state === 'dead' && e.deadTimer > 12) continue;

        if (e.state === 'dead') {
          this.drawWalkerSquash(x, y);
          continue;
        }
        if (e.type === 'walker') {
          this.drawWalker(x, y, e);
        } else {
          this.drawSheller(x, y, e);
        }
      }
    },

    drawWalker(x, y, e) {
      const ctx = this.ctx;
      const walk = Math.floor(e.anim) % 2;
      // きのこ型の敵(茶色)
      ctx.fillStyle = '#8a4a24';
      ctx.fillRect(x + 2, y + 2, 10, 5);
      ctx.fillRect(x + 1, y + 4, 12, 6);
      // 目
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 3, y + 4, 3, 3);
      ctx.fillRect(x + 8, y + 4, 3, 3);
      ctx.fillStyle = '#222';
      ctx.fillRect(x + 4, y + 5, 2, 2);
      ctx.fillRect(x + 9, y + 5, 2, 2);
      // 足
      ctx.fillStyle = '#5a2c14';
      if (walk === 0) {
        ctx.fillRect(x + 2, y + 11, 4, 3);
        ctx.fillRect(x + 8, y + 11, 4, 3);
      } else {
        ctx.fillRect(x + 2, y + 12, 4, 2);
        ctx.fillRect(x + 8, y + 12, 4, 2);
      }
    },

    drawWalkerSquash(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = '#8a4a24';
      ctx.fillRect(x + 1, y + 10, 12, 4);
      ctx.fillStyle = '#5a2c14';
      ctx.fillRect(x + 2, y + 13, 4, 2);
      ctx.fillRect(x + 8, y + 13, 4, 2);
    },

    drawSheller(x, y, e) {
      const ctx = this.ctx;
      if (e.state === 'shell' || e.state === 'sliding') {
        // 甲羅状態
        const spin = e.state === 'sliding' ? Math.floor(e.anim * 2) % 2 : 0;
        ctx.fillStyle = '#3fae4a';
        ctx.fillRect(x + 1, y + 1, 12, 5);
        ctx.fillRect(x + 2, y + 3, 10, 8);
        ctx.fillStyle = '#5fd86a';
        if (spin === 0) {
          ctx.fillRect(x + 4, y + 5, 2, 3);
          ctx.fillRect(x + 9, y + 5, 2, 3);
        } else {
          ctx.fillRect(x + 7, y + 4, 2, 3);
          ctx.fillRect(x + 4, y + 9, 2, 3);
        }
        ctx.fillStyle = '#1f6b26';
        ctx.fillRect(x + 1, y + 1, 12, 2);
      } else {
        // 歩行状態(カメ)
        const walk = Math.floor(e.anim) % 2;
        // 甲羅
        ctx.fillStyle = '#3fae4a';
        ctx.fillRect(x + 3, y + 4, 8, 14);
        ctx.fillStyle = '#5fd86a';
        ctx.fillRect(x + 3, y + 6, 8, 2);
        ctx.fillRect(x + 3, y + 12, 8, 2);
        // 頭
        ctx.fillStyle = '#7ae882';
        ctx.fillRect(x + (e.dir > 0 ? 10 : 0), y + 4, 4, 5);
        // 目
        ctx.fillStyle = '#222';
        ctx.fillRect(x + (e.dir > 0 ? 11 : 1), y + 5, 2, 2);
        // 足
        ctx.fillStyle = '#2d8a36';
        if (walk === 0) {
          ctx.fillRect(x + 2, y + 19, 3, 3);
          ctx.fillRect(x + 9, y + 19, 3, 3);
        } else {
          ctx.fillRect(x + 3, y + 20, 3, 2);
          ctx.fillRect(x + 8, y + 20, 3, 2);
        }
      }
    },

    /* ============ アイテム ============ */
    drawItems(game) {
      const ctx = this.ctx;
      const cam = game.cameraX;
      for (const it of game.items) {
        const x = it.x - cam;
        const y = it.y + LEVEL_OFFSET;
        if (it.type === 'mushroom') {
          // きのこ
          ctx.fillStyle = '#e03a3a';
          ctx.fillRect(x, y, 14, 7);
          ctx.fillStyle = '#fff';
          ctx.fillRect(x + 3, y + 1, 3, 3);
          ctx.fillRect(x + 8, y + 1, 3, 3);
          ctx.fillStyle = '#f8d8a0';
          ctx.fillRect(x + 2, y + 7, 10, 6);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 4, y + 8, 2, 2);
          ctx.fillRect(x + 8, y + 8, 2, 2);
          ctx.fillStyle = '#5a2c14';
          ctx.fillRect(x + 3, y + 12, 3, 2);
          ctx.fillRect(x + 8, y + 12, 3, 2);
        } else {
          // コインポップ
          this.drawCoin(x, y, 10);
        }
      }
    },

    /* ============ プレイヤー ============ */
    drawPlayer(game) {
      const p = game.player;
      if (p.dead) {
        if (p.deathFromPit) return; // 穴では描かない
        this.drawPlayerSprite(game, p.x - game.cameraX, p.y + LEVEL_OFFSET, true);
        return;
      }
      // 無敵点滅
      if (p.invincible > 0 && Math.floor(this.frame / 4) % 2 === 0) return;
      this.drawPlayerSprite(game, p.x - game.cameraX, p.y + LEVEL_OFFSET, false);
    },

    drawPlayerSprite(game, x, y, dead) {
      const ctx = this.ctx;
      const p = game.player;
      const big = p.big;
      const facing = p.facing;
      const pose = p.pose;
      const runFrame = Math.floor(p.anim) % 4;

      // 体色
      const cap = '#e03a3a';
      const skin = '#f8c890';
      const overall = '#3a6ae0';
      const shoe = '#5a2c14';

      // 向きに応じた鏡像描画を簡略化: スプライトを左右反転
      ctx.save();
      if (facing < 0) {
        ctx.translate(x + p.w, y);
        ctx.scale(-1, 1);
        ctx.translate(-x, -y);
      }

      if (big) {
        // 大きい状態 12x32
        if (pose === 'jump' || pose === 'fall') {
          // ジャンプ姿勢
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 14, 8, 10); // 胴
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          // 腕(上)
          ctx.fillStyle = skin;
          ctx.fillRect(x + 10, y + 6, 2, 4);
          // 脚(開き)
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 24, 4, 4);
          ctx.fillRect(x + 7, y + 24, 4, 4);
          ctx.fillStyle = shoe;
          ctx.fillRect(x + 1, y + 28, 5, 3);
          ctx.fillRect(x + 7, y + 28, 5, 3);
        } else if (pose === 'run') {
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 14, 8, 10);
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 10, y + 6, 2, 4);
          // 走る脚
          const legPhase = runFrame % 2;
          ctx.fillStyle = overall;
          if (legPhase === 0) {
            ctx.fillRect(x + 2, y + 24, 4, 6);
            ctx.fillRect(x + 7, y + 24, 4, 3);
          } else {
            ctx.fillRect(x + 2, y + 24, 4, 3);
            ctx.fillRect(x + 7, y + 24, 4, 6);
          }
          ctx.fillStyle = shoe;
          ctx.fillRect(x + 1, y + 29, 5, 3);
          ctx.fillRect(x + 7, y + 28, 5, 3);
        } else {
          // idle
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 10, 8, 12);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 10, y + 10, 2, 5);
          ctx.fillRect(x + 0, y + 10, 2, 5);
          // 脚
          ctx.fillStyle = overall;
          ctx.fillRect(x + 3, y + 22, 3, 7);
          ctx.fillRect(x + 7, y + 22, 3, 7);
          ctx.fillStyle = shoe;
          ctx.fillRect(x + 1, y + 29, 5, 3);
          ctx.fillRect(x + 7, y + 29, 5, 3);
        }
      } else {
        // 小さい状態 12x16
        if (dead) {
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 9, 8, 4);
          ctx.fillStyle = shoe;
          ctx.fillRect(x + 1, y + 13, 5, 3);
          ctx.fillRect(x + 7, y + 13, 5, 3);
        } else if (pose === 'jump' || pose === 'fall') {
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 9, 8, 3);
          ctx.fillStyle = shoe;
          ctx.fillRect(x + 1, y + 13, 5, 3);
          ctx.fillRect(x + 7, y + 12, 5, 3);
        } else if (pose === 'run') {
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 9, 8, 3);
          const legPhase = runFrame % 2;
          ctx.fillStyle = shoe;
          if (legPhase === 0) {
            ctx.fillRect(x + 1, y + 13, 5, 3);
            ctx.fillRect(x + 7, y + 14, 5, 2);
          } else {
            ctx.fillRect(x + 1, y + 14, 5, 2);
            ctx.fillRect(x + 7, y + 13, 5, 3);
          }
        } else {
          // idle
          ctx.fillStyle = cap;
          ctx.fillRect(x + 1, y + 1, 10, 5);
          ctx.fillStyle = skin;
          ctx.fillRect(x + 2, y + 5, 8, 5);
          ctx.fillStyle = '#222';
          ctx.fillRect(x + 6, y + 6, 3, 3);
          ctx.fillStyle = overall;
          ctx.fillRect(x + 2, y + 9, 8, 3);
          ctx.fillStyle = shoe;
          ctx.fillRect(x + 1, y + 13, 5, 3);
          ctx.fillRect(x + 7, y + 13, 5, 3);
        }
      }
      ctx.restore();
    },

    /* ============ パーティクル ============ */
    drawParticles(game) {
      const ctx = this.ctx;
      for (const pt of game.particles) {
        const x = pt.x - game.cameraX;
        const y = pt.y + LEVEL_OFFSET;
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        ctx.fillRect(x, y, pt.size, pt.size);
      }
      ctx.globalAlpha = 1;
    },

    /* ============ HUD ============ */
    drawHUD(game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W, HUD_H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      ctx.fillText('SCORE', 8, 9);
      ctx.font = 'bold 11px monospace';
      ctx.fillText(this.pad(String(game.score), 6), 8, 24);

      // コイン
      ctx.font = 'bold 9px monospace';
      ctx.fillText('COINS', 90, 9);
      this.drawCoin(90, 16, 10);
      ctx.font = 'bold 11px monospace';
      ctx.fillText('x' + String(game.coins), 104, 24);

      // ステージ
      ctx.fillText('WORLD', 160, 9);
      ctx.fillText(game.level ? game.level.name : '1-1', 160, 24);

      // 時間
      ctx.font = 'bold 9px monospace';
      ctx.fillText('TIME', 250, 9);
      ctx.font = 'bold 11px monospace';
      ctx.fillText(this.pad(Math.ceil(game.timeLeft), 3), 250, 24);

      // 残機
      ctx.font = 'bold 9px monospace';
      ctx.fillText('LIVES', 330, 9);
      ctx.font = 'bold 11px monospace';
      ctx.fillText(String(game.lives), 330, 24);

      // メッセージ(1UP等)
      if (game.msgTimer > 0) {
        ctx.fillStyle = '#ffd23e';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(game.msg, VIEW_W / 2, 26);
      }
    },

    pad(n, len) {
      let s = String(n);
      while (s.length < len) s = '0' + s;
      return s;
    },

    /* ============ オーバーレイ ============ */
    drawOverlay(game) {
      const ctx = this.ctx;
      switch (game.state) {
        case 'TITLE':
          this.drawTitle(game);
          break;
        case 'PAUSED':
          this.drawPaused();
          break;
        case 'PLAYER_DEAD':
          // 何も重ねない(演出中)
          break;
        case 'STAGE_CLEAR':
          this.drawStageClear(game);
          break;
        case 'GAME_OVER':
          this.drawGameOver(game);
          break;
        case 'GAME_CLEAR':
          this.drawGameClear(game);
          break;
      }
    },

    drawTitle(game) {
      const ctx = this.ctx;
      // 暗幕
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      // ロゴ
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd23e';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('SUPER SCROLL', VIEW_W / 2, 70);
      ctx.fillStyle = '#ff6a3a';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('ADVENTURE', VIEW_W / 2, 100);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('WORLD 1-1  GREEN HILLS', VIEW_W / 2, 140);
      ctx.fillStyle = '#aaa';
      ctx.font = '10px monospace';
      ctx.fillText('WORLD 2-1  CAVERN', VIEW_W / 2, 158);
      ctx.fillText('WORLD 3-1  MIDNIGHT SKY', VIEW_W / 2, 172);

      // 点滅する開始表示
      if (Math.floor(this.frame / 30) % 2 === 0) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px monospace';
        ctx.fillText('PRESS ENTER / TAP TO START', VIEW_W / 2, 210);
      }

      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.fillText('MOVE: ←→  JUMP: Z/SPACE  RUN: X/SHIFT', VIEW_W / 2, 244);
      ctx.fillText('PAUSE: P/ESC   GAMEPAD / TOUCH SUPPORT', VIEW_W / 2, 258);
    },

    drawPaused() {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PAUSED', VIEW_W / 2, VIEW_H / 2 - 12);
      ctx.font = '11px monospace';
      ctx.fillText('PRESS P / ENTER TO RESUME', VIEW_W / 2, VIEW_H / 2 + 16);
    },

    drawStageClear(game) {
      const ctx = this.ctx;
      if (game.stateTimer > 70) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffd23e';
        ctx.font = 'bold 24px monospace';
        ctx.fillText('STAGE CLEAR!', VIEW_W / 2, 90);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('TIME BONUS', VIEW_W / 2, 130);
        ctx.fillStyle = '#8aff8a';
        ctx.fillText(String(Math.floor(game.timeLeft) * 10), VIEW_W / 2, 152);
        ctx.fillStyle = '#fff';
        ctx.font = '11px monospace';
        ctx.fillText('SCORE ' + String(game.score), VIEW_W / 2, 184);
      }
    },

    drawGameOver(game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff4a3a';
      ctx.font = 'bold 30px monospace';
      ctx.fillText('GAME OVER', VIEW_W / 2, VIEW_H / 2 - 20);
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.fillText('SCORE ' + String(game.score), VIEW_W / 2, VIEW_H / 2 + 20);
      if (game.stateTimer > 60 && Math.floor(this.frame / 30) % 2 === 0) {
        ctx.fillText('PRESS ENTER TO TITLE', VIEW_W / 2, VIEW_H / 2 + 52);
      }
    },

    drawGameClear(game) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd23e';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('GAME CLEAR!', VIEW_W / 2, 90);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('YOU SAVED THE KINGDOM!', VIEW_W / 2, 130);
      ctx.fillStyle = '#8aff8a';
      ctx.font = 'bold 15px monospace';
      ctx.fillText('FINAL SCORE  ' + String(game.score), VIEW_W / 2, 165);
      if (game.stateTimer > 60 && Math.floor(this.frame / 30) % 2 === 0) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.fillText('PRESS ENTER TO TITLE', VIEW_W / 2, 220);
      }
    },

    /* ============ メイン描画 ============ */
    render(game) {
      this.frame++;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      this.drawBackground(game);
      this.drawTiles(game);
      this.drawGoal(game);
      this.drawItems(game);
      this.drawEnemies(game);
      if (game.state !== 'GAME_OVER' && game.state !== 'GAME_CLEAR') {
        this.drawPlayer(game);
      }
      this.drawParticles(game);
      this.drawHUD(game);
      this.drawOverlay(game);
      ctx.restore();
    }
  };

  /* レベル描画オフセット(HUD分) */
  const LEVEL_OFFSET = HUD_H;
  const LEVEL_TOPS = HUD_H;

  global.Renderer = Renderer;
})(window);
