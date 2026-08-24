/* =========================================================================
 * audio.js
 * -------------------------------------------------------------------------
 * Web Audio API でオリジナル効果音を合成する。
 * 外部音声ファイルは使わない。Autoplay 制限のため、最初のユーザー入力で
 * unlock() を呼び AudioContext を開始する。
 * ========================================================================= */
(function (global) {
  'use strict';

  const AudioSys = {
    ctx: null,
    master: null,
    muted: false,
    _unlocked: false,

    /* ユーザー入力後に呼ぶ。何度呼んでも安全 */
    unlock() {
      if (this._unlocked) {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
      try {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this._unlocked = true;
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      } catch (e) {
        this.ctx = null;
      }
    },

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) {
        this.master.gain.value = this.muted ? 0 : 0.5;
      }
      return this.muted;
    },

    /* 基本トーン再生ヘルパー */
    _tone(opts) {
      if (!this.ctx || !this.master || this.muted) return;
      const o = opts || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const dur = o.dur || 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.freq || 440, t0);
      if (o.freqEnd) {
        osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + dur);
      }
      const vol = o.vol != null ? o.vol : 0.3;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    /* ノイズ(パーカッション的) */
    _noise(dur, vol, delay) {
      if (!this.ctx || !this.master || this.muted) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.2, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
    },

    /* ---- 効果音群 ---- */
    jump() {
      this._tone({ freq: 200, freqEnd: 620, dur: 0.16, type: 'square', vol: 0.22 });
    },
    coin() {
      this._tone({ freq: 988, dur: 0.07, type: 'square', vol: 0.22 });
      this._tone({ freq: 1319, dur: 0.25, type: 'square', vol: 0.22, delay: 0.07 });
    },
    stomp() {
      this._tone({ freq: 220, freqEnd: 80, dur: 0.12, type: 'triangle', vol: 0.4 });
      this._noise(0.08, 0.15);
    },
    kick() {
      this._tone({ freq: 400, freqEnd: 120, dur: 0.15, type: 'square', vol: 0.3 });
    },
    powerup() {
      const seq = [523, 659, 784, 1047, 1319];
      seq.forEach((f, i) => {
        this._tone({ freq: f, dur: 0.09, type: 'square', vol: 0.2, delay: i * 0.07 });
      });
    },
    oneUp() {
      const seq = [659, 784, 1047, 784, 1047, 1319];
      seq.forEach((f, i) => {
        this._tone({ freq: f, dur: 0.12, type: 'square', vol: 0.22, delay: i * 0.09 });
      });
    },
    damage() {
      this._tone({ freq: 600, freqEnd: 120, dur: 0.25, type: 'sawtooth', vol: 0.25 });
      this._noise(0.15, 0.12);
    },
    bump() {
      this._tone({ freq: 130, freqEnd: 90, dur: 0.09, type: 'square', vol: 0.28 });
    },
    breakBlock() {
      this._tone({ freq: 300, freqEnd: 60, dur: 0.12, type: 'square', vol: 0.3 });
      this._noise(0.2, 0.25);
    },
    blockCoin() {
      this._tone({ freq: 988, dur: 0.07, type: 'square', vol: 0.2 });
      this._tone({ freq: 1319, dur: 0.2, type: 'square', vol: 0.2, delay: 0.06 });
    },
    mushroomPop() {
      this._tone({ freq: 200, freqEnd: 500, dur: 0.15, type: 'square', vol: 0.2 });
    },
    die() {
      const seq = [659, 587, 523, 466, 392, 330, 262, 196];
      seq.forEach((f, i) => {
        this._tone({ freq: f, dur: 0.13, type: 'square', vol: 0.22, delay: i * 0.1 });
      });
    },
    goal() {
      const seq = [523, 523, 523, 659, 784];
      seq.forEach((f, i) => {
        this._tone({ freq: f, dur: 0.1, type: 'square', vol: 0.2, delay: i * 0.1 });
      });
    },
    stageClear() {
      const seq = [659, 659, 659, 784, 659, 1047, 784, 784, 784, 1047, 1319];
      seq.forEach((f, i) => {
        this._tone({ freq: f, dur: 0.12, type: 'square', vol: 0.22, delay: i * 0.11 });
      });
    },
    pause() {
      this._tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.18 });
      this._tone({ freq: 660, dur: 0.09, type: 'square', vol: 0.18, delay: 0.08 });
    },
    confirm() {
      this._tone({ freq: 660, dur: 0.08, type: 'square', vol: 0.22 });
      this._tone({ freq: 990, dur: 0.12, type: 'square', vol: 0.22, delay: 0.07 });
    },
    lifeLost() {
      this._tone({ freq: 200, freqEnd: 60, dur: 0.4, type: 'square', vol: 0.25 });
    }
  };

  global.AudioSys = AudioSys;
})(window);
