// 一人称操作: マウス+WASD / ゲームパッド / タッチ仮想スティック
export class Controls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    // 初期視点: カメラ位置(0,14,52)から水槽の奥(-Z方向)を見る
    this.yaw = 0;
    this.pitch = -0.04;
    this.baseSpeed = 9;
    this.boost = false;
    this.locked = false;
    this.enabled = false;
    this.descOpen = true;    // 説明文オーバーレイの開閉（Esc でトグル）
    this._lastUnlock = 0;    // Esc 解除直後の誤トグル防止
    this.isTouch = (typeof window.ontouchstart === 'object') || navigator.maxTouchPoints > 0;
    if (this.isTouch) document.body.classList.add('touch');

    this.keys = {};
    this.touchMove = { x: 0, y: 0 };
    this.touchUp = 0;
    this.touchBoost = false;
    this.gpMove = { x: 0, y: 0 };
    this.gpLook = { x: 0, y: 0 };
    this.gpBoost = false;

    this._setupKeyboard();
    this._setupMouse();
    this._antiZoom();
    if (this.isTouch) this._setupTouch();
    this.hud = document.getElementById('hud');
    this.syncUI();
  }

  _antiZoom() {
    // ダブルタップでのページ拡大を抑止（touch-action と併用）
    addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    if (!this.isTouch) return;
    let lastT = 0, lastX = 0, lastY = 0;
    addEventListener('touchend', (e) => {
      const t = Date.now();
      const ct = e.changedTouches[0];
      const dx = ct.clientX - lastX, dy = ct.clientY - lastY;
      if (t - lastT < 350 && dx * dx + dy * dy < 900) {
        e.preventDefault(); // iOS Safari のダブルタップズーム対策
        lastT = 0;
      } else {
        lastT = t; lastX = ct.clientX; lastY = ct.clientY;
      }
    }, { passive: false });
  }

  _setupKeyboard() {
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }

  _setupMouse() {
    this.overlay = document.getElementById('overlay');
    this.crosshair = document.getElementById('crosshair');
    this.goText = document.getElementById('goText');

    this.overlay.addEventListener('click', () => {
      if (this.isTouch) { this.start(); return; }
      this.dom.requestPointerLock?.();
    });
    // 鑑賞モード（説明オフ・未ロック）でシーンをクリックするとロックを再開
    this.dom.addEventListener('click', () => {
      if (this.isTouch || this.locked || this.descOpen) return;
      this.dom.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.dom;
      if (wasLocked && !this.locked) this._lastUnlock = Date.now();
      if (this.locked) this.enabled = true;
      this.syncUI();
    });
    // Esc: 未ロック時に説明文オーバーレイを開閉。2回目の Esc で UI オフの鑑賞状態へ
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || this.locked) return;
      if (Date.now() - this._lastUnlock < 400) return; // Esc 解除の余韻ではトグルしない
      this.descOpen = !this.descOpen;
      this.syncUI();
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw   -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });
    if (this.isTouch && this.goText) this.goText.textContent = '— タップして水槽に入る —';
  }

  // 説明文オーバーレイ・十字線・HUD の表示をロック状態と descOpen から同期
  syncUI() {
    const showDesc = this.descOpen && !this.locked;
    this.overlay.classList.toggle('hidden', !showDesc);
    this.crosshair.style.display = this.locked ? 'block' : 'none';
    if (this.hud) this.hud.style.display = this.locked ? '' : 'none';
  }

  start() {
    this.enabled = true;
    this.descOpen = false;
    this.syncUI();
  }

  _stick(el, out) {
    const knob = el.querySelector('.knob');
    const set = (dx, dy) => {
      const R = Math.max(18, (el.clientWidth - knob.clientWidth) / 2);
      const len = Math.hypot(dx, dy) || 1;
      const f = Math.min(1, len / R);
      out.x = (dx / len) * f;
      out.y = (dy / len) * f;
      knob.style.transform = `translate(${out.x * R}px, ${out.y * R}px)`;
    };
    const zero = () => { out.x = 0; out.y = 0; knob.style.transform = ''; };
    let id = null, cx = 0, cy = 0;
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e.clientX - cx, e.clientY - cy);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      set(e.clientX - cx, e.clientY - cy);
    });
    const end = (e) => { if (e.pointerId === id) { id = null; zero(); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _setupTouchLook() {
    // 画面（移動スティック／ボタン以外の canvas 領域）をドラッグして視点回転。
    // 回転量が指の移動量に比例するため、速度型スティックのような「速すぎ」が起きにくい。
    const SENS = 0.0038; // rad/px（端末横スクロール全幅で約90°）
    let id = null, lx = 0, ly = 0;
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.enabled || id !== null) return;
      id = e.pointerId; lx = e.clientX; ly = e.clientY;
      try { el.setPointerCapture?.(id); } catch (_) { /* 指がスティック上を通過しても視点を維持 */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      this.yaw   -= dx * SENS;
      this.pitch -= dy * SENS;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });
    const end = (e) => { if (e.pointerId === id) id = null; }; // capture は up で自動解除
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _setupTouch() {
    this._stick(document.getElementById('stickMove'), this.touchMove);
    this._setupTouchLook();
    const bindBtn = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => { on(); el.classList.add('active'); e.preventDefault(); });
      const o = () => { off(); el.classList.remove('active'); };
      el.addEventListener('pointerup', o);
      el.addEventListener('pointercancel', o);
      el.addEventListener('pointerleave', o);
    };
    bindBtn(document.getElementById('btnBoost'), () => this.touchBoost = true, () => this.touchBoost = false);
    bindBtn(document.getElementById('btnUp'), () => this.touchUp = 1, () => this.touchUp = 0);
    bindBtn(document.getElementById('btnDown'), () => this.touchUp = -1, () => this.touchUp = 0);

    // 縦持ちヒント（自動フェード・再表示）と viewport 追従
    const hint = document.getElementById('orientHint');
    let fadeT = 0;
    const orientUpdate = () => {
      if (matchMedia('(orientation: portrait)').matches && hint) {
        hint.style.opacity = '1';
        clearTimeout(fadeT);
        fadeT = setTimeout(() => { hint.style.opacity = '0'; }, 4200);
      }
    };
    addEventListener('orientationchange', orientUpdate);
    addEventListener('resize', orientUpdate);
    orientUpdate();
    window.visualViewport?.addEventListener('resize', () => {
      dispatchEvent(new Event('resize'));
    });
  }

  _pollGamepad() {
    this.gpMove.x = this.gpMove.y = this.gpLook.x = this.gpLook.y = 0;
    this.gpBoost = false;
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v) => Math.abs(v) < 0.14 ? 0 : v;
      this.gpMove.x += dz(gp.axes[0] || 0);
      this.gpMove.y += dz(gp.axes[1] || 0);
      this.gpLook.x += dz(gp.axes[2] || 0);
      this.gpLook.y += dz(gp.axes[3] || 0);
      const btns = gp.buttons;
      if (btns[7]?.pressed || btns[5]?.pressed || btns[10]?.pressed) this.gpBoost = true;
      // L3 で反転補正（つまずいたら視点停止程度）
      break;
    }
  }

  update(dt) {
    if (!this.enabled) return;
    this._pollGamepad();

    // 視点
    this.yaw   -= this.gpLook.x * 2.2 * dt;
    this.pitch += this.gpLook.y * 1.6 * dt;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // 移動
    let mx = 0, mz = 0, my = 0;
    const k = this.keys;
    if (k['KeyW'] || k['ArrowUp']) mz += 1;
    if (k['KeyS'] || k['ArrowDown']) mz -= 1;
    if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
    if (k['KeyD'] || k['ArrowRight']) mx += 1;
    if (k['Space'] || k['KeyE']) my += 1;
    if (k['KeyC'] || k['ControlLeft'] || k['KeyQ']) my -= 1;

    // キーボード + ゲームパッド + タッチ合成
    mz += -this.gpMove.y;
    mx += this.gpMove.x;
    if (this.isTouch) {
      mz -= this.touchMove.y; // スティック下向き正 → 後進
      mx += this.touchMove.x;
    }
    my += this.touchUp;

    this.boost = !!(k['ShiftLeft'] || k['ShiftRight']) || this.gpBoost || this.touchBoost;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const speed = this.baseSpeed * (this.boost ? 3.4 : 1);
    const yaw = this.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const p = this.camera.position;
    p.x += (fx * mz + rx * mx) * speed * dt;
    p.z += (fz * mz + rz * mx) * speed * dt;
    p.y += my * speed * 0.75 * dt;

    // 水槽内に制限
    p.x = Math.max(-122, Math.min(122, p.x));
    p.z = Math.max(-57, Math.min(57, p.z));
    p.y = Math.max(1.0, Math.min(48.4, p.y));
  }
}
