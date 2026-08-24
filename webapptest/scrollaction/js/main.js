/* =========================================================================
 * main.js
 * -------------------------------------------------------------------------
 * 起動処理・メインループ・Canvas リサイズ・入力初期化。
 * - 論理解像度 480x288 を固定し、Canvas CSS サイズをアスペクト比維持で調整
 * - 固定タイムステップ + 累積フレームでフレームレート非依存
 * - タッチ端末ではバーチャルパッドを表示
 * - 縦画面では案内を表示
 * ========================================================================= */
(function (global) {
  'use strict';

  const E = global.Engine;
  const VIEW_W = E.VIEW_W;
  const VIEW_H = E.VIEW_H;

  const canvas = document.getElementById('game');
  const touchLayer = document.getElementById('touch-layer');
  const rotateHint = document.getElementById('rotate-hint');

  global.Renderer.init(canvas);
  global.Input.init();

  const game = new E.Game();
  game.state = E.STATE.TITLE;

  /* ---------- Canvas サイズ調整(アスペクト比維持・Safe Area考慮) ---------- */
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 論理解像度に合わせた表示サイズ
    const scale = Math.min(vw / VIEW_W, vh / VIEW_H);
    const cw = Math.floor(VIEW_W * scale);
    const ch = Math.floor(VIEW_H * scale);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';

    // 縦画面かどうか
    const isPortrait = vh > vw;
    if (isPortrait) {
      rotateHint.classList.remove('hidden');
    } else {
      rotateHint.classList.add('hidden');
    }
  }

  global.addEventListener('resize', resize);
  global.addEventListener('orientationchange', () => setTimeout(resize, 100));
  resize();

  /* ---------- タッチパッド表示 ---------- */
  if (global.Input.touchCapable) {
    touchLayer.classList.remove('hidden');
    // タッチ非対応と誤判定された場合のフォールバック: 初回タッチで表示
    let shown = false;
    global.addEventListener('touchstart', () => {
      if (!shown) {
        touchLayer.classList.remove('hidden');
        shown = true;
      }
    }, { passive: true, once: false });
  }

  /* ---------- AudioContext 起動(最初のユーザー入力) ---------- */
  function unlockAudio() {
    global.AudioSys.unlock();
  }
  global.addEventListener('pointerdown', unlockAudio, { passive: true });
  global.addEventListener('keydown', unlockAudio, { passive: true });

  /* ---------- メインループ(固定タイムステップ) ---------- */
  let last = performance.now();
  let acc = 0;
  const STEP = E.STEP;

  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    // 極端なフレーム落ち対策(最大 0.25s)
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    // スパイラル・オブ・デス防止(最大5ステップ)
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      game.update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 5) acc = 0;

    // 描画
    global.Renderer.render(game);

    // フレーム末尾で入力エッジをクリア
    global.Input.endFrame();
  }

  requestAnimationFrame(loop);

  /* ---------- フォーカス喪失でポーズ ---------- */
  global.addEventListener('blur', () => {
    if (game.state === E.STATE.PLAYING) {
      game.setState(E.STATE.PAUSED);
    }
  });
})(window);
