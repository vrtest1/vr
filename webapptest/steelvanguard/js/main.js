(function () {
  const canvas = document.getElementById('game');
  const Q = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 1280 * Q;
  canvas.height = 800 * Q;
  const ctx = canvas.getContext('2d');
  const game = new Game(canvas);
  window.__game = game;
  Mobile.init(canvas);
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    game.update(dt);
    ctx.setTransform(Q, 0, 0, Q, 0, 0);
    game.draw(ctx);
    Mobile.draw(ctx);
    Mobile.endFrame();
    Input.endFrame();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
