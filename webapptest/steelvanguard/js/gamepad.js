(function () {
  const DEADZONE = 0.15;
  const Gamepad = {
    active: false,
    idx: -1,
    axes: [0, 0],
    buttons: [],
    _prev: [],
    _pressed: new Set(),

    update() {
      if (!navigator.getGamepads) return;
      const pads = navigator.getGamepads();
      let pad = null, idx = -1;
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) { pad = pads[i]; idx = i; break; }
      }
      this.active = !!pad;
      this.idx = idx;
      if (!pad) {
        this.axes = [0, 0];
        this.buttons = [];
        this._prev = [];
        return;
      }
      let ax = pad.axes[0] || 0;
      let ay = pad.axes[1] || 0;
      const d = Math.hypot(ax, ay);
      if (d < DEADZONE) { ax = 0; ay = 0; }
      else if (d > 1) { const s = 1 / d; ax *= s; ay *= s; }
      else {
        const t = (d - DEADZONE) / (1 - DEADZONE);
        ax = (ax / d) * t;
        ay = (ay / d) * t;
      }
      this.axes = [ax, ay];
      const btns = [];
      const prev = this._prev;
      this._pressed.clear();
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i].pressed;
        btns.push(b);
        if (b && !prev[i]) this._pressed.add(i);
      }
      this.buttons = btns;
      this._prev = btns;
    },

    pressed(i) {
      return this._pressed.has(i);
    },

    down(i) {
      return this.buttons[i] === true;
    },

    endFrame() {
      this._pressed.clear();
    }
  };
  window.Gamepad = Gamepad;
})();
