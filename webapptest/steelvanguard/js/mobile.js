(function () {
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  const Mobile = {
    active: false,
    joy: { id: -1, bx: 0, by: 0, kx: 0, ky: 0, on: false },
    aim: { id: -1, x: 640, y: 400, on: false },
    _canvas: null,

    init(canvas) {
      if (!isTouch) return;
      this.active = true;
      this._canvas = canvas;
      canvas.style.touchAction = 'none';
      canvas.addEventListener('touchstart', e => this._handle(e, 'start'), { passive: false });
      canvas.addEventListener('touchmove', e => this._handle(e, 'move'), { passive: false });
      canvas.addEventListener('touchend', e => this._handle(e, 'end'), { passive: false });
      canvas.addEventListener('touchcancel', e => this._handle(e, 'end'), { passive: false });
    },

    _toGame(touch) {
      const r = this._canvas.getBoundingClientRect();
      return [
        (touch.clientX - r.left) * (Input.LW / Math.max(1, r.width)),
        (touch.clientY - r.top) * (Input.LH / Math.max(1, r.height))
      ];
    },

    _isPlay() {
      const g = window.__game;
      return g && g.state === 'play' && !g.paused;
    },

    _handle(e, phase) {
      e.preventDefault();
      const touches = e.changedTouches;
      for (let i = 0; i < touches.length; i++) {
        const t = touches[i];
        const [x, y] = this._toGame(t);
        if (phase === 'start') this._onStart(t.identifier, x, y);
        else if (phase === 'move') this._onMove(t.identifier, x, y);
        else this._onEnd(t.identifier);
      }
    },

    _onStart(id, x, y) {
      Input.unlock();
      const play = this._isPlay();
      if (!play) {
        Input.mouse.x = x;
        Input.mouse.y = y;
        Input.mouse.down = true;
        Input.mouse.downOnce = true;
        return;
      }
      if (x < Input.LW * 0.4) {
        if (!this.joy.on) {
          this.joy.on = true;
          this.joy.id = id;
          this.joy.bx = x;
          this.joy.by = y;
          this.joy.kx = x;
          this.joy.ky = y;
        }
      } else {
        if (!this.aim.on) {
          this.aim.on = true;
          this.aim.id = id;
          this.aim.x = x;
          this.aim.y = y;
          Input.mouse.x = x;
          Input.mouse.y = y;
          Input.mouse.down = true;
          Input.mouse.downOnce = true;
        }
      }
    },

    _onMove(id, x, y) {
      if (this.joy.on && id === this.joy.id) {
        this.joy.kx = x;
        this.joy.ky = y;
        this._syncJoystick();
      }
      if (this.aim.on && id === this.aim.id) {
        this.aim.x = x;
        this.aim.y = y;
        Input.mouse.x = x;
        Input.mouse.y = y;
      }
    },

    _onEnd(id) {
      if (this.joy.on && id === this.joy.id) {
        this.joy.on = false;
        this.joy.id = -1;
        this._clearKeys();
      }
      if (this.aim.on && id === this.aim.id) {
        this.aim.on = false;
        this.aim.id = -1;
        Input.mouse.down = false;
      }
    },

    _syncJoystick() {
      const dx = this.joy.kx - this.joy.bx;
      const dy = this.joy.ky - this.joy.by;
      const R = 70;
      const d = Math.hypot(dx, dy);
      const K = Input.keys;
      K.delete('KeyW'); K.delete('KeyS'); K.delete('KeyA'); K.delete('KeyD');
      if (d > 10) {
        const m = Math.min(d, R) / R;
        const nx = (dx / d) * m;
        const ny = (dy / d) * m;
        if (ny < -0.25) K.add('KeyW');
        if (ny > 0.25) K.add('KeyS');
        if (nx < -0.25) K.add('KeyA');
        if (nx > 0.25) K.add('KeyD');
      }
    },

    _clearKeys() {
      const K = Input.keys;
      K.delete('KeyW'); K.delete('KeyS'); K.delete('KeyA'); K.delete('KeyD');
    },

    endFrame() {
      if (!this.active) return;
      if (!this._isPlay()) {
        if (this.joy.on) { this.joy.on = false; this.joy.id = -1; }
        if (this.aim.on) { this.aim.on = false; this.aim.id = -1; Input.mouse.down = false; }
        this._clearKeys();
      }
    },

    draw(ctx) {
      if (!this.active) return;
      const play = this._isPlay();
      if (!play) return;

      ctx.globalAlpha = 1;

      if (this.joy.on) {
        const R = 70;
        ctx.beginPath();
        ctx.arc(this.joy.bx, this.joy.by, R, 0, U.TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 2;
        ctx.stroke();
        const dx = this.joy.kx - this.joy.bx;
        const dy = this.joy.ky - this.joy.by;
        const d = Math.hypot(dx, dy);
        const cl = Math.min(d, R);
        const kx = d > 0 ? this.joy.bx + (dx / d) * cl : this.joy.bx;
        const ky = d > 0 ? this.joy.by + (dy / d) * cl : this.joy.by;
        ctx.beginPath();
        ctx.arc(kx, ky, 28, 0, U.TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        const hx = Input.LW * 0.18, hy = Input.LH * 0.72;
        ctx.beginPath();
        ctx.arc(hx, hy, 55, 0, U.TAU);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('MOVE', hx, hy);
      }

      if (this.aim.on) {
        ctx.beginPath();
        ctx.arc(this.aim.x, this.aim.y, 18, 0, U.TAU);
        ctx.strokeStyle = 'rgba(255,200,80,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(this.aim.x, this.aim.y, 3.5, 0, U.TAU);
        ctx.fillStyle = 'rgba(255,200,80,0.5)';
        ctx.fill();
      }

      const pbx = Input.LW - 50, pby = 38;
      ctx.beginPath();
      ctx.arc(pbx, pby, 24, 0, U.TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(pbx - 7, pby - 9, 5, 18);
      ctx.fillRect(pbx + 2, pby - 9, 5, 18);
    }
  };

  window.Mobile = Mobile;
})();
