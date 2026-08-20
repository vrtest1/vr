(function () {
  const Input = {
    keys: new Set(),
    pressedOnce: new Set(),
    mouse: { x: 640, y: 400, down: false, downOnce: false },
    LW: 1280,
    LH: 800,
    init(canvas) {
      const self = this;
      window.addEventListener('keydown', e => {
        if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
        if (!e.repeat) self.pressedOnce.add(e.code);
        self.keys.add(e.code);
        if (e.code === 'Enter' || e.code === 'Space') self.unlock();
      });
      window.addEventListener('keyup', e => {
        self.keys.delete(e.code);
      });
      const toLocal = e => {
        const r = canvas.getBoundingClientRect();
        return [
          (e.clientX - r.left) * (self.LW / Math.max(1, r.width)),
          (e.clientY - r.top) * (self.LH / Math.max(1, r.height))
        ];
      };
      canvas.addEventListener('mousemove', e => {
        const p = toLocal(e);
        self.mouse.x = p[0];
        self.mouse.y = p[1];
      });
      canvas.addEventListener('mousedown', e => {
        if (e.button === 0) {
          self.mouse.down = true;
          self.mouse.downOnce = true;
          self.unlock();
        }
      });
      window.addEventListener('mouseup', e => {
        if (e.button === 0) self.mouse.down = false;
      });
      window.addEventListener('blur', () => {
        self.keys.clear();
        self.mouse.down = false;
        if (window.__onBlur) window.__onBlur();
      });
      canvas.addEventListener('contextmenu', e => e.preventDefault());
    },
    unlock() {
      if (window.SFX) {
        SFX.init();
        SFX.resume();
      }
    },
    pressed(code) {
      return this.pressedOnce.has(code);
    },
    anyOf(codes) {
      for (let i = 0; i < codes.length; i++) if (this.pressedOnce.has(codes[i])) return true;
      return false;
    },
    endFrame() {
      this.pressedOnce.clear();
      this.mouse.downOnce = false;
    }
  };
  window.Input = Input;
})();
