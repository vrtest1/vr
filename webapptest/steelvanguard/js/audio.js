(function () {
  const SFX = {
    ctx: null,
    master: null,
    sfxGain: null,
    musicGain: null,
    noiseBuf: null,
    muted: false,
    musicName: null,
    music: null,
    step: 0,
    nextT: 0,
    stepDur: 0.1,
    init() {
      if (this.ctx) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.master);
      const len = (this.ctx.sampleRate * 0.6) | 0;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    },
    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
      return this.muted;
    },
    _param(v) {
      const p = { value: v };
      p.setValueAtTime = (t, time) => { p.value = t; };
      p.linearRampToValueAtTime = (t, time) => { p.value = t; };
      p.exponentialRampToValueAtTime = (t, time) => { p.value = t; };
      p.setTargetAtTime = (t, time, tc) => { p.value = t; };
      return p;
    },
    _osc(type, f0, f1, t0, dur, vol, dest) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f0;
      if (f1 !== undefined && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      const g = this.ctx.createGain();
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g);
      g.connect(dest || this.sfxGain);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    },
    _noise(t0, dur, vol, freq, q, type, dest) {
      if (!this.noiseBuf) return;
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type || 'lowpass';
      f.frequency.value = freq || 1000;
      f.Q.value = q || 1;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      s.connect(f);
      f.connect(g);
      g.connect(dest || this.sfxGain);
      s.start(t0);
      s.stop(t0 + dur + 0.05);
    },
    _now() {
      return this.ctx ? this.ctx.currentTime : 0;
    },
    fire() {
      if (!this.ctx) return;
      const t = this._now();
      this._osc('square', 660, 140, t, 0.09, 0.22);
      this._noise(t, 0.05, 0.12, 3000, 1, 'highpass');
    },
    efire() {
      if (!this.ctx) return;
      const t = this._now();
      this._osc('square', 380, 110, t, 0.12, 0.14);
    },
    hit() {
      if (!this.ctx) return;
      const t = this._now();
      this._noise(t, 0.06, 0.25, 1800, 1, 'bandpass');
    },
    metal() {
      if (!this.ctx) return;
      const t = this._now();
      this._noise(t, 0.05, 0.3, 5200, 8, 'bandpass');
      this._osc('triangle', 2200, 1400, t, 0.05, 0.12);
    },
    brick() {
      if (!this.ctx) return;
      const t = this._now();
      this._noise(t, 0.1, 0.3, 700, 1, 'lowpass');
    },
    boom(big) {
      if (!this.ctx) return;
      const t = this._now();
      const v = big ? 0.7 : 0.4;
      this._noise(t, big ? 0.5 : 0.3, v, big ? 420 : 600, 1, 'lowpass');
      this._osc('sine', big ? 110 : 150, 38, t, big ? 0.55 : 0.35, v * 0.8);
    },
    hurt() {
      if (!this.ctx) return;
      const t = this._now();
      this._osc('square', 170, 55, t, 0.22, 0.3);
      this._noise(t, 0.12, 0.2, 500, 1, 'lowpass');
    },
    pickup() {
      if (!this.ctx) return;
      const t = this._now();
      this._osc('sine', 520, 1040, t, 0.14, 0.25);
      this._osc('sine', 780, 1560, t + 0.07, 0.12, 0.18);
    },
    nuke() {
      if (!this.ctx) return;
      const t = this._now();
      this._noise(t, 0.7, 0.7, 300, 1, 'lowpass');
      this._osc('sine', 90, 30, t, 0.7, 0.6);
    },
    upgrade() {
      if (!this.ctx) return;
      const t = this._now();
      [523, 659, 784, 1046].forEach((f, i) => this._osc('square', f, f, t + i * 0.07, 0.12, 0.16));
    },
    clear() {
      if (!this.ctx) return;
      const t = this._now();
      [523, 659, 784, 1046, 1318].forEach((f, i) => this._osc('triangle', f, f, t + i * 0.09, 0.2, 0.22));
    },
    boss() {
      if (!this.ctx) return;
      const t = this._now();
      this._osc('sawtooth', 70, 28, t, 1.3, 0.5);
      this._noise(t, 1.0, 0.3, 250, 1, 'lowpass');
    },
    die() {
      if (!this.ctx) return;
      const t = this._now();
      this._osc('sawtooth', 320, 45, t, 0.7, 0.4);
      this._noise(t, 0.5, 0.3, 800, 1, 'lowpass');
    },
    click() {
      if (!this.ctx) return;
      this._osc('square', 880, 660, this._now(), 0.05, 0.15);
    },
    warn() {
      if (!this.ctx) return;
      const t = this._now();
      for (let i = 0; i < 3; i++) this._osc('square', 440, 220, t + i * 0.28, 0.22, 0.25);
    },
    _note(wave, f, t0, dur, vol) {
      if (!this.ctx) return;
      this._osc(wave, f, f, t0, dur, vol, this.musicGain);
    },
    startMusic(name) {
      if (!this.ctx || this.musicName === name) return;
      this.musicName = name;
      if (!name) { this.music = null; return; }
      if (name === 'boss') {
        this.music = {
          len: 16,
          bpm: 158,
          bassWave: 'sawtooth',
          leadWave: 'square',
          bass: [82.4, 82.4, 0, 82.4, 82.4, 0, 82.4, 104, 73.4, 73.4, 0, 73.4, 73.4, 0, 87.3, 0],
          lead: [659, 0, 0, 659, 0, 0, 784, 0, 587, 0, 0, 587, 0, 0, 659, 0]
        };
      } else if (name === 'menu') {
        this.music = {
          len: 32,
          bpm: 108,
          bassWave: 'triangle',
          leadWave: 'sine',
          bass: [55, 0, 0, 0, 55, 0, 0, 0, 65.4, 0, 0, 0, 49, 0, 0, 0, 55, 0, 0, 0, 55, 0, 0, 0, 82.4, 0, 0, 0, 98, 0, 0, 0],
          lead: [220, 0, 262, 0, 330, 0, 262, 0, 0, 0, 330, 0, 294, 0, 330, 0, 220, 0, 262, 0, 330, 0, 392, 0, 440, 0, 392, 0, 330, 0, 262, 0]
        };
      } else {
        this.music = {
          len: 32,
          bpm: 132,
          bassWave: 'square',
          leadWave: 'triangle',
          bass: [55, 0, 55, 0, 55, 0, 82.4, 0, 65.4, 0, 65.4, 0, 49, 0, 98, 0, 55, 0, 55, 0, 82.4, 0, 98, 0, 65.4, 0, 65.4, 0, 73.4, 0, 98, 0],
          lead: [329, 0, 440, 0, 523, 0, 440, 392, 329, 0, 440, 0, 494, 0, 440, 392, 329, 0, 440, 0, 523, 0, 587, 0, 494, 0, 440, 0, 392, 0, 440, 0]
        };
      }
      this.stepDur = 60 / this.music.bpm / 4;
      this.step = 0;
      this.nextT = this.ctx.currentTime + 0.1;
    },
    stopMusic() {
      this.musicName = null;
      this.music = null;
    },
    update() {
      if (!this.ctx || !this.music || this.muted) return;
      const ct = this.ctx.currentTime;
      let guard = 0;
      while (this.nextT < ct + 0.18 && guard < 64) {
        const i = this.step % this.music.len;
        const bd = this.music.bass[i];
        const ld = this.music.lead[i];
        if (bd) this._note(this.music.bassWave, bd, this.nextT, this.stepDur * 0.85, 0.32);
        if (ld) this._note(this.music.leadWave, ld, this.nextT, this.stepDur * 0.9, 0.13);
        this.nextT += this.stepDur;
        this.step++;
        guard++;
      }
    }
  };
  window.SFX = SFX;
})();
