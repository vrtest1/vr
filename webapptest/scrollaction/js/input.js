/* =========================================================================
 * input.js
 * -------------------------------------------------------------------------
 * キーボード / Gamepad API / タッチバーチャルパッド を
 * 共通の論理入力 (left, right, jump, dash, pause, confirm) に統合する。
 *
 * - isDown(action)      : 押下中か
 * - wasPressed(action)  : 今回のフレームで押されたか(エッジ)
 * - wasReleased(action) : 今回のフレームで離されたか(エッジ)
 * - endFrame()          : 毎フレーム末尾に呼び、エッジをクリアする
 *
 * ゲームロジックからは具体的な入力デバイスを直接参照しない。
 * ========================================================================= */
(function (global) {
  'use strict';

  const ACTIONS = ['left', 'right', 'jump', 'dash', 'pause', 'confirm'];

  function createState() {
    const held = {};
    const pressed = {};
    const released = {};
    ACTIONS.forEach((a) => {
      held[a] = false;
      pressed[a] = false;
      released[a] = false;
    });
    return { held, pressed, released };
  }

  const Input = {
    actions: ACTIONS,
    // タッチパッド表示の要否
    touchCapable: false,
    // ポーズはゲーム側がエッジを消費する。押しっぱなしで連続しないよう、
    // ポーズはエッジのみ使う（held は使わない）。

    _keyState: createState(),
    _padState: createState(),
    _touchState: createState(),

    // キーボード → 論理アクション 割り当て
    _keyMap: {
      'ArrowLeft': 'left',
      'KeyA': 'left',
      'ArrowRight': 'right',
      'KeyD': 'right',
      'KeyZ': 'jump',
      'Space': 'jump',
      'KeyX': 'dash',
      'ShiftLeft': 'dash',
      'ShiftRight': 'dash',
      'Enter': 'confirm',
      'NumpadEnter': 'confirm',
      'KeyP': 'pause',
      'Escape': 'pause'
    },

    _lastPadButtons: null,
    _padIndex: -1,
    _padConnected: false,

    _touchActivePointers: new Set(),

    init() {
      // タッチ可能判定（User-Agent に依存しない）
      this.touchCapable =
        ('ontouchstart' in global) ||
        (global.navigator && global.navigator.maxTouchPoints > 0);

      this._bindKeyboard();
      this._bindTouch();
      // Gamepad は update() 内でポーリングする
    },

    /* ---------- キーボード ---------- */
    _bindKeyboard() {
      const down = (e) => {
        const a = this._keyMap[e.code];
        if (!a) return;
        if (!e.repeat) {
          this._keyState.pressed[a] = true;
          this._keyState.held[a] = true;
        }
        // ゲーム中にブラウザ操作が走らないようにする
        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
          e.preventDefault();
        }
      };
      const up = (e) => {
        const a = this._keyMap[e.code];
        if (!a) return;
        if (this._keyState.held[a]) {
          this._keyState.released[a] = true;
          this._keyState.held[a] = false;
        }
      };
      global.addEventListener('keydown', down, { passive: false });
      global.addEventListener('keyup', up, { passive: false });
      global.addEventListener('blur', () => {
        // ウィンドウがフォーカスを失ったら全キーを離す
        ACTIONS.forEach((a) => {
          if (this._keyState.held[a]) {
            this._keyState.released[a] = true;
            this._keyState.held[a] = false;
          }
        });
      });
    },

    /* ---------- ゲームパッド ---------- */
    _updateGamepad() {
      let pads = [];
      try {
        pads = (global.navigator && global.navigator.getGamepads)
          ? global.navigator.getGamepads()
          : [];
      } catch (e) {
        pads = [];
      }

      // 接続中のパッドを探す（0 番目でなくても）
      let pad = null;
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
      }
      this._padConnected = !!pad;

      const cur = createState();
      if (pad) {
        const buttons = pad.buttons || [];
        const getB = (i) => (buttons[i] ? buttons[i].pressed : false);
        const axes = pad.axes || [];

        const axisX = (typeof axes[0] === 'number') ? axes[0] : 0;
        const axisY = (typeof axes[1] === 'number') ? axes[1] : 0;
        const dead = 0.45;

        // 移動: 左スティック / D-pad
        let left = axisX < -dead;
        let right = axisX > dead;
        if (getB(14)) left = true;   // D-pad left
        if (getB(15)) right = true;  // D-pad right

        // ダッシュ: Button 0
        const dash = getB(0);

        // ジャンプ: Button 1 or Button 2。ジャンプはアナログ感を出すため軸も使える
        let jump = getB(1) || getB(2);
        if (axisY < -0.6) jump = true; // 左スティック上

        // ポーズ: Start (Button 9) / Select(8) は使わない
        const pause = getB(9);
        // 決定: A(0) または Start
        const confirm = getB(0) || getB(9);

        cur.held = {
          left: left, right: right, jump: jump, dash: dash,
          pause: pause, confirm: confirm
        };
      }

      // 前回との差分でエッジを算出
      const prev = this._padState.held;
      ACTIONS.forEach((a) => {
        cur.pressed[a] = cur.held[a] && !prev[a];
        cur.released[a] = !cur.held[a] && prev[a];
      });
      this._padState = cur;
    },

    /* ---------- タッチバーチャルパッド ---------- */
    _bindTouch() {
      const layer = global.document.getElementById('touch-layer');
      if (!layer) return;

      const self = this;
      const btns = layer.querySelectorAll('.vpad');

      btns.forEach((btn) => {
        const action = btn.getAttribute('data-action');
        if (!action) return;

        const press = (e) => {
          e.preventDefault();
          // pointer capture により、指がボタンから滑り出しても pointerup を受け取れる
          try { btn.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
          this._touchActivePointers.add(e.pointerId);
          this._touchState.pressed[action] = true;
          this._touchState.held[action] = true;
          btn.classList.add('pressed');
        };

        const release = (e) => {
          e.preventDefault();
          if (this._touchActivePointers.has(e.pointerId)) {
            this._touchActivePointers.delete(e.pointerId);
            this._touchState.released[action] = true;
            this._touchState.held[action] = false;
            btn.classList.remove('pressed');
          }
        };

        btn.addEventListener('pointerdown', press, { passive: false });
        btn.addEventListener('pointerup', release, { passive: false });
        btn.addEventListener('pointercancel', release, { passive: false });
        btn.addEventListener('pointerleave', (e) => {
          // pointer capture している場合は leave でも押下を維持して良い。
          // ただし capture に失敗した場合に備え、押下を維持する。
        });
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
      });

      // 全ポインタが消えたら安全のためタッチ入力も全解除
      const clearAll = () => {
        if (this._touchActivePointers.size === 0) {
          ACTIONS.forEach((a) => {
            if (this._touchState.held[a]) {
              this._touchState.released[a] = true;
              this._touchState.held[a] = false;
            }
          });
        }
      };
      global.addEventListener('pointerup', clearAll, { passive: true });
      global.addEventListener('pointercancel', clearAll, { passive: true });
      global.addEventListener('blur', clearAll, { passive: true });
    },

    /* ---------- 統合アクセサ ---------- */
    isDown(action) {
      return this._keyState.held[action] ||
             this._padState.held[action] ||
             this._touchState.held[action];
    },

    wasPressed(action) {
      return this._keyState.pressed[action] ||
             this._padState.pressed[action] ||
             this._touchState.pressed[action];
    },

    wasReleased(action) {
      return this._keyState.released[action] ||
             this._padState.released[action] ||
             this._touchState.released[action];
    },

    /* 特定の論理入力のエッジを消費(クリア)する。ポーズなど連続発火防止用 */
    consume(action) {
      this._keyState.pressed[action] = false;
      this._keyState.released[action] = false;
      this._padState.pressed[action] = false;
      this._padState.released[action] = false;
      this._touchState.pressed[action] = false;
      this._touchState.released[action] = false;
    },

    /* 毎フレーム末尾に呼ぶ */
    endFrame() {
      this._keyState.pressed = {};
      this._keyState.released = {};
      ACTIONS.forEach((a) => {
        this._keyState.pressed[a] = false;
        this._keyState.released[a] = false;
        this._padState.pressed[a] = false;
        this._padState.released[a] = false;
        this._touchState.pressed[a] = false;
        this._touchState.released[a] = false;
      });
      // ゲームパッドは毎フレームここでポーリング
      this._updateGamepad();
    }
  };

  global.Input = Input;
})(window);
