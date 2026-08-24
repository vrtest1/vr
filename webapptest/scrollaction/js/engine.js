/* =========================================================================
 * engine.js
 * -------------------------------------------------------------------------
 * ゲームエンジン本体。
 * - 固定タイムステップ(60fps)で物理・当たり判定を安定化
 * - 状態機械: TITLE / PLAYING / PAUSED / PLAYER_DEAD / STAGE_CLEAR /
 *             GAME_OVER / GAME_CLEAR
 * - プレイヤー・敵・アイテム・パーティクル
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------- 定数 ---------- */
  const TILE = 16;
  const VIEW_W = 480;
  const VIEW_H = 288;
  const HUD_H = 32;
  const LEVEL_H = 256;        // 16 タイル
  const STEP = 1 / 60;

  // プレイヤー物理 (60fpsステップあたり)
  const ACCEL = 0.16;
  const FRICTION = 0.78;
  const MAX_WALK = 1.5;
  const MAX_RUN = 2.7;
  const GRAVITY = 0.30;
  const GRAV_JUMP = 0.16;
  const MAX_FALL = 6.0;
  const JUMP_V = -5.0;
  const STOMP_BOUNCE = -4.2;
  const COYOTE = 6;
  const JUMP_BUFFER = 7;
  const STOMP_GRACE = 30; // 踏みつけ直後、バウンド中にシェルを再接触しても蹴らない猶予(フレーム)

  const PLAYER_W = 12;
  const PLAYER_H_SMALL = 16;
  const PLAYER_H_BIG = 32;

  // 敵
  const ENEMY_WALKER_SPEED = 0.55;
  const ENEMY_SHELLER_SPEED = 0.6;
  const ENEMY_SHELL_SPEED = 3.6;

  const T = global.Levels.T;
  const AudioSys = global.AudioSys;
  const Input = global.Input;

  const STATE = {
    TITLE: 'TITLE',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    PLAYER_DEAD: 'PLAYER_DEAD',
    STAGE_CLEAR: 'STAGE_CLEAR',
    GAME_OVER: 'GAME_OVER',
    GAME_CLEAR: 'GAME_CLEAR'
  };

  /* ---------- タイル補助 ---------- */
  function isSolid(t) {
    return t === T.GROUND || t === T.BLOCK || t === T.BRICK ||
           t === T.POWER || t === T.COINBLOCK || t === T.USED ||
           t === T.PIPE_TL || t === T.PIPE_TR || t === T.PIPE_L || t === T.PIPE_R;
  }
  function isHittable(t) {
    return t === T.BLOCK || t === T.BRICK || t === T.POWER || t === T.COINBLOCK;
  }

  /* グリッド外: 左端は固い壁、それ以外は空 */
  function tileAt(level, tx, ty) {
    if (ty < 0 || ty >= level.height) return T.EMPTY;
    if (tx < 0) return T.BLOCK;
    if (tx >= level.width) return T.EMPTY;
    return level.grid[ty][tx];
  }

  /* ---------- 軸別の当たり判定 ---------- */
  function collideAxisX(e, level) {
    if (e.vx === 0) return false;
    const dir = e.vx > 0 ? 1 : -1;
    const edge = dir > 0 ? e.x + e.w - 0.001 : e.x;
    const tx = Math.floor(edge / TILE);
    const ty0 = Math.floor(e.y / TILE);
    const ty1 = Math.floor((e.y + e.h - 0.001) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isSolid(tileAt(level, tx, ty))) {
        if (dir > 0) e.x = tx * TILE - e.w;
        else e.x = (tx + 1) * TILE;
        e.vx = 0;
        return true;
      }
    }
    return false;
  }

  /* 下からの着地。prevBottom は移動前の足位置(一方通行足場判定用) */
  function collideAxisY(e, level) {
    const prevBottom = e.prevBottom != null ? e.prevBottom : (e.y + e.h);
    e.onGround = false;
    let headHit = null;

    if (e.vy > 0) {
      const bottom = e.y + e.h;
      const ty = Math.floor(bottom / TILE);
      const tx0 = Math.floor((e.x + 0.001) / TILE);
      const tx1 = Math.floor((e.x + e.w - 0.001) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tileAt(level, tx, ty);
        let land = false;
        if (isSolid(t)) land = true;
        else if (t === T.PLAT && prevBottom <= ty * TILE + 0.5) land = true;
        if (land) {
          e.y = ty * TILE - e.h;
          e.vy = 0;
          e.onGround = true;
          break;
        }
      }
    } else if (e.vy < 0) {
      const top = e.y;
      const ty = Math.floor(top / TILE);
      const tx0 = Math.floor((e.x + 0.001) / TILE);
      const tx1 = Math.floor((e.x + e.w - 0.001) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isSolid(tileAt(level, tx, ty))) {
          e.y = (ty + 1) * TILE;
          e.vy = 0;
          headHit = { tx, ty };
          break;
        }
      }
    } else {
      // vy==0: 接地確認
      const bottom = e.y + e.h + 0.001;
      const ty = Math.floor(bottom / TILE);
      const tx0 = Math.floor((e.x + 0.001) / TILE);
      const tx1 = Math.floor((e.x + e.w - 0.001) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tileAt(level, tx, ty);
        if (isSolid(t) || t === T.PLAT) { e.onGround = true; break; }
      }
    }
    return headHit;
  }

  /* ---------- パーティクル ---------- */
  class Particle {
    constructor(x, y, vx, vy, life, color, size, grav) {
      this.x = x; this.y = y; this.vx = vx; this.vy = vy;
      this.life = life; this.maxLife = life;
      this.color = color; this.size = size || 2;
      this.grav = grav != null ? grav : 0.2;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += this.grav;
      this.life--;
    }
  }

  /* ---------- プレイヤー ---------- */
  class Player {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.w = PLAYER_W;
      this.h = PLAYER_H_SMALL;
      this.vx = 0;
      this.vy = 0;
      this.facing = 1;
      this.onGround = false;
      this.prevBottom = y + this.h;
      this.big = false;
      this.invincible = 0;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumping = false;
      this.running = false;
      this.anim = 0;          // 歩行アニメ
      this.dead = false;
      this.deathFromPit = false;
      this.controlled = true;
      this.pose = 'idle';     // idle / run / jump / fall / slide
    }
    reset(x, y) {
      this.x = x; this.y = y;
      this.w = PLAYER_W; this.h = PLAYER_H_SMALL;
      this.vx = 0; this.vy = 0;
      this.facing = 1;
      this.onGround = false;
      this.prevBottom = y + this.h;
      this.big = false;
      this.invincible = 0;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumping = false;
      this.running = false;
      this.anim = 0;
      this.dead = false;
      this.deathFromPit = false;
      this.controlled = true;
      this.pose = 'idle';
    }
  }

  /* ---------- 敵 ---------- */
  class Enemy {
    constructor(type, x, y, dir) {
      this.type = type;        // walker / sheller
      this.x = x; this.y = y;
      this.dir = dir || -1;
      this.state = 'walk';     // walk / shell / sliding / dead
      this.vy = 0;
      this.vx = 0;
      this.onGround = false;
      this.prevBottom = y;
      this.dead = false;
      this.deadTimer = 0;
      this.squash = 0;         // 潰れ演出タイマー
      this.stompGrace = 0;     // 踏みつけ直後の再接触ガード
      this.anim = Math.random() * 10;
      this.w = (type === 'sheller') ? 14 : 14;
      this.h = (type === 'sheller') ? 24 : 14;
    }
  }

  /* ---------- アイテム ---------- */
  class Item {
    constructor(type, x, y) {
      this.type = type;        // mushroom / coinpop
      this.x = x; this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.onGround = false;
      this.prevBottom = y;
      this.emerge = 0;
      this.life = 0;
      this.dir = 1;
      if (type === 'mushroom') {
        this.w = 14; this.h = 14;
        this.emerge = 20;
        this.vy = -2;
      } else {
        this.w = 10; this.h = 10;
        this.life = 26;
        this.vy = -5.5;
      }
    }
  }

  /* =========================================================================
   * Game 本体
   * ========================================================================= */
  class Game {
    constructor() {
      this.state = STATE.TITLE;
      this.score = 0;
      this.coins = 0;
      this.lives = 3;
      this.stageIndex = 0;
      this.level = null;
      this.player = new Player(0, 0);
      this.enemies = [];        // アクティブ敵
      this.pendingEnemies = []; // 未スポーン敵
      this.items = [];
      this.particles = [];
      this.bumps = new Map();   // "tx,ty" -> timer
      this.cameraX = 0;
      this.timeLeft = 0;
      this.stateTimer = 0;
      this.clearedFlags = new Set(); // ステージクリア済みフラグ
      this.msg = '';
      this.msgTimer = 0;
      // TITLE 画面でも描画できるように最初からステージをロード
      this.loadStage(0);
    }

    /* ---------- 進行 ---------- */
    newGame() {
      this.score = 0;
      this.coins = 0;
      this.lives = 3;
      this.stageIndex = 0;
      this.clearedFlags.clear();
      this.loadStage(0);
      this.setState(STATE.PLAYING);
      AudioSys.unlock();
      AudioSys.confirm();
    }

    loadStage(i) {
      const src = global.Levels.list[i];
      // グリッドをコピー(ステージ切替で旧状態が残らないように)
      const grid = src.grid.map((row) => row.slice());

      // 地面のコインをタイル化(固体と重ならない場合のみ)
      (src.coins || []).forEach((tx) => {
        if (tx >= 0 && tx < grid[0].length && grid[12][tx] === T.EMPTY) {
          grid[12][tx] = T.COIN;
        }
      });

      this.level = {
        name: src.name,
        theme: src.theme,
        width: src.width,
        height: src.height,
        grid: grid,
        startX: src.startX,
        startH: src.startH,
        goalX: src.goalX,
        flagX: src.flagX,
        timeLimit: src.timeLimit
      };

      this.player.reset(src.startX, src.startY);
      this.enemies = [];
      this.pendingEnemies = src.enemies.map((e) => ({ ...e }));
      this.items = [];
      this.particles = [];
      this.bumps.clear();
      this.clearedFlags.clear(); // リスタートで敵を再出現させる
      this.cameraX = 0;
      this.timeLeft = src.timeLimit;
    }

    setState(s) {
      this.state = s;
      this.stateTimer = 0;
    }

    /* ---------- スコア・コイン ---------- */
    addScore(n) {
      this.score += n;
    }
    addCoin(n) {
      this.coins += n;
      if (this.coins >= 100) {
        this.coins -= 100;
        this.lives++;
        AudioSys.oneUp();
        this.showMsg('1UP!');
      }
    }
    showMsg(text) {
      this.msg = text;
      this.msgTimer = 90;
    }

    /* ---------- カメラ ---------- */
    updateCamera() {
      const target = this.player.x - VIEW_W / 3;
      if (target > this.cameraX) this.cameraX = target;
      const max = this.level.width * TILE - VIEW_W;
      if (this.cameraX > max) this.cameraX = max;
      if (this.cameraX < 0) this.cameraX = 0;
    }

    /* ---------- プレイヤー更新(PLAYING) ---------- */
    updatePlayer() {
      const p = this.player;
      if (!p.controlled) return;

      // 横移動
      const left = global.Input.isDown('left');
      const right = global.Input.isDown('right');
      const dash = global.Input.isDown('dash');
      let dir = 0;
      if (left && !right) dir = -1;
      else if (right && !left) dir = 1;

      const target = (dash ? MAX_RUN : MAX_WALK) * dir;
      if (dir !== 0) {
        p.vx += ACCEL * dir;
        if ((dir > 0 && p.vx > target) || (dir < 0 && p.vx < target)) p.vx = target;
        p.facing = dir;
      } else {
        p.vx *= FRICTION;
        if (Math.abs(p.vx) < 0.05) p.vx = 0;
      }
      p.running = dash && dir !== 0 && Math.abs(p.vx) > 1.55;

      // ジャンプバッファ / コヨーテ
      if (global.Input.wasPressed('jump')) p.jumpBuffer = JUMP_BUFFER;
      else if (p.jumpBuffer > 0) p.jumpBuffer--;

      if (p.onGround) p.coyote = COYOTE;
      else if (p.coyote > 0) p.coyote--;

      if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
        p.vy = JUMP_V;
        p.onGround = false;
        p.coyote = 0;
        p.jumpBuffer = 0;
        p.jumping = true;
        AudioSys.jump();
        // 着地ダスト
        for (let i = 0; i < 4; i++) {
          this.particles.push(new Particle(
            p.x + p.w / 2, p.y + p.h,
            (Math.random() - 0.5) * 1.2, -Math.random() * 1.5,
            12, 'rgba(255,255,255,0.7)', 2, 0.1
          ));
        }
      }

      // 可変ジャンプ
      const jumpHeld = global.Input.isDown('jump');
      if (p.vy < 0 && !jumpHeld && p.jumping && global.Input.wasReleased('jump')) {
        p.vy *= 0.5; // ジャンプカット
      }
      let g = GRAVITY;
      if (p.vy < 0 && jumpHeld) g = GRAV_JUMP;
      p.vy += g;
      if (p.vy > MAX_FALL) p.vy = MAX_FALL;

      // X 方向移動 + 衝突
      p.x += p.vx;
      collideAxisX(p, this.level);

      // Y 方向移動 + 衝突
      p.prevBottom = p.y + p.h;
      p.y += p.vy;
      const head = collideAxisY(p, this.level);
      if (head) this.bumpBlock(head.tx, head.ty);
      if (p.onGround) p.jumping = false;

      // ポーズ判定
      if (p.vy > 0.5) p.pose = 'fall';
      else if (!p.onGround) p.pose = 'jump';
      else if (Math.abs(p.vx) > 0.2) p.pose = 'run';
      else p.pose = 'idle';

      // 歩行アニメ
      if (p.onGround && Math.abs(p.vx) > 0.2) p.anim += Math.abs(p.vx) * 0.25;
      else p.anim += 0.2;

      if (p.invincible > 0) p.invincible--;

      // 穴落ち
      if (p.y > LEVEL_H + 24) {
        this.killPlayer(true);
      }
    }

    /* ---------- プレイヤー死亡 ---------- */
    killPlayer(fromPit) {
      const p = this.player;
      if (p.dead) return;
      p.dead = true;
      p.deathFromPit = !!fromPit;
      p.controlled = false;
      if (fromPit) {
        p.vy = 0;
        this.setState(STATE.PLAYER_DEAD);
        AudioSys.die();
      } else {
        p.vy = -5.5;
        p.vx = 0;
        this.setState(STATE.PLAYER_DEAD);
        AudioSys.die();
      }
    }

    updatePlayerDead() {
      const p = this.player;
      this.stateTimer++;
      // 死亡アニメ: 上に跳ねてから落ちていく
      if (!p.deathFromPit) {
        p.vy += GRAVITY;
        p.y += p.vy;
      } else {
        p.y += 2.2; // 穴に沈む
      }
      if (this.stateTimer >= 100) {
        // 残機減少
        this.lives--;
        if (this.lives < 0) this.lives = 0;
        if (this.lives > 0) {
          this.loadStage(this.stageIndex);
          this.setState(STATE.PLAYING);
        } else {
          this.setState(STATE.GAME_OVER);
        }
      }
    }

    /* ---------- 敵 ---------- */
    spawnEnemies() {
      const camLeft = this.cameraX - 40;
      const camRight = this.cameraX + VIEW_W + 40;
      const stillPending = [];
      for (let i = 0; i < this.pendingEnemies.length; i++) {
        const e = this.pendingEnemies[i];
        const ex = e.tx * TILE;
        if (ex > camLeft && ex < camRight && !this.clearedFlags.has(e.tx + ':' + e.ty)) {
          const en = new Enemy(e.type, ex, e.ty * TILE, e.dir);
          // 敵の足元を地面に合わせる(階段等の上にいる場合の高さ調整)
          en.y = this.groundTopAt(en.x, en.w) - en.h;
          this.enemies.push(en);
          this.clearedFlags.add(e.tx + ':' + e.ty);
        } else {
          stillPending.push(e);
        }
      }
      this.pendingEnemies = stillPending;
    }

    /* 指定X範囲の接地タイル上面(px)。なければ LEVEL_H */
    groundTopAt(x, w) {
      const tx0 = Math.floor(x / TILE);
      const tx1 = Math.floor((x + w - 0.001) / TILE);
      let top = LEVEL_H;
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = 0; ty < this.level.height; ty++) {
          const t = tileAt(this.level, tx, ty);
          if (isSolid(t) || t === T.PLAT) {
            if (ty * TILE < top) { top = ty * TILE; break; }
          }
        }
      }
      return top;
    }

    updateEnemies() {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];

        // 踏みつけ無効期間のカウントダウン
        if (e.stompGrace > 0) e.stompGrace--;

        // 死亡演出
        if (e.state === 'dead') {
          e.deadTimer++;
          if (e.deadTimer > 40) { this.enemies.splice(i, 1); }
          continue;
        }

        e.vy += GRAVITY;
        if (e.vy > MAX_FALL) e.vy = MAX_FALL;

        if (e.state === 'sliding') {
          // 高速移動: 壁で跳ね返る
          e.x += e.vx;
          if (collideAxisX(e, this.level)) {
            e.vx *= -1;
            AudioSys.kick();
          }
        } else if (e.state === 'walk' || e.state === 'shell') {
          if (e.state === 'walk') {
            e.vx = e.dir * ENEMY_WALKER_SPEED * (e.type === 'sheller' ? (ENEMY_SHELLER_SPEED / ENEMY_WALKER_SPEED) : 1);
            e.x += e.vx;
            if (collideAxisX(e, this.level)) {
              e.dir *= -1;
              e.vx = e.dir * ENEMY_WALKER_SPEED;
            }
          } else {
            e.vx = 0;
          }
        }

        // Y 方向
        e.prevBottom = e.y + e.h;
        e.y += e.vy;
        collideAxisY(e, this.level);

        e.anim += 0.25;

        // 穴落ち
        if (e.y > LEVEL_H + 40) {
          this.enemies.splice(i, 1);
          continue;
        }
        // 画面後方へ消えたら除去
        if (e.x < this.cameraX - 80) {
          this.enemies.splice(i, 1);
          continue;
        }
        // 潰れ演出
        if (e.squash > 0) {
          e.squash--;
          if (e.squash === 0) { e.state = 'dead'; e.deadTimer = 0; }
        }
      }
    }

    /* ---------- 踏みつけ / 接触 ---------- */
    checkEnemyInteractions() {
      const p = this.player;
      if (!p.controlled) return;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (e.state === 'dead') continue;
        if (e.stompGrace > 0) continue; // 踏みつけ直後: バウンド中の再接触で蹴らない・ダメージなし
        if (!overlap(p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h)) continue;

        const falling = p.vy > 0;
        // 直前に敵より上にいたか(段差から降りる場合など)
        const wasAbove = p.prevBottom <= e.y + 6;
        // 現在の足元が敵の中心より上か(横から触れただけの誤判定防止)
        const aboveCenter = (p.y + p.h) <= (e.y + e.h * 0.55 + 6);

        if (falling && (wasAbove || aboveCenter)) {
          // 踏みつけ
          this.stompEnemy(e);
          continue;
        }

        // 踏みつけではない接触
        if (e.state === 'shell') {
          // 静止シェルに横から触れる → 蹴る
          this.kickShell(e, p);
          continue;
        }
        if (e.state === 'sliding') {
          // 高速シェルに接触 → ダメージ
          this.damagePlayer();
          continue;
        }
        // walker / 歩行シェル に横から触れる → ダメージ
        this.damagePlayer();
      }
    }

    stompEnemy(e) {
      const p = this.player;
      if (e.type === 'walker') {
        // 踏んで倒す
        e.state = 'dead';
        e.squash = 0;
        e.deadTimer = 0;
        e.vx = 0;
        this.addScore(100);
        this.puff(e.x + e.w / 2, e.y + e.h);
        AudioSys.stomp();
      } else {
        // sheller
        if (e.state === 'walk') {
          e.state = 'shell';
          e.vx = 0;
          e.h = 14;
          e.y = e.y + 24 - 14; // 甲羅状態は低くなる(足元維持)
          e.stompGrace = STOMP_GRACE; // バウンド中に再接触しても蹴らない
          this.addScore(100);
          AudioSys.stomp();
        } else if (e.state === 'shell') {
          // 静止シェルを踏む → 蹴る
          this.kickShell(e, p);
          this.addScore(200);
        } else if (e.state === 'sliding') {
          // 高速シェルを踏む → 停止
          e.state = 'shell';
          e.vx = 0;
          e.h = 14;
          e.stompGrace = STOMP_GRACE; // バウンド中に再接触しても蹴らない
          this.addScore(200);
          AudioSys.stomp();
        }
      }
      // バウンド
      p.vy = STOMP_BOUNCE;
      p.jumping = false;
    }

    kickShell(e, p) {
      e.state = 'sliding';
      // kickShell は h=14 の静止シェルにのみ呼ばれるため、Y は調整しない
      e.dir = (p.x < e.x) ? 1 : -1;
      e.vx = e.dir * ENEMY_SHELL_SPEED;
      AudioSys.kick();
    }

    /* シェル(高速)が他の敵を倒す */
    checkShellKills() {
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (e.state !== 'sliding') continue;
        for (let j = 0; j < this.enemies.length; j++) {
          const other = this.enemies[j];
          if (i === j) continue;
          if (other.state === 'dead') continue;
          if (!overlap(e.x, e.y, e.w, e.h, other.x, other.y, other.w, other.h)) continue;
          // 高速シェルは他の敵を倒す
          other.state = 'dead';
          other.deadTimer = 0;
          other.vx = 0;
          this.addScore(200);
          this.puff(other.x + other.w / 2, other.y + other.h / 2);
        }
      }
    }

    /* ブロック上にいる敵を弾く */
    bumpEnemiesOnBlock(tx, ty) {
      const top = ty * TILE;
      for (const e of this.enemies) {
        if (e.state === 'dead' || e.state === 'sliding') continue;
        if (e.x + e.w > tx * TILE && e.x < (tx + 1) * TILE) {
          if (e.y + e.h >= top - 5 && e.y < top + 6) {
            if (e.type === 'walker') {
              e.state = 'dead';
              e.deadTimer = 0;
              e.vx = 0;
              this.addScore(100);
              this.puff(e.x + e.w / 2, e.y + e.h);
              AudioSys.stomp();
            } else {
              // シェルは跳ねる
              e.vy = -4;
              if (e.state === 'walk') {
                e.state = 'shell';
                e.h = 14;
                e.y += 24 - 14; // 足元維持
              }
              AudioSys.kick();
            }
          }
        }
      }
    }

    puff(x, y) {
      for (let i = 0; i < 5; i++) {
        this.particles.push(new Particle(
          x, y - 2,
          (Math.random() - 0.5) * 2, -Math.random() * 1.5,
          12, 'rgba(255,255,255,0.8)', 2, 0.05
        ));
      }
    }

    /* ---------- ブロック ---------- */
    bumpBlock(tx, ty) {
      const t = tileAt(this.level, tx, ty);
      const key = tx + ',' + ty;
      // アニメーション
      this.bumps.set(key, 12);

      if (t === T.USED) {
        AudioSys.bump();
        return;
      }
      if (t === T.BRICK) {
        if (this.player.big) {
          this.breakBrick(tx, ty);
        } else {
          AudioSys.bump();
        }
      } else if (t === T.POWER) {
        this.level.grid[ty][tx] = T.USED;
        this.spawnMushroom(tx, ty);
        AudioSys.mushroomPop();
      } else if (t === T.COINBLOCK) {
        this.spawnCoinPop(tx, ty);
        AudioSys.blockCoin();
      } else if (t === T.BLOCK) {
        this.level.grid[ty][tx] = T.USED;
        AudioSys.bump();
      } else {
        AudioSys.bump();
        return;
      }
      this.bumpEnemiesOnBlock(tx, ty);
    }

    breakBrick(tx, ty) {
      this.level.grid[ty][tx] = T.EMPTY;
      this.addScore(50);
      AudioSys.breakBlock();
      const cx = tx * TILE + 8;
      const cy = ty * TILE + 8;
      for (let i = 0; i < 8; i++) {
        this.particles.push(new Particle(
          cx, cy,
          (Math.random() - 0.5) * 3.5, -Math.random() * 3 - 1,
          30, 'rgb(180,110,40)', 3, 0.25
        ));
      }
    }

    /* ---------- アイテム ---------- */
    spawnMushroom(tx, ty) {
      const it = new Item('mushroom', tx * TILE + 1, ty * TILE - 14);
      it.dir = 1;
      this.items.push(it);
    }
    spawnCoinPop(tx, ty) {
      const it = new Item('coinpop', tx * TILE + 3, ty * TILE - 10);
      this.items.push(it);
      this.addCoin(1);
      this.addScore(200);
    }

    updateItems() {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];

        if (it.type === 'mushroom') {
          if (it.emerge > 0) {
            it.emerge--;
            it.y += it.vy; // ブロックから浮上
            // 浮上中は接地しない
          } else {
            it.vy += GRAVITY;
            if (it.vy > MAX_FALL) it.vy = MAX_FALL;
            it.vx = it.dir * 0.7;
            it.x += it.vx;
            if (collideAxisX(it, this.level)) { it.dir *= -1; }
            it.prevBottom = it.y + it.h;
            it.y += it.vy;
            collideAxisY(it, this.level);
          }
          if (it.y > LEVEL_H + 40) { this.items.splice(i, 1); continue; }

          // プレイヤー取得
          const p = this.player;
          if (p.controlled && overlap(p.x, p.y, p.w, p.h, it.x, it.y, it.w, it.h)) {
            this.collectMushroom(it);
            this.items.splice(i, 1);
            continue;
          }
        } else {
          // コインポップ
          it.vy += 0.18;
          it.y += it.vy;
          it.life--;
          if (it.life <= 0) { this.items.splice(i, 1); }
        }
      }
    }

    collectMushroom(it) {
      const p = this.player;
      if (!p.big) {
        // 頭上にスペースがあれば成長
        if (this.canFit(p.x, p.y - (PLAYER_H_BIG - p.h), PLAYER_W, PLAYER_H_BIG)) {
          p.y -= (PLAYER_H_BIG - p.h);
          p.h = PLAYER_H_BIG;
          p.big = true;
        }
        this.addScore(1000);
      } else {
        this.addScore(1000);
      }
      AudioSys.powerup();
      // きのこパーティクル
      for (let i = 0; i < 8; i++) {
        this.particles.push(new Particle(
          it.x + it.w / 2, it.y + it.h / 2,
          (Math.random() - 0.5) * 3, -Math.random() * 2 - 1,
          20, 'rgb(255,120,80)', 2, 0.15
        ));
      }
    }

    canFit(x, y, w, h) {
      const tx0 = Math.floor(x / TILE);
      const tx1 = Math.floor((x + w - 0.001) / TILE);
      const ty0 = Math.floor(y / TILE);
      const ty1 = Math.floor((y + h - 0.001) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (isSolid(tileAt(this.level, tx, ty))) return false;
        }
      }
      return true;
    }

    /* ---------- コインタイル回収 ---------- */
    collectCoins() {
      const p = this.player;
      if (!p.controlled) return;
      const tx0 = Math.floor(p.x / TILE);
      const tx1 = Math.floor((p.x + p.w - 0.001) / TILE);
      const ty0 = Math.floor(p.y / TILE);
      const ty1 = Math.floor((p.y + p.h - 0.001) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (tx < 0 || tx >= this.level.width || ty < 0 || ty >= this.level.height) continue;
          if (this.level.grid[ty][tx] === T.COIN) {
            this.level.grid[ty][tx] = T.EMPTY;
            this.addCoin(1);
            this.addScore(200);
            AudioSys.coin();
            // コインスパーク
            for (let i = 0; i < 6; i++) {
              this.particles.push(new Particle(
                tx * TILE + 8, ty * TILE + 8,
                (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5,
                18, 'rgb(255,215,80)', 2, 0.05
              ));
            }
          }
        }
      }
    }

    /* ---------- ダメージ ---------- */
    damagePlayer() {
      const p = this.player;
      if (p.invincible > 0 || p.dead) return;
      if (p.big) {
        // 小さくなる
        p.big = false;
        p.h = PLAYER_H_SMALL;
        p.y += PLAYER_H_BIG - PLAYER_H_SMALL; // 足元維持
        p.invincible = 110;
        p.vy = -3;
        p.vx = -p.facing * 2;
        AudioSys.damage();
      } else {
        this.killPlayer(false);
      }
    }

    /* ---------- ゴール ---------- */
    checkGoal() {
      if (this.player.x >= this.level.goalX - 6) {
        this.startStageClear();
      }
    }

    startStageClear() {
      if (this.state !== STATE.PLAYING) return;
      const p = this.player;
      p.controlled = false;
      p.vx = 0;
      p.vy = 0;
      // フラッグポール位置へ合わせてスライド
      p.x = this.level.flagX * TILE + 2;
      p.pose = 'slide';
      this.setState(STATE.STAGE_CLEAR);
      AudioSys.goal();
    }

    updateStageClear() {
      this.stateTimer++;
      const p = this.player;
      const groundY = SURFACE_ROW_TOP;
      // ポールを滑り降りる
      if (this.stateTimer < 40) {
        p.y += 2.4;
        if (p.y >= groundY - p.h) {
          p.y = groundY - p.h;
        }
      } else if (this.stateTimer < 80) {
        // 右へ歩き去る
        p.x += 1.6;
        p.pose = 'run';
        p.anim += 0.3;
      } else if (this.stateTimer === 80) {
        // スコア集計
        const timeBonus = Math.floor(this.timeLeft) * 10;
        this.addScore(timeBonus);
        AudioSys.stageClear();
        // 花火
        this.fireworks();
      } else if (this.stateTimer >= 190) {
        // 次ステージへ
        if (this.stageIndex < global.Levels.list.length - 1) {
          this.stageIndex++;
          const keepBig = this.player.big; // パワー状態はステージ間で引き継ぐ
          this.loadStage(this.stageIndex);
          if (keepBig) {
            this.player.big = true;
            this.player.h = PLAYER_H_BIG;
            this.player.y -= (PLAYER_H_BIG - PLAYER_H_SMALL); // 足元を維持
          }
          this.setState(STATE.PLAYING);
        } else {
          this.setState(STATE.GAME_CLEAR);
        }
      }
      this.updateParticles();
      this.updateCamera();
    }

    fireworks() {
      for (let i = 0; i < 20; i++) {
        const colors = ['rgb(255,80,80)', 'rgb(255,215,80)', 'rgb(80,200,255)', 'rgb(140,255,140)', 'rgb(255,140,255)'];
        const c = colors[Math.floor(Math.random() * colors.length)];
        const bx = this.cameraX + 60 + Math.random() * (VIEW_W - 120);
        const by = 60 + Math.random() * 100;
        for (let k = 0; k < 12; k++) {
          const ang = (Math.PI * 2 * k) / 12;
          this.particles.push(new Particle(
            bx, by,
            Math.cos(ang) * (1 + Math.random()), Math.sin(ang) * (1 + Math.random()),
            30 + Math.random() * 20, c, 2, 0.02
          ));
        }
      }
    }

    /* ---------- パーティクル ---------- */
    updateParticles() {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        this.particles[i].update();
        if (this.particles[i].life <= 0) this.particles.splice(i, 1);
      }
    }

    /* ---------- 時間 ---------- */
    updateTime(dt) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.killPlayer(false);
      }
    }

    /* ---------- 更新ディスパッチ ---------- */
    update(dt) {
      if (this.msgTimer > 0) this.msgTimer--;

      switch (this.state) {
        case STATE.TITLE:
          this.updateTitle();
          break;
        case STATE.PLAYING:
          this.updatePlaying(dt);
          break;
        case STATE.PAUSED:
          this.updatePaused();
          break;
        case STATE.PLAYER_DEAD:
          this.updatePlayerDead();
          break;
        case STATE.STAGE_CLEAR:
          this.updateStageClear();
          break;
        case STATE.GAME_OVER:
          this.updateGameOver();
          break;
        case STATE.GAME_CLEAR:
          this.updateGameClear();
          break;
      }
    }

    updateTitle() {
      this.stateTimer++;
      // デモ的な背景アニメーション
      if (global.Input.wasPressed('confirm') || global.Input.wasPressed('jump')) {
        global.Input.consume('pause'); // ゲームパッドStartがpause兼用のため
        this.newGame();
      }
    }

    updatePlaying(dt) {
      // ポーズ
      if (global.Input.wasPressed('pause')) {
        global.Input.consume('pause');
        this.setState(STATE.PAUSED);
        AudioSys.pause();
        return;
      }

      this.spawnEnemies();
      this.updatePlayer();
      this.updateEnemies();
      this.checkEnemyInteractions();
      this.checkShellKills();
      this.updateItems();
      this.collectCoins();
      this.updateParticles();
      this.updateCamera();
      this.updateTime(dt);

      if (this.state === STATE.PLAYING) {
        this.checkGoal();
      }
    }

    updatePaused() {
      if (global.Input.wasPressed('pause') || global.Input.wasPressed('confirm') || global.Input.wasPressed('jump')) {
        global.Input.consume('pause');
        global.Input.consume('confirm');
        global.Input.consume('jump');
        this.setState(STATE.PLAYING);
        AudioSys.confirm();
      }
    }

    updateGameOver() {
      this.stateTimer++;
      if (this.stateTimer > 60) {
        if (global.Input.wasPressed('confirm') || global.Input.wasPressed('jump')) {
          global.Input.consume('confirm');
          global.Input.consume('jump');
          this.setState(STATE.TITLE);
        }
      }
    }

    updateGameClear() {
      this.stateTimer++;
      if (this.stateTimer > 60) {
        if (global.Input.wasPressed('confirm') || global.Input.wasPressed('jump')) {
          global.Input.consume('confirm');
          global.Input.consume('jump');
          this.setState(STATE.TITLE);
        }
      }
    }
  }

  /* 接地基準 */
  const SURFACE_ROW_TOP = 12 * TILE; // 208

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  global.Engine = {
    Game: Game,
    Player: Player,
    Enemy: Enemy,
    Item: Item,
    Particle: Particle,
    STATE: STATE,
    TILE: TILE,
    VIEW_W: VIEW_W,
    VIEW_H: VIEW_H,
    HUD_H: HUD_H,
    LEVEL_H: LEVEL_H,
    STEP: STEP,
    T: T,
    SURFACE_ROW_TOP: SURFACE_ROW_TOP,
    overlap: overlap
  };
})(window);
