/* =========================================================================
 * levels.js
 * -------------------------------------------------------------------------
 * ステージはタイルマップ(グリッド)と敵データとして定義し、ゲームロジック
 * から分離する。ビルダー関数で地形を作成する。
 *
 * タイル種別:
 *   0 EMPTY  1 GROUND  2 BLOCK(通常)  3 BRICK(壊せる)  4 POWER(きのこ)
 *   5 COINBLOCK(コイン) 6 USED  7 PIPE_TL 8 PIPE_TR 9 PIPE_L 10 PIPE_R
 *   11 COIN(浮きコイン) 12 PLAT(一方通行足場)
 *
 * グリッドは 16 行 (y=0..15)。地面は y=13,14,15。表面 y=208(px)。
 * ========================================================================= */
(function (global) {
  'use strict';

  const T = {
    EMPTY: 0,
    GROUND: 1,
    BLOCK: 2,
    BRICK: 3,
    POWER: 4,
    COINBLOCK: 5,
    USED: 6,
    PIPE_TL: 7,
    PIPE_TR: 8,
    PIPE_L: 9,
    PIPE_R: 10,
    COIN: 11,
    PLAT: 12
  };

  const H = 16;          // 行数
  const SURFACE_ROW = 12; // 敵やプレイヤーの基準面(グリッド行)

  /* ---------- ビルダー ---------- */
  function makeGrid(w) {
    const g = [];
    for (let y = 0; y < H; y++) {
      g.push(new Array(w).fill(T.EMPTY));
    }
    return g;
  }

  function fillGround(g, x0, x1) {
    for (let x = x0; x <= x1; x++) {
      for (let y = 13; y < H; y++) {
        g[y][x] = T.GROUND;
      }
    }
  }

  function digPit(g, x0, x1) {
    for (let x = x0; x <= x1; x++) {
      for (let y = 13; y < H; y++) {
        g[y][x] = T.EMPTY;
      }
    }
  }

  function setTile(g, x, y, t) {
    if (y >= 0 && y < H && x >= 0 && x < g[0].length) {
      g[y][x] = t;
    }
  }

  function rowBlocks(g, x0, x1, y, t) {
    for (let x = x0; x <= x1; x++) setTile(g, x, y, t);
  }

  /* 上り階段(右へ高くなる)。n 段、先頭 x */
  function stairsUp(g, x, n) {
    for (let i = 0; i < n; i++) {
      const h = i + 1;
      for (let k = 0; k < h; k++) {
        setTile(g, x + i, 13 - k, T.GROUND);
      }
    }
  }

  /* 下り階段(右へ低くなる)。先頭 x は最高段 */
  function stairsDown(g, x, n) {
    for (let i = 0; i < n; i++) {
      const h = n - i;
      for (let k = 0; k < h; k++) {
        setTile(g, x + i, 13 - k, T.GROUND);
      }
    }
  }

  /* 土管。x は左列タイル、h は高さ(タイル数)。地面に立つ */
  function addPipe(g, x, h) {
    const topY = 13 - h;
    for (let y = topY; y <= 12; y++) {
      if (y === topY) {
        setTile(g, x, y, T.PIPE_TL);
        setTile(g, x + 1, y, T.PIPE_TR);
      } else {
        setTile(g, x, y, T.PIPE_L);
        setTile(g, x + 1, y, T.PIPE_R);
      }
    }
  }

  /* ブロック列の上に浮きコインを置く */
  function coinsAbove(g, x0, x1, y) {
    for (let x = x0; x <= x1; x++) setTile(g, x, y, T.COIN);
  }

  /* 完成したステージデータを返す */
  function finish(stage) {
    // グリッドを確認しつつ、ゴール地点の地面を確保
    const w = stage.grid[0].length;
    return {
      name: stage.name,
      theme: stage.theme,
      width: w,
      height: H,
      grid: stage.grid,
      startX: stage.startX * 16,
      startY: SURFACE_ROW * 16 - stage.startH, // プレイヤー基準
      startH: stage.startH,
      goalX: stage.goalX * 16,
      flagX: stage.flagX,
      timeLimit: stage.timeLimit,
      enemies: stage.enemies || [],
      coins: stage.coins || []
    };
  }

  /* =====================================================================
   * STAGE 1 : 草原の丘 (Green Hills)
   * 基本操作 → 敵 → ブロック → パワーアップ → 小さな穴 → 複数敵 → 階段
   * ===================================================================== */
  function buildStage1() {
    const w = 205;
    const g = makeGrid(w);
    fillGround(g, 0, w - 1);

    // 小さな穴
    digPit(g, 27, 28);
    digPit(g, 40, 42);
    // 4タイル穴(足場あり)
    digPit(g, 58, 61);
    rowBlocks(g, 59, 60, 11, T.PLAT);
    digPit(g, 84, 87);
    rowBlocks(g, 85, 86, 11, T.PLAT);
    digPit(g, 107, 109);
    digPit(g, 143, 146);
    rowBlocks(g, 144, 145, 11, T.PLAT);
    digPit(g, 167, 168);
    digPit(g, 188, 189);

    // コインブロック(最初のブロック学習)
    rowBlocks(g, 10, 12, 9, T.COINBLOCK);
    coinsAbove(g, 10, 12, 7);

    // パワーアップブロック(最初のアイテム)
    setTile(g, 19, 9, T.BRICK);
    setTile(g, 20, 9, T.POWER);
    setTile(g, 21, 9, T.BRICK);

    // コインブロック
    rowBlocks(g, 35, 36, 9, T.COINBLOCK);
    coinsAbove(g, 35, 36, 7);
    setTile(g, 49, 9, T.COINBLOCK);
    setTile(g, 49, 7, T.COIN);

    // レンガ列 + コイン
    rowBlocks(g, 52, 55, 9, T.BRICK);
    coinsAbove(g, 52, 55, 7);

    // レンガ列 + パワー
    setTile(g, 94, 9, T.BRICK);
    setTile(g, 95, 9, T.BRICK);
    setTile(g, 96, 9, T.POWER);
    setTile(g, 97, 9, T.BRICK);
    setTile(g, 98, 9, T.BRICK);

    // コインブロック群
    rowBlocks(g, 112, 114, 9, T.COINBLOCK);
    coinsAbove(g, 112, 114, 7);

    // 階段(上り)
    stairsUp(g, 118, 6);

    // レンガ列 + コイン(高め)
    rowBlocks(g, 155, 159, 8, T.BRICK);
    coinsAbove(g, 155, 159, 6);

    // コインブロック
    setTile(g, 171, 9, T.COINBLOCK);
    setTile(g, 171, 7, T.COIN);

    // 階段(上り) - ゴール前
    stairsUp(g, 182, 6);

    // 土管
    addPipe(g, 70, 2);
    addPipe(g, 75, 3);
    addPipe(g, 125, 2);
    addPipe(g, 134, 3);

    // 地面のコイン(誘導)
    const groundCoins = [15, 23, 33, 44, 50, 57, 70, 76, 90, 101, 110, 125, 135, 148, 156, 165, 175, 185];

    // 敵
    const enemies = [];
    const walkers = [16, 24, 31, 32, 64, 66, 79, 80, 102, 104, 130, 150, 152, 176, 178];
    walkers.forEach((tx) => enemies.push({ type: 'walker', tx, ty: SURFACE_ROW, dir: -1 }));
    const shellers = [45, 90, 139, 163];
    shellers.forEach((tx) => enemies.push({ type: 'sheller', tx, ty: SURFACE_ROW, dir: -1 }));

    return finish({
      name: '1-1',
      theme: 'grass',
      grid: g,
      startX: 2,
      startH: 16,
      goalX: 195,
      flagX: 195,
      timeLimit: 300,
      enemies,
      coins: groundCoins
    });
  }

  /* =====================================================================
   * STAGE 2 : 洞窟 (Cavern)
   * 穴・足場・敵配置が増えた難易度。土管も多い。
   * ===================================================================== */
  function buildStage2() {
    const w = 230;
    const g = makeGrid(w);
    fillGround(g, 0, w - 1);

    // 穴(足場つきを混在)
    digPit(g, 20, 21);
    digPit(g, 34, 37);
    rowBlocks(g, 35, 36, 11, T.PLAT);
    digPit(g, 52, 53);
    digPit(g, 66, 68);
    digPit(g, 82, 85);
    rowBlocks(g, 83, 84, 11, T.PLAT);
    digPit(g, 98, 101);
    rowBlocks(g, 99, 100, 11, T.PLAT);
    digPit(g, 116, 117);
    digPit(g, 132, 135);
    rowBlocks(g, 133, 134, 11, T.PLAT);
    digPit(g, 150, 152);
    digPit(g, 168, 171);
    rowBlocks(g, 169, 170, 11, T.PLAT);
    digPit(g, 186, 187);
    digPit(g, 202, 204);
    digPit(g, 216, 219);
    rowBlocks(g, 217, 218, 11, T.PLAT);

    // ブロック配置
    // 冒頭のレンガ列 + パワー
    setTile(g, 12, 9, T.BRICK);
    setTile(g, 13, 9, T.POWER);
    setTile(g, 14, 9, T.BRICK);
    coinsAbove(g, 12, 14, 7);

    // コインブロック
    rowBlocks(g, 24, 25, 9, T.COINBLOCK);
    coinsAbove(g, 24, 25, 7);
    setTile(g, 44, 9, T.COINBLOCK);
    setTile(g, 44, 7, T.COIN);

    // レンガの高さ違い(ジャンプ練習)
    setTile(g, 48, 9, T.BRICK);
    setTile(g, 49, 9, T.BRICK);
    setTile(g, 50, 8, T.BRICK);
    setTile(g, 50, 9, T.BRICK);

    // 穴越えのコインアーチ
    coinsAbove(g, 34, 37, 10);

    // レンガ列 + パワー
    rowBlocks(g, 74, 78, 9, T.BRICK);
    setTile(g, 76, 9, T.POWER);
    coinsAbove(g, 74, 78, 7);

    // コインブロック
    rowBlocks(g, 90, 91, 9, T.COINBLOCK);
    coinsAbove(g, 90, 91, 7);

    // レンガ列(高め)
    rowBlocks(g, 106, 108, 8, T.BRICK);
    coinsAbove(g, 106, 108, 6);

    // コインブロック
    setTile(g, 122, 9, T.COINBLOCK);
    setTile(g, 122, 7, T.COIN);
    setTile(g, 123, 9, T.BRICK);
    setTile(g, 124, 9, T.POWER);

    // レンガ列 + パワー
    rowBlocks(g, 142, 146, 9, T.BRICK);
    setTile(g, 144, 9, T.POWER);
    coinsAbove(g, 142, 146, 7);

    // 階段(上り)
    stairsUp(g, 156, 5);

    // コインブロック
    rowBlocks(g, 178, 180, 9, T.COINBLOCK);
    coinsAbove(g, 178, 180, 7);

    // レンガ列(高め)
    rowBlocks(g, 192, 194, 8, T.BRICK);
    coinsAbove(g, 192, 194, 6);

    // 階段(上り) - ゴール前
    stairsUp(g, 208, 6);

    // 土管(高さ違い)
    addPipe(g, 30, 2);
    addPipe(g, 58, 2);
    addPipe(g, 62, 3);
    addPipe(g, 112, 2);
    addPipe(g, 118, 3);
    addPipe(g, 138, 3);
    addPipe(g, 164, 2);
    addPipe(g, 194, 3);

    // 地面コイン
    const groundCoins = [10, 18, 27, 42, 46, 54, 64, 71, 81, 88, 96, 104, 110, 120, 128, 140, 148, 155, 162, 166, 176, 184, 190, 200, 206, 214];

    // 敵
    const enemies = [];
    const walkers = [8, 16, 26, 33, 40, 46, 55, 60, 64, 71, 80, 87, 94, 104, 110, 120, 128, 137, 141, 148, 162, 166, 176, 184, 190, 200, 206, 212, 214];
    walkers.forEach((tx) => enemies.push({ type: 'walker', tx, ty: SURFACE_ROW, dir: -1 }));
    const shellers = [28, 49, 72, 96, 124, 154, 172, 196];
    shellers.forEach((tx) => enemies.push({ type: 'sheller', tx, ty: SURFACE_ROW, dir: -1 }));

    return finish({
      name: '2-1',
      theme: 'cave',
      grid: g,
      startX: 2,
      startH: 16,
      goalX: 224,
      flagX: 224,
      timeLimit: 300,
      enemies,
      coins: groundCoins
    });
  }

  /* =====================================================================
   * STAGE 3 : 真夜中の空 (Midnight Sky)
   * レンガと一方通行足場を使った立体プラットフォーム。雰囲気は夜。
   * ===================================================================== */
  function buildStage3() {
    const w = 230;
    const g = makeGrid(w);
    fillGround(g, 0, w - 1);

    // 穴(少なめ)
    digPit(g, 24, 25);
    digPit(g, 56, 59);
    rowBlocks(g, 57, 58, 11, T.PLAT);
    digPit(g, 92, 94);
    digPit(g, 128, 131);
    rowBlocks(g, 129, 130, 11, T.PLAT);
    digPit(g, 166, 168);
    digPit(g, 200, 203);
    rowBlocks(g, 201, 202, 11, T.PLAT);

    // レンガ + パワー(冒頭)
    setTile(g, 10, 9, T.BRICK);
    setTile(g, 11, 9, T.POWER);
    setTile(g, 12, 9, T.BRICK);
    coinsAbove(g, 10, 12, 7);

    // 空中足場(一方通行)による立体移動
    rowBlocks(g, 16, 18, 11, T.PLAT);
    rowBlocks(g, 22, 23, 11, T.PLAT);
    setTile(g, 22, 9, T.COINBLOCK);
    setTile(g, 22, 7, T.COIN);
    setTile(g, 23, 8, T.COINBLOCK);
    setTile(g, 23, 6, T.COIN);

    // レンガ列
    rowBlocks(g, 28, 32, 9, T.BRICK);
    coinsAbove(g, 28, 32, 7);
    setTile(g, 30, 9, T.POWER);

    // 空中足場
    rowBlocks(g, 36, 39, 11, T.PLAT);
    rowBlocks(g, 41, 42, 9, T.PLAT);
    coinsAbove(g, 41, 42, 7);

    // レンガの柱(登り)
    setTile(g, 46, 9, T.BRICK);
    setTile(g, 46, 8, T.BRICK);
    setTile(g, 47, 9, T.BRICK);
    setTile(g, 47, 8, T.BRICK);
    setTile(g, 48, 9, T.BRICK);
    setTile(g, 48, 8, T.BRICK);
    coinsAbove(g, 47, 48, 6);

    // 空中足場
    rowBlocks(g, 64, 66, 11, T.PLAT);
    rowBlocks(g, 70, 73, 11, T.PLAT);
    rowBlocks(g, 76, 77, 9, T.PLAT);
    coinsAbove(g, 76, 77, 7);

    // レンガ列 + パワー
    rowBlocks(g, 82, 86, 9, T.BRICK);
    setTile(g, 84, 9, T.POWER);
    coinsAbove(g, 82, 86, 7);

    // コインブロック
    rowBlocks(g, 98, 100, 9, T.COINBLOCK);
    coinsAbove(g, 98, 100, 7);

    // 空中足場
    rowBlocks(g, 104, 106, 11, T.PLAT);
    rowBlocks(g, 108, 109, 9, T.PLAT);
    coinsAbove(g, 108, 109, 7);

    // レンガの柱
    setTile(g, 114, 9, T.BRICK);
    setTile(g, 114, 8, T.BRICK);
    setTile(g, 115, 9, T.BRICK);
    setTile(g, 115, 8, T.BRICK);
    coinsAbove(g, 114, 115, 6);

    // 空中足場
    rowBlocks(g, 120, 122, 11, T.PLAT);
    rowBlocks(g, 124, 125, 9, T.PLAT);
    coinsAbove(g, 124, 125, 7);

    // レンガ列 + パワー
    rowBlocks(g, 136, 140, 9, T.BRICK);
    setTile(g, 138, 9, T.POWER);
    coinsAbove(g, 136, 140, 7);

    // 空中足場
    rowBlocks(g, 144, 147, 11, T.PLAT);
    rowBlocks(g, 150, 151, 9, T.PLAT);
    coinsAbove(g, 150, 151, 7);

    // コインブロック
    rowBlocks(g, 156, 158, 9, T.COINBLOCK);
    coinsAbove(g, 156, 158, 7);

    // 空中足場
    rowBlocks(g, 172, 175, 11, T.PLAT);
    rowBlocks(g, 178, 179, 9, T.PLAT);
    coinsAbove(g, 178, 179, 7);

    // レンガ列 + パワー
    rowBlocks(g, 184, 188, 9, T.BRICK);
    setTile(g, 186, 9, T.POWER);
    coinsAbove(g, 184, 188, 7);

    // 空中足場
    rowBlocks(g, 192, 194, 11, T.PLAT);

    // 階段(上り) - ゴール前
    stairsUp(g, 206, 6);

    // 土管
    addPipe(g, 40, 2);
    addPipe(g, 68, 3);
    addPipe(g, 102, 2);
    addPipe(g, 132, 3);
    addPipe(g, 162, 3);
    addPipe(g, 196, 2);

    // 地面コイン
    const groundCoins = [8, 14, 20, 27, 34, 44, 50, 62, 74, 80, 88, 96, 102, 110, 118, 126, 134, 142, 154, 160, 170, 176, 182, 190, 198, 204];

    // 敵(シェル多め)
    const enemies = [];
    const walkers = [6, 18, 26, 34, 44, 50, 62, 74, 80, 88, 96, 110, 118, 126, 134, 142, 154, 160, 170, 176, 182, 190, 198, 204];
    walkers.forEach((tx) => enemies.push({ type: 'walker', tx, ty: SURFACE_ROW, dir: -1 }));
    const shellers = [14, 30, 52, 76, 98, 122, 144, 164, 178, 196];
    shellers.forEach((tx) => enemies.push({ type: 'sheller', tx, ty: SURFACE_ROW, dir: -1 }));

    return finish({
      name: '3-1',
      theme: 'night',
      grid: g,
      startX: 2,
      startH: 16,
      goalX: 222,
      flagX: 222,
      timeLimit: 360,
      enemies,
      coins: groundCoins
    });
  }

  /* 全ステージ */
  const LEVELS = [buildStage1(), buildStage2(), buildStage3()];

  global.Levels = {
    list: LEVELS,
    T: T
  };
})(window);
