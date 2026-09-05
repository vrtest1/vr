import * as THREE from 'three';

// ============ 基本セットアップ ============
const container = document.getElementById('game-container');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e1a);
scene.fog = new THREE.Fog(0x0a0e1a, 18, 45);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.2, 9);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x332211, 0.9);
scene.add(hemi);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(5, 10, 6);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -10; dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10; dirLight.shadow.camera.bottom = -10;
scene.add(dirLight);
const rim = new THREE.DirectionalLight(0x4488ff, 0.6);
rim.position.set(-6, 4, -6);
scene.add(rim);

// ============ ステージ（VF風・八角リング） ============
const RING_R = 5.5;
{
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x11162a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.31;
  ground.receiveShadow = true;
  scene.add(ground);

  const ringBase = new THREE.Mesh(
    new THREE.CylinderGeometry(RING_R + 0.6, RING_R + 0.8, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x1c2440, roughness: 0.9 })
  );
  ringBase.position.y = -0.15;
  ringBase.receiveShadow = true;
  scene.add(ringBase);

  const ringTop = new THREE.Mesh(
    new THREE.CylinderGeometry(RING_R, RING_R, 0.32, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.85 })
  );
  ringTop.position.y = -0.14;
  ringTop.receiveShadow = true;
  scene.add(ringTop);

  // 中央サークル
  const circle = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.45, 48),
    new THREE.MeshBasicMaterial({ color: 0xc00000, side: THREE.DoubleSide })
  );
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.025;
  scene.add(circle);

  // 縁ライン
  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(RING_R - 0.05, 0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xe60012, roughness: 0.5 })
  );
  edge.rotation.x = Math.PI / 2;
  edge.rotation.z = Math.PI / 8;
  edge.position.y = 0.05;
  scene.add(edge);

  // 四隅ポール + ライト
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * (RING_R + 1.2);
    const z = Math.sin(a) * (RING_R + 1.2);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x333a55 })
    );
    pole.position.set(x, 1.4, z);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff2aa })
    );
    lamp.position.set(x, 3.1, z);
    scene.add(lamp);
    const pl = new THREE.PointLight(0xffe9a0, 12, 12);
    pl.position.set(x, 3.0, z);
    scene.add(pl);
  }

  // 背景の鳥居風ゲート（雰囲気用）
  const gateMat = new THREE.MeshStandardMaterial({ color: 0xa3121f, roughness: 0.7 });
  const pillarG = new THREE.CylinderGeometry(0.25, 0.3, 7, 10);
  [-6, 6].forEach(x => {
    const p = new THREE.Mesh(pillarG, gateMat);
    p.position.set(x, 3.2, -14);
    scene.add(p);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.8, 0.8), gateMat);
  beam.position.set(0, 6.6, -14);
  scene.add(beam);
}

// ============ サウンド（簡易シンセ） ============
let audioCtx = null;
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur = 0.1, type = 'square', vol = 0.15) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur);
}
function noiseHit(vol = 0.3, dur = 0.15) {
  if (!audioCtx) return;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  g.gain.value = vol;
  const f = audioCtx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1200;
  src.connect(f); f.connect(g); g.connect(audioCtx.destination);
  src.start();
}
const sfx = {
  punch: () => { noiseHit(0.35, 0.12); beep(160, 0.08, 'square', 0.12); },
  kick: () => { noiseHit(0.45, 0.18); beep(110, 0.12, 'square', 0.15); },
  block: () => beep(700, 0.06, 'square', 0.08),
  whiff: () => beep(300, 0.05, 'sine', 0.04),
  bell: () => { beep(880, 0.5, 'sine', 0.2); setTimeout(() => beep(880, 0.5, 'sine', 0.2), 250); },
  down: () => beep(80, 0.4, 'sawtooth', 0.18),
};

// ============ BGM（WebAudio自動演奏・外部ファイル不要） ============
let musicGain = null;
let musicOn = true;
let musicMode = null; // 'fight' | 'win' | null
let seqTimer = null;
let seqStep = 0;
let nextNoteTime = 0;
const midi2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
// 対戦BGM：Emで駆け抜ける16分32ステップ
const FIGHT_BASS = [40,40,52,40, 40,52,40,43, 45,45,57,45, 45,57,45,47, 40,40,52,40, 40,52,40,43, 47,47,48,50, 52,50,48,47];
const FIGHT_LEAD = [64,0,67,0, 69,0,71,69, 72,0,71,69, 67,69,0,0, 64,0,67,0, 69,0,71,0, 72,0,74,72, 71,69,67,0];
const FIGHT_BPM = 152;
// 勝利BGM：明るいファンファーレ16ステップループ
const WIN_LEAD = [72,76,79,84, 0,79,84,0, 86,84,79,76, 79,0,72,0];
const WIN_BASS = [48,0,55,0, 53,0,55,0, 53,0,55,0, 48,0,43,0];
const WIN_BPM = 120;

function ensureMusicGain() {
  if (!audioCtx || musicGain) return;
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.5;
  musicGain.connect(audioCtx.destination);
}
function mNote(freq, t, dur, type = 'square', vol = 0.08) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(musicGain);
  o.start(t); o.stop(t + dur + 0.02);
}
function mKick(t) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g); g.connect(musicGain);
  o.start(t); o.stop(t + 0.16);
}
function mSnare(t) {
  const len = 0.12;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = audioCtx.createBufferSource(); s.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
  const g = audioCtx.createGain(); g.gain.value = 0.25;
  s.connect(f); f.connect(g); g.connect(musicGain);
  s.start(t);
}
function mHat(t) {
  const len = 0.04;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = audioCtx.createBufferSource(); s.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = audioCtx.createGain(); g.gain.value = 0.12;
  s.connect(f); f.connect(g); g.connect(musicGain);
  s.start(t);
}
function scheduleStep(step, t) {
  if (musicMode === 'fight') {
    const s16 = step % 32;
    const b = FIGHT_BASS[s16];
    const l = FIGHT_LEAD[s16];
    if (b) mNote(midi2f(b), t, 0.16, 'sawtooth', 0.07);
    if (l) mNote(midi2f(l), t, 0.18, 'square', 0.06);
    if (s16 % 4 === 0) mKick(t);
    if (s16 % 16 === 4 || s16 % 16 === 12) mSnare(t);
    if (s16 % 2 === 0) mHat(t);
  } else if (musicMode === 'win') {
    const s16 = step % 16;
    const l = WIN_LEAD[s16];
    const b = WIN_BASS[s16];
    if (l) mNote(midi2f(l), t, 0.3, 'square', 0.09);
    if (b) mNote(midi2f(b - 12), t, 0.35, 'triangle', 0.12);
    if (s16 % 4 === 0) mKick(t);
    if (s16 % 2 === 0) mHat(t);
  }
}
function seqTick() {
  if (!audioCtx || !musicMode || !musicOn) return;
  const bpm = musicMode === 'fight' ? FIGHT_BPM : WIN_BPM;
  const spb = 60 / bpm / 4; // 16分
  while (nextNoteTime < audioCtx.currentTime + 0.15) {
    scheduleStep(seqStep, nextNoteTime);
    nextNoteTime += spb;
    seqStep++;
  }
}
function startBGM(mode) {
  if (!audioCtx) { musicMode = mode; return; }
  ensureMusicGain();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (!musicOn) { musicMode = mode; return; }
  if (musicMode === mode && seqTimer) return;
  stopMusicAll();
  musicMode = mode;
  seqStep = 0;
  nextNoteTime = audioCtx.currentTime + 0.06;
  seqTimer = setInterval(seqTick, 27);
}
function stopBGM() { stopMusicAll(); }
function stopMusicAll() { if (seqTimer) { clearInterval(seqTimer); seqTimer = null; } musicMode = null; }
function toggleMusic() {
  musicOn = !musicOn;
  if (!musicOn) stopMusicAll();
  else {
    // 場面に応じて復帰
    if (game.phase === 'fight') startBGM('fight');
    else if (game.phase === 'roundEnd' || game.phase === 'matchEnd') startBGM('win');
  }
  const el = document.getElementById('music-btn');
  if (el) el.textContent = musicOn ? '🔊 BGM ON' : '🔇 BGM OFF';
  return musicOn;
}

// ============ ファイター ============
// height: high/mid/low（演出・ガード削り用）、lunge: 踏み込み距離、launch: 打ち上げ、knockdown: 転倒
const ATTACKS = {
  jab:      { startup: 0.10, active: 0.10, recovery: 0.22, range: 2.0, damage: 6,  stun: 0.32, push: 2.5, lunge: 1.2, chip: 0.15, height: 'high', anim: 'jab' },
  straight: { startup: 0.16, active: 0.12, recovery: 0.30, range: 2.4, damage: 9,  stun: 0.45, push: 3.5, lunge: 3.2, chip: 0.15, height: 'mid',  anim: 'straight' },
  upper:    { startup: 0.24, active: 0.12, recovery: 0.45, range: 1.8, damage: 14, stun: 0.70, push: 2.0, lunge: 1.0, chip: 0.2,  height: 'mid',  anim: 'upper', launch: 4.6 },
  body:     { startup: 0.18, active: 0.12, recovery: 0.35, range: 1.9, damage: 10, stun: 0.55, push: 3.0, lunge: 1.5, chip: 0.5,  height: 'mid',  anim: 'body', blockStun: 0.5 },
  middle:   { startup: 0.22, active: 0.15, recovery: 0.38, range: 2.5, damage: 12, stun: 0.60, push: 5.0, lunge: 1.0, chip: 0.15, height: 'mid',  anim: 'middle' },
  low:      { startup: 0.15, active: 0.12, recovery: 0.32, range: 2.2, damage: 8,  stun: 0.50, push: 2.5, lunge: 1.2, chip: 0.45, height: 'low',  anim: 'low' },
  high:     { startup: 0.32, active: 0.15, recovery: 0.50, range: 2.6, damage: 16, stun: 0.80, push: 6.0, lunge: 1.0, chip: 0.2,  height: 'high', anim: 'high' },
  sweep:    { startup: 0.26, active: 0.14, recovery: 0.48, range: 2.1, damage: 11, stun: 0.70, push: 3.0, lunge: 1.0, chip: 0.3,  height: 'low',  anim: 'sweep', knockdown: true },
  jumpkick: { startup: 0.08, active: 0.20, recovery: 0.20, range: 2.2, damage: 10, stun: 0.45, push: 4.0, lunge: 0.0, chip: 0.15, height: 'mid',  anim: 'jumpkick' },
  jumppunch:{ startup: 0.06, active: 0.18, recovery: 0.18, range: 2.0, damage: 7,  stun: 0.35, push: 2.5, lunge: 0.0, chip: 0.15, height: 'high', anim: 'jumppunch' },
  // 必殺技
  shoryu:  { startup: 0.14, active: 0.22, recovery: 0.50, range: 2.0, damage: 18, stun: 0.80, push: 5.0, lunge: 1.6, chip: 0.10, height: 'mid', anim: 'shoryu', invuln: 0.30, riseV: 6.0 },
  tatsu:   { startup: 0.16, active: 0.44, recovery: 0.40, range: 2.3, damage: 5,  stun: 0.28, stunLast: 0.60, push: 2.0, pushLast: 5.0, lunge: 4.2, chip: 0.15, height: 'mid', anim: 'tatsu', hits: 3, hitInterval: 0.14 },
  tesshan: { startup: 0.24, active: 0.14, recovery: 0.50, range: 1.9, damage: 16, stun: 0.75, push: 7.0, lunge: 4.0, chip: 0.60, height: 'mid', anim: 'tesshan', blockStun: 0.80 },
};
// モーション高速化：発生・持続・硬直を短縮（踏み込みは維持のため加速、硬直は微短縮）
const QUICK = 0.78;
for (const k in ATTACKS) {
  const a = ATTACKS[k];
  a.startup *= QUICK; a.active *= QUICK; a.recovery *= QUICK;
  a.stun *= 0.9;
  if (a.stunLast) a.stunLast *= 0.9;
  if (a.lunge) a.lunge *= 1.25;
}
function isAttackState(s) { return !!ATTACKS[s]; }

function makeMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 });
}

class Fighter {
  constructor(opts) {
    this.isPlayer = opts.isPlayer;
    this.color = opts.color;
    this.maxHp = 100;
    this.hp = 100;
    this.wins = 0;
    this.state = 'idle';
    this.stateTime = 0;
    this.attackType = null;
    this.attackT = 0;
    this.hasHit = false;
    this.stun = 0;
    this.vy = 0;
    this.y = 0;
    this.invulnT = 0;
    this.hitCount = 0;
    this.grounded = true;
    this.cooldown = 0;

    this.root = new THREE.Group();
    this.root.position.set(opts.x, 0, opts.z || 0);
    scene.add(this.root);
    this.build(opts);
  }

  build(opts) {
    const cBody = makeMat(opts.color);
    const cSkin = makeMat(0xe8b88a);
    const cPants = makeMat(opts.pants);
    const cBand = makeMat(0xffffff);

    // 胴
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.32), cBody);
    this.torso.position.y = 1.28;
    this.torso.castShadow = true;
    this.root.add(this.torso);

    // 頭
    this.headG = new THREE.Group();
    this.headG.position.y = 1.78;
    this.root.add(this.headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 16), cSkin);
    head.position.y = 0.1;
    head.castShadow = true;
    this.headG.add(head);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.4), this.isPlayer ? makeMat(0xe60012) : makeMat(0x0033aa));
    band.position.y = 0.16;
    this.headG.add(band);

    // 腕
    const mkArm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(0.33 * side, 1.52, 0);
      this.root.add(sh);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.14), cSkin);
      upper.position.y = -0.16;
      upper.castShadow = true;
      sh.add(upper);
      const el = new THREE.Group();
      el.position.y = -0.33;
      sh.add(el);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), cSkin);
      fore.position.y = -0.14;
      fore.castShadow = true;
      el.add(fore);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), cBand);
      fist.position.y = -0.32;
      fist.castShadow = true;
      el.add(fist);
      return { sh, el, fist };
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);

    // 脚
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.15 * side, 0.96, 0);
      this.root.add(hip);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.44, 0.17), cPants);
      thigh.position.y = -0.21;
      thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), cSkin);
      shin.position.y = -0.2;
      shin.castShadow = true;
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.3), cBand);
      foot.position.set(0, -0.42, 0.06);
      foot.castShadow = true;
      knee.add(foot);
      return { hip, knee, foot };
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    // 影用マーカー
    const shadowBlob = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    shadowBlob.rotation.x = -Math.PI / 2;
    shadowBlob.position.y = 0.02;
    this.root.add(shadowBlob);
  }

  get pos() { return this.root.position; }

  canAct() {
    return (this.state === 'idle' || this.state === 'walk' || this.state === 'guard' || this.state === 'crouch') && this.stun <= 0 && this.grounded;
  }
  canAirAct() {
    return (this.state === 'jump') && this.stun <= 0 && !this.grounded;
  }

  startAttack(type) {
    const isAir = (type === 'jumpkick' || type === 'jumppunch');
    if (isAir) {
      if (!this.canAirAct() || this.hasHit) return false;
      // 空中技は連発防止に軽いクールダウンのみ
      this.state = type;
      this.attackType = type;
      this.stateTime = 0;
      this.attackT = 0;
      this.hasHit = false;
      this.hitCount = 0;
      showMoveName(this, type);
      return true;
    }
    if (!this.canAct() || this.cooldown > 0) return false;
    const at = ATTACKS[type];
    if (!at) return false;
    this.state = type;
    this.attackType = type;
    this.stateTime = 0;
    this.attackT = 0;
    this.hasHit = false;
    this.hitCount = 0;
    this.cooldown = 0.10;
    this.invulnT = at.invuln || 0;
    // 昇龍拳はその場から真上に駆け上がる
    if (at.riseV && this.grounded) { this.vy = at.riseV; this.grounded = false; }
    if (type === 'shoryu' || type === 'tatsu' || type === 'tesshan') beep(520, 0.14, 'sawtooth', 0.07);
    showMoveName(this, type);
    return true;
  }

  takeHit(data, isBlocked) {
    if (this.hp <= 0) return;
    const chipMult = data.chip ?? 0.15;
    if (isBlocked) {
      this.hp = Math.max(0, this.hp - data.damage * chipMult);
      this.stun = Math.max(this.stun, data.blockStun ?? 0.18);
      // しゃがみガードはしゃがみ維持
      if (this.state !== 'crouch') { this.state = 'guard'; this.stateTime = 0; }
      sfx.block();
      spawnSpark(this.pos, 0x88ccff, 8);
    } else {
      this.hp = Math.max(0, this.hp - data.damage);
      this.stun = data.stun;
      this.state = 'hit';
      this.stateTime = 0;
      if (data.height === 'low') sfx.kick(); else if (data.damage >= 14) sfx.kick(); else sfx.punch();
      spawnSpark(this.pos, data.height === 'low' ? 0xff8844 : 0xffcc33, data.damage >= 12 ? 20 : 14);
      shake(data.damage >= 12 ? 0.35 : 0.22);
      // ノックバック
      const dir = new THREE.Vector3().subVectors(this.pos, data.from).setY(0).normalize();
      if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
      this.pos.addScaledVector(dir, data.push * 0.12);
      // 打ち上げ・転倒
      if (data.launch && this.grounded) {
        this.vy = data.launch;
        this.grounded = false;
      }
      if (data.knockdown) {
        // 足払いは転倒に直行（HP残っていてもダウン演出寄り）
        this.stun = Math.max(this.stun, 0.8);
      }
    }
    if (this.hp <= 0) {
      this.state = 'down';
      this.stateTime = 0;
      sfx.down();
    } else if (!isBlocked && data.knockdown && this.hp > 0) {
      // 体力が残っても足払いで崩す
      this.state = 'hit';
      this.stateTime = 0;
    }
  }

  resetRound(x, z) {
    this.hp = 100;
    this.state = 'idle';
    this.stateTime = 0;
    this.stun = 0;
    this.vy = 0;
    this.y = 0;
    this.invulnT = 0;
    this.hitCount = 0;
    this.attackType = null;
    this.grounded = true;
    this.pos.set(x, 0, z);
    this.root.rotation.set(0, 0, 0);
  }

  update(dt, time, opp) {
    this.stateTime += dt;
    if (this.stun > 0) this.stun -= dt;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;

    // 常に相手の方を向く
    const dx = opp.pos.x - this.pos.x;
    const dz = opp.pos.z - this.pos.z;
    const yaw = Math.atan2(dx, dz);
    this.root.rotation.y = yaw;

    // 重力・ジャンプ（論理高さ this.y で管理）
    if (!this.grounded) {
      this.vy -= 16 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.grounded = true; this.vy = 0; if (this.state === 'jump') { this.state = 'idle'; this.stateTime = 0; } }
    }

    // 攻撃タイマー進行＋踏み込み
    if (isAttackState(this.state)) {
      this.attackT += dt;
      const at = ATTACKS[this.attackType];
      const total = at.startup + at.active + at.recovery;
      // 前進慣性（昇龍拳は空中でも前に進む）
      if (at.lunge && this.attackT < at.startup + at.active) {
        const fx = opp.pos.x - this.pos.x;
        const fz = opp.pos.z - this.pos.z;
        const fl = Math.hypot(fx, fz) || 1;
        this.pos.x += (fx / fl) * at.lunge * dt;
        this.pos.z += (fz / fl) * at.lunge * dt;
      }
      if (this.attackT >= total) {
        // 空中で終わったらjumpに戻す
        if (!this.grounded) {
          this.state = 'jump';
        } else {
          this.state = 'idle';
        }
        this.stateTime = 0;
        this.attackType = null;
      }
    }
    // ヒット硬直明け
    if (this.state === 'hit' && this.stun <= 0 && this.hp > 0) {
      this.state = 'idle';
      this.stateTime = 0;
    }

    this.animate(time);
    // リング内にクランプ（外はリングアウト判定側で処理するが、大きく出過ぎないよう）
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = RING_R + 1.2;
    if (r > maxR) {
      this.pos.x *= maxR / r;
      this.pos.z *= maxR / r;
    }
  }

  animate(t) {
    const s = this.state;
    const st = this.stateTime;
    const phase = t * 8 + (this.isPlayer ? 0 : Math.PI);
    // フットワーク基本リズム
    let bounce = Math.sin(phase) * 0.035;
    let visualY = this.y + bounce * (this.grounded ? 1 : 0);
    // 上半身の前後傾は torso/head で表現
    let torsoRX = 0.12, torsoRY = 0.12, headRX = 0, headRY = 0;
    // 構え（ファイティングポーズ：拳を前に）
    let aL = { x: -0.95, z: 0.35 }, aR = { x: -1.05, z: -0.35 };
    let eL = -1.35, eR = -1.45;
    let hL = 0.18, hR = -0.12, kL = 0.45, kR = 0.35;

    if (s === 'idle') {
      // ★フットワーク：細かくステップを踏む
      const step = Math.sin(phase);
      const step2 = Math.sin(phase * 0.5);
      hL = 0.22 + step * 0.28;
      hR = -0.18 - step * 0.28;
      kL = 0.45 + Math.max(0, -step) * 0.35;
      kR = 0.38 + Math.max(0, step) * 0.35;
      visualY = this.y - 0.06 + Math.abs(Math.sin(phase)) * 0.05;
      torsoRX = 0.12 + step * 0.02;
      torsoRY = 0.15 + step2 * 0.06; // 上体の揺れ
      aL.x = -0.95 + step * 0.08;
      aR.x = -1.05 - step * 0.08;
      eL = -1.35; eR = -1.45;
      headRX = Math.sin(phase * 0.5) * 0.04;
    } else if (s === 'walk') {
      const w = Math.sin(t * 11) * 0.65;
      hL = w; hR = -w; kL = 0.3 + Math.max(0, -w) * 0.6; kR = 0.3 + Math.max(0, w) * 0.6;
      aL.x = -0.9 - w * 0.4; aR.x = -1.0 + w * 0.4;
      visualY = this.y - 0.05 + Math.abs(Math.sin(t * 11)) * 0.03;
      torsoRY = 0.15;
    } else if (s === 'guard') {
      const g = Math.sin(t * 8) * 0.03;
      torsoRX = 0.18; torsoRY = 0.1;
      aL.x = -1.25 + g; aR.x = -1.25 - g; eL = -1.7; eR = -1.7;
      aL.z = 0.15; aR.z = -0.15;
      hL = 0.3; hR = -0.2; kL = 0.6; kR = 0.5;
      visualY = this.y - 0.12;
    } else if (s === 'crouch') {
      const g = Math.sin(t * 7) * 0.04;
      torsoRX = 0.32; torsoRY = 0.08;
      aL.x = -0.85 + g; aR.x = -0.85 - g; eL = -1.5; eR = -1.5;
      aL.z = 0.3; aR.z = -0.3;
      hL = 0.85; hR = 0.55; kL = 1.15; kR = 1.0;
      headRX = 0.15;
      visualY = this.y - 0.34;
    } else if (isAttackState(s)) {
      const at = ATTACKS[this.attackType];
      const k = Math.min(1, st / (at.startup + at.active + at.recovery));
      // 0→1→0 の伸びカーブ
      const extend = k < 0.35 ? k / 0.35 : k < 0.58 ? 1 : 1 - (k - 0.58) / 0.42;
      const e = Math.max(0, extend);
      switch (at.anim) {
        case 'jab':
          aR.x = -0.9 - e * 0.9; eR = -1.4 + e * 1.2;
          aL.x = -1.0; eL = -1.5;
          torsoRX = 0.12 + e * 0.12; torsoRY = 0.12 + e * 0.25;
          hR = -0.12; hL = 0.2;
          break;
        case 'straight':
          aR.x = -0.9 - e * 1.0; eR = -1.4 + e * 1.3;
          aL.x = -0.4; eL = -1.0;
          torsoRX = 0.12 + e * 0.22; torsoRY = 0.12 + e * 0.5;
          hL = 0.35; hR = -0.3; kL = 0.5; kR = 0.3;
          visualY = this.y - 0.04 + e * 0.02;
          break;
        case 'upper':
          // しゃがんで下から上へ
          visualY = this.y - 0.22 + e * 0.26;
          aR.x = 0.4 - e * 2.4; eR = -1.2 + e * 0.9;
          aL.x = -0.7; eL = -1.3;
          torsoRX = 0.3 - e * 0.45; torsoRY = 0.0 + e * 0.2;
          hL = 0.5; hR = -0.2; kL = 0.9 - e * 0.4; kR = 0.6;
          break;
        case 'body':
          visualY = this.y - 0.18 + e * 0.06;
          aL.x = -0.9 - e * 0.7; eL = -1.4 + e * 0.9;
          aR.x = -0.6; eR = -1.2;
          torsoRX = 0.12 + e * 0.3; torsoRY = -0.15;
          hL = 0.4; hR = -0.25; kL = 0.7; kR = 0.5;
          break;
        case 'middle':
          hR = -e * 1.7;
          kR = 0.15 + (e < 0.5 ? e * 0.4 : (1 - e) * 0.4);
          aL.x = -1.1; aR.x = 0.2;
          torsoRX = 0.12 - e * 0.2; torsoRY = -0.2;
          visualY = this.y + e * 0.05;
          break;
        case 'low':
          visualY = this.y - 0.12;
          hR = -e * 0.95;
          kR = 0.2;
          aL.x = -0.9; aR.x = 0.3;
          torsoRX = 0.15; torsoRY = -0.15;
          hL = 0.15; kL = 0.55;
          break;
        case 'high':
          hR = -e * 2.05;
          kR = 0.1;
          aL.x = -0.7 - e * 0.4; aR.x = 0.6;
          eL = -1.0; eR = -0.3;
          torsoRX = 0.12 - e * 0.35; torsoRY = -0.35;
          visualY = this.y + e * 0.08;
          hL = 0.1; kL = 0.15;
          break;
        case 'sweep':
          visualY = this.y - 0.28 + e * 0.08;
          hR = -0.3 - e * 0.6;
          kR = 0.15;
          torsoRX = 0.35; torsoRY = -0.5 + e * 0.6;
          aL.x = -0.4; aR.x = -0.2; eL = -0.8; eR = -0.8;
          aL.z = 0.7; aR.z = -0.7;
          break;
        case 'shoryu':
          // 地面に沈んで一気に天へ
          visualY = this.y + e * 0.15;
          aR.x = 0.7 - e * 3.2; eR = -1.6 + e * 1.3;
          aL.x = -0.5; eL = -1.0;
          aL.z = 0.5; aR.z = -0.2;
          torsoRX = 0.35 - e * 0.62; torsoRY = 0.1;
          headRX = -0.35;
          hL = 0.7 - e * 0.5; hR = -0.1 - e * 0.25;
          kL = 1.0 - e * 0.7; kR = 0.5;
          break;
        case 'tatsu':
          // コマのように回転しながら前進
          visualY = this.y + 0.12 + Math.abs(Math.sin(st * 18)) * 0.06;
          torsoRX = 0.1; torsoRY = st * 22;
          headRY = st * 22;
          aL.x = -0.2; aR.x = -0.2; eL = -0.2; eR = -0.2;
          aL.z = 1.2; aR.z = -1.2;
          { const sw = Math.sin(st * 26) * 0.9;
          hL = -1.2 + sw * 0.4; hR = -1.2 - sw * 0.4; kL = 0.1; kR = 0.1; }
          break;
        case 'tesshan':
          // 肩からぶち当たる鉄山靠
          visualY = this.y - 0.16 + e * 0.04;
          torsoRX = 0.3 + e * 0.25; torsoRY = 0.45;
          aR.x = -1.7; eR = -2.2; aR.z = -0.5;
          aL.x = 0.5; eL = -0.6; aL.z = 0.4;
          headRX = 0.1;
          hL = 0.65; hR = -0.45; kL = 0.7; kR = 0.35;
          break;
        case 'jumpkick':
        case 'jumppunch':
          visualY = this.y;
          if (at.anim === 'jumpkick') {
            hR = -1.4 * e - 0.3; kR = 0.2;
            hL = 0.4; kL = 0.9;
            aL.x = -0.6; aR.x = 0.4;
          } else {
            aR.x = -0.9 - e * 0.9; eR = -0.3;
            hL = -0.4; hR = 0.35; kL = 0.7; kR = 0.5;
          }
          torsoRX = 0.05;
          break;
        default:
          break;
      }
    } else if (s === 'jump') {
      hL = -0.5; hR = 0.3; kL = 0.8; kR = 0.4;
      aL.x = -0.7; aR.x = -0.7;
      visualY = this.y; // ジャンプ中はbobなし
    } else if (s === 'hit') {
      const shakeX = Math.sin(st * 50) * 0.08;
      torsoRX = -0.25;
      headRX = -0.3;
      torsoRY = 0.0;
      aL.x = 0.3; aR.x = 0.4;
      this.torso.position.x = shakeX;
    } else if (s === 'down') {
      const k = Math.min(1, st * 2.2);
      this.root.rotation.x = -k * 1.35;
      visualY = this.y + 0.05;
      hL = -0.3; hR = 0.3;
    } else if (s === 'win') {
      // ★ドヤモーション：胸に親指＋相手指差し＋首振り
      const wag = Math.sin(t * 5);
      const bounceW = Math.abs(Math.sin(t * 5)) * 0.06;
      visualY = this.y - 0.04 + bounceW;
      // 右手は自分指（胸に親指）
      aR.x = -0.55; aR.z = -0.15; eR = -2.1;
      // 左手は相手を指差して振る
      aL.x = -1.15 + wag * 0.12; aL.z = 0.25; eL = -0.25 + wag * 0.15;
      torsoRX = -0.16; torsoRY = -0.12 + wag * 0.06;
      headRX = -0.12; headRY = Math.sin(t * 3.2) * 0.45;
      hL = 0.32; hR = -0.28; kL = 0.25; kR = 0.2;
    } else if (s === 'lose') {
      this.root.rotation.x = -1.35;
    }

    if (s !== 'hit') this.torso.position.x = 0;
    if (s !== 'down' && s !== 'lose') this.root.rotation.x = 0;

    this.torso.rotation.x = torsoRX;
    this.torso.rotation.y = torsoRY;
    this.headG.rotation.x = headRX;
    this.headG.rotation.y = headRY;
    this.armL.sh.rotation.set(aL.x, 0, -aL.z);
    this.armR.sh.rotation.set(aR.x, 0, -aR.z);
    this.armL.el.rotation.x = eL;
    this.armR.el.rotation.x = eR;
    this.legL.hip.rotation.x = hL;
    this.legR.hip.rotation.x = hR;
    this.legL.knee.rotation.x = kL;
    this.legR.knee.rotation.x = kR;

    this.root.position.y = visualY;
  }

  get fistWorld() {
    const v = new THREE.Vector3();
    this.armR.fist.getWorldPosition(v);
    return v;
  }
  get footWorld() {
    const v = new THREE.Vector3();
    this.legR.foot.getWorldPosition(v);
    return v;
  }
}

// ============ エフェクト ============
const sparks = [];
function spawnSpark(pos, color = 0xffcc33, n = 12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.09, 0.09),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.set(pos.x, pos.y + 1.3, pos.z);
    const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6);
    sparks.push({ m, v, life: 0.4 + Math.random() * 0.2 });
    scene.add(m);
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.v.y -= 12 * dt;
    s.m.position.addScaledVector(s.v, dt);
    s.m.rotation.x += 8 * dt;
    s.m.rotation.y += 8 * dt;
    if (s.life <= 0) { scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); sparks.splice(i, 1); }
  }
}
let shakeT = 0;
function shake(amount) { shakeT = Math.max(shakeT, amount); }

// ============ ゲーム管理 ============
const p1 = new Fighter({ isPlayer: true, color: 0xffffff, pants: 0x223366, x: -2.2, z: 0 });
const p2 = new Fighter({ isPlayer: false, color: 0xcc2222, pants: 0x111111, x: 2.2, z: 0 });

const hp1El = document.getElementById('hp1');
const hp2El = document.getElementById('hp2');
const chip1El = document.getElementById('chip1');
const chip2El = document.getElementById('chip2');
const timerEl = document.getElementById('timer');
const msgEl = document.getElementById('center-msg');
const subEl = document.getElementById('sub-msg');
const wins1El = document.getElementById('wins1');
const wins2El = document.getElementById('wins2');

const game = {
  phase: 'title', // title, intro, fight, roundEnd, matchEnd
  round: 1,
  timer: 60,
  phaseTime: 0,
  hitstop: 0,
  winner: null,
  difficulty: 'arcade', // easy | normal | arcade（デフォルトは現状の強さ）
};

// 難易度：デフォルト arcade＝基準の強さ（高速化に合わせて再調整済み）
const DIFFS = {
  easy:   { label: 'やさしい',   interval: [0.38, 0.62], guardP: 0.015, dmg: 0.70, antiAir: 0.02, spd: -0.6, aggro: 0.32 },
  normal: { label: 'ふつう',     interval: [0.30, 0.50], guardP: 0.035, dmg: 0.85, antiAir: 0.05, spd: -0.2, aggro: 0.42 },
  arcade: { label: 'アーケード', interval: [0.27, 0.50], guardP: 0.05,  dmg: 1.00, antiAir: 0.08, spd: 0.0,  aggro: 0.50 },
};
let toastTimer = null;
function showToast(t) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = t;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1300);
}
function setDifficulty(d) {
  if (!DIFFS[d]) return;
  game.difficulty = d;
  try { localStorage.setItem('virtua_diff', d); } catch (_) {}
  document.querySelectorAll('#diff-btns button').forEach(b => b.classList.toggle('sel', b.dataset.diff === d));
  showToast('難易度：' + DIFFS[d].label);
}

function showMsg(text, sub = '') {
  msgEl.textContent = text;
  msgEl.classList.add('show');
  subEl.textContent = sub;
}
function hideMsg() { msgEl.classList.remove('show'); subEl.textContent = ''; }

// ---- 技名表示（左上） ----
const MOVE_NAMES = {
  jab: 'ジャブ', straight: 'ストレート', upper: 'アッパー', body: 'ボディブロー',
  middle: 'ミドルキック', low: 'ローキック', high: 'ハイキック', sweep: '足払い',
  jumpkick: 'ジャンプキック', jumppunch: 'ジャンプパンチ',
  shoryu: '昇龍拳', tatsu: '竜巻旋風脚', tesshan: '鉄山靠',
};
const SPECIAL_MOVES = new Set(['shoryu', 'tatsu', 'tesshan']);
let moveNameTimer = null;
function showMoveName(fighter, type) {
  const el = document.getElementById('move-name');
  if (!el) return;
  const nm = MOVE_NAMES[type] || type;
  el.innerHTML = '';
  const who = document.createElement('span');
  who.className = 'mn-who ' + (fighter.isPlayer ? 'you' : 'cpu');
  who.textContent = fighter.isPlayer ? 'YOU' : 'CPU';
  el.appendChild(who);
  el.appendChild(document.createTextNode(nm));
  el.classList.remove('hidden');
  el.classList.toggle('you', fighter.isPlayer);
  el.classList.toggle('cpu', !fighter.isPlayer);
  el.classList.toggle('special', SPECIAL_MOVES.has(type));
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  if (moveNameTimer) clearTimeout(moveNameTimer);
  moveNameTimer = setTimeout(() => el.classList.add('hidden'), 900);
}
function hideMoveName() {
  const el = document.getElementById('move-name');
  if (el) el.classList.add('hidden');
  if (moveNameTimer) { clearTimeout(moveNameTimer); moveNameTimer = null; }
}

// ---- 勝ちドヤ吹き出し「10年早いんだよ！」 ----
const tauntEl = document.getElementById('taunt');
let tauntWinner = null;
function showTaunt(winner) {
  tauntWinner = winner;
  if (tauntEl) {
    tauntEl.textContent = '10年早いんだよ！';
    tauntEl.classList.remove('hidden');
  }
}
function hideTaunt() {
  tauntWinner = null;
  if (tauntEl) tauntEl.classList.add('hidden');
}
const _tauntV = new THREE.Vector3();
function updateTaunt() {
  if (!tauntEl || !tauntWinner || tauntEl.classList.contains('hidden')) return;
  _tauntV.set(tauntWinner.pos.x, tauntWinner.y + 2.55, tauntWinner.pos.z);
  _tauntV.project(camera);
  if (_tauntV.z > 1) { tauntEl.classList.add('hidden'); return; }
  const x = (_tauntV.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_tauntV.y * 0.5 + 0.5) * window.innerHeight;
  tauntEl.style.left = x + 'px';
  tauntEl.style.top = (y - 10) + 'px';
}

function updateHUD() {
  hp1El.style.width = (p1.hp) + '%';
  hp2El.style.width = (p2.hp) + '%';
  chip1El.style.width = (p1.hp) + '%';
  chip2El.style.width = (p2.hp) + '%';
  timerEl.textContent = Math.ceil(game.timer);
  const pip = (w) => (w >= 2 ? '● ●' : w === 1 ? '● ○' : '○ ○');
  wins1El.textContent = pip(p1.wins);
  wins2El.textContent = pip(p2.wins);
}

// ============ 入力（キーボード＋USBコントローラ） ============
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyR' && (game.phase === 'roundEnd' || game.phase === 'matchEnd')) restartMatch();
  if (e.code === 'KeyH' || e.code === 'KeyM') {
    const ml = document.getElementById('movelist');
    if (ml) ml.classList.toggle('hidden');
  }
  if (e.code === 'KeyN') toggleMusic();
  if (e.code === 'Digit1') setDifficulty('easy');
  if (e.code === 'Digit2') setDifficulty('normal');
  if (e.code === 'Digit3') setDifficulty('arcade');
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ---- USBコントローラ (Gamepad API / 標準マッピング想定) ----
// 移動: 左スティック左右 / 十字左右 | 奥手前: LB/RB
// ジャンプ: 上 (スティック上/十字上) | ガード: 下 or RT長押し
// X=J / A=ミドルK / Y=アッパーU / B=ハイO / LT=ローI / RT=ガード
// Start=開始・再戦 / Select=技表
let curPad = null;
let prevPadBtns = [];
let padEdge = {};
let padConnectedName = '';

window.addEventListener('gamepadconnected', (e) => {
  padConnectedName = e.gamepad.id || 'gamepad';
  updatePadStatus();
});
window.addEventListener('gamepaddisconnected', () => {
  padConnectedName = '';
  curPad = null;
  prevPadBtns = [];
  updatePadStatus();
});

function getPad() {
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
  } catch (_) {}
  return null;
}
function padBtnHeld(pad, i) {
  const b = pad && pad.buttons[i];
  return !!(b && (b.pressed || b.value > 0.45));
}
function padAxisDZ(v, dz = 0.35) { return Math.abs(v) < dz ? 0 : v; }

function pollPad() {
  padEdge = {};
  curPad = getPad();
  updatePadStatus();
  if (!curPad) { prevPadBtns = []; updatePadInput(null); return; }
  const cur = Array.from(curPad.buttons, b => b.pressed || b.value > 0.45);
  const edge = (i) => !!cur[i] && !prevPadBtns[i];
  if (edge(2)) padEdge.jab = true;    // X / □
  if (edge(0)) padEdge.middle = true; // A / ×
  if (edge(3)) padEdge.upper = true;  // Y / △
  if (edge(1)) padEdge.high = true;   // B / ○
  if (edge(6)) padEdge.low = true;    // LT / L2
  if (edge(9)) padEdge.start = true;
  if (edge(8)) padEdge.select = true;
  prevPadBtns = cur;
  updatePadInput(curPad);

  if (padEdge.select) {
    const ml = document.getElementById('movelist');
    if (ml) ml.classList.toggle('hidden');
  }
  if (padEdge.start) {
    const ss = document.getElementById('start-screen');
    if (ss && !ss.classList.contains('hide')) {
      document.getElementById('start-btn').click();
    } else if (game.phase === 'roundEnd' || game.phase === 'matchEnd') {
      restartMatch();
    }
  }
}

function padMove() {
  // {x:-1..1, y:-1..1(up=-1), left,right,up,down,q,e,guardBtn}
  const r = { x: 0, y: 0, left: false, right: false, up: false, down: false, q: false, e: false, guardBtn: false };
  if (curPad) {
    const ax = padAxisDZ(curPad.axes[0] || 0);
    const ay = padAxisDZ(curPad.axes[1] || 0);
    r.x = ax; r.y = ay;
    r.left = ax < -0.01 || padBtnHeld(curPad, 14);
    r.right = ax > 0.01 || padBtnHeld(curPad, 15);
    r.up = ay < -0.01 || padBtnHeld(curPad, 12);
    r.down = ay > 0.01 || padBtnHeld(curPad, 13);
    r.q = padBtnHeld(curPad, 4);
    r.e = padBtnHeld(curPad, 5);
    r.guardBtn = padBtnHeld(curPad, 7);
  }
  // タッチ合流
  r.left = r.left || touchHeld.left;
  r.right = r.right || touchHeld.right;
  r.up = r.up || touchHeld.up;
  r.down = r.down || touchHeld.down;
  r.q = r.q || touchHeld.q;
  r.e = r.e || touchHeld.e;
  r.guardBtn = r.guardBtn || touchHeld.guard;
  return r;
}

function updatePadStatus() {
  const el = document.getElementById('pad-status');
  if (!el) return;
  if (curPad) {
    const short = (curPad.id || 'gamepad').slice(0, 28);
    el.textContent = '🎮 ' + short;
    el.classList.add('on');
  } else {
    el.textContent = 'パッド未接続（キー可）';
    el.classList.remove('on');
  }
}

// 右上の押下表示（小さく点灯）
function updatePadInput(pad) {
  const root = document.getElementById('pad-input');
  if (!root) return;
  const set = (k, on) => {
    const el = root.querySelector(`[data-pi="${k}"]`);
    if (el) el.classList.toggle('on', !!on);
  };
  if (!pad) {
    root.querySelectorAll('.on').forEach(el => el.classList.remove('on'));
    return;
  }
  const m = padMove();
  set('left', m.left);
  set('right', m.right);
  set('up', m.up);
  set('down', m.down);
  set('lb', padBtnHeld(pad, 4));
  set('rb', padBtnHeld(pad, 5));
  set('lt', padBtnHeld(pad, 6));
  set('rt', padBtnHeld(pad, 7));
  set('x', padBtnHeld(pad, 2));
  set('y', padBtnHeld(pad, 3));
  set('a', padBtnHeld(pad, 0));
  set('b', padBtnHeld(pad, 1));
}

// ---- モバイル用バーチャルパッド ----
const touchHeld = { left: false, right: false, up: false, down: false, q: false, e: false, guard: false };
const touchEdge = {};
function setupTouch() {
  const ui = document.getElementById('touch-ui');
  if (!ui) return;
  const autoTouch = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) || ('ontouchstart' in window);
  if (autoTouch) document.body.classList.add('touch');
  const tgl = document.getElementById('touch-toggle');
  if (tgl) tgl.addEventListener('click', () => document.body.classList.toggle('touch'));

  const press = (k) => {
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down' || k === 'q' || k === 'e' || k === 'guard') {
      touchHeld[k] = true;
    } else if (k === 'jab' || k === 'middle' || k === 'upper' || k === 'low' || k === 'high' || k === 'shoryu' || k === 'tatsu' || k === 'tesshan') {
      touchEdge[k] = true;
    } else if (k === 'select') {
      const ml = document.getElementById('movelist');
      if (ml) ml.classList.toggle('hidden');
    }
  };
  const release = (k) => {
    if (k in touchHeld) touchHeld[k] = false;
  };
  ui.querySelectorAll('button').forEach(btn => {
    const k = btn.dataset.t;
    if (!k) return;
    const down = (e) => { e.preventDefault(); btn.classList.add('pressed'); press(k); };
    const up = (e) => { e.preventDefault(); btn.classList.remove('pressed'); release(k); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', (e) => { if (e.buttons === 0) up(e); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// ---- 必殺技コマンド履歴（相対方向） ----
// 昇龍：前→下→前＋J / 竜巻：下→後＋K / 鉄山靠：前→前＋U
const dirHist = [];
let prevDir = { F: false, B: false, D: false, U: false };
function updateDirHistory() {
  const pm = padMove();
  const dx = p2.pos.x - p1.pos.x;
  const dz = p2.pos.z - p1.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  const ix = ((keys['KeyD'] || pm.right) ? 1 : 0) - ((keys['KeyA'] || pm.left) ? 1 : 0);
  const iz = ((keys['KeyE'] || pm.e) ? 1 : 0) - ((keys['KeyQ'] || pm.q) ? 1 : 0);
  const dot = ix * nx + iz * nz;
  const cur = {
    F: dot > 0.4,
    B: dot < -0.4,
    D: !!(keys['KeyS'] || pm.down),
    U: !!(keys['KeyW'] || pm.up),
  };
  const now = performance.now() / 1000;
  for (const k of ['F', 'B', 'D', 'U']) {
    if (cur[k] && !prevDir[k]) {
      dirHist.push({ d: k, t: now });
      if (dirHist.length > 10) dirHist.shift();
    }
  }
  prevDir = cur;
  while (dirHist.length && now - dirHist[0].t > 0.9) dirHist.shift();
}
function matchTail(seq, win) {
  const now = performance.now() / 1000;
  if (dirHist.length < seq.length) return false;
  const tail = dirHist.slice(-seq.length);
  for (let i = 0; i < seq.length; i++) if (tail[i].d !== seq[i]) return false;
  return (now - tail[0].t) <= win;
}
function clearDirHist() { dirHist.length = 0; }

function forwardHeld(me, opp) {
  const dx = opp.pos.x - me.pos.x;
  const dz = opp.pos.z - me.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  const pm = padMove();
  const ix = ((keys['KeyD'] || pm.right) ? 1 : 0) - ((keys['KeyA'] || pm.left) ? 1 : 0);
  const iz = ((keys['KeyE'] || pm.e) ? 1 : 0) - ((keys['KeyQ'] || pm.q) ? 1 : 0);
  return (ix * nx + iz * nz) > 0.4;
}

function playerControl(dt) {
  if (game.phase !== 'fight' || p1.hp <= 0) return;
  const pm = padMove();

  const inA = keys['KeyA'] || pm.left;
  const inD = keys['KeyD'] || pm.right;
  const inQ = keys['KeyQ'] || pm.q;
  const inE = keys['KeyE'] || pm.e;
  const inW = keys['KeyW'] || pm.up;
  // 下＝しゃがみ、ガードボタン＝立ちガード（Space/F/RT/R）
  const inCrouch = keys['KeyS'] || pm.down || touchHeld.down;
  const inGuardBtn = keys['Space'] || keys['KeyF'] || pm.guardBtn || touchHeld.guard;

  const atkJ = keys['KeyJ'] || padEdge.jab || touchEdge.jab;
  const atkK = keys['KeyK'] || padEdge.middle || touchEdge.middle;
  const atkU = keys['KeyU'] || padEdge.upper || touchEdge.upper;
  const atkI = keys['KeyI'] || padEdge.low || touchEdge.low;
  const atkO = keys['KeyO'] || padEdge.high || touchEdge.high;

  // 空中攻撃
  if (!p1.grounded) {
    const airSpeed = 2.5;
    if (inA) p1.pos.x -= airSpeed * dt;
    if (inD) p1.pos.x += airSpeed * dt;
    if (inQ) p1.pos.z -= airSpeed * dt;
    if (inE) p1.pos.z += airSpeed * dt;
    if (keys['KeyJ'] || padEdge.jab || touchEdge.jab) { if (p1.startAttack('jumppunch')) sfx.whiff(); keys['KeyJ'] = false; }
    if (keys['KeyK'] || padEdge.middle || padEdge.high || touchEdge.middle || touchEdge.high) { if (p1.startAttack('jumpkick')) sfx.whiff(); keys['KeyK'] = false; }
    padEdge.jab = padEdge.middle = padEdge.high = false;
    touchEdge.jab = touchEdge.middle = touchEdge.high = touchEdge.upper = touchEdge.low = false;
    return;
  }

  if (!p1.canAct()) return;

  const crouching = !!inCrouch;
  const guarding = !!inGuardBtn && !crouching;
  const defensive = crouching || guarding;
  const speed = crouching ? 1.6 : 3.8;
  const side = crouching ? 1.4 : 2.9;
  let moved = false;

  let mx = 0;
  if (inA) { mx -= 1; moved = true; }
  if (inD) { mx += 1; moved = true; }
  p1.pos.x += mx * speed * dt;
  if (inQ) { p1.pos.z -= side * dt; moved = true; }
  if (inE) { p1.pos.z += side * dt; moved = true; }

  if (inW && !defensive) {
    p1.vy = 5.8; p1.grounded = false; p1.state = 'jump'; p1.stateTime = 0;
    beep(250, 0.08, 'sine', 0.06);
    keys['KeyW'] = false;
  }
  if (crouching) {
    if (p1.state !== 'crouch') { p1.state = 'crouch'; p1.stateTime = 0; }
  } else if (guarding) {
    if (p1.state !== 'guard') { p1.state = 'guard'; p1.stateTime = 0; }
  } else if (p1.state === 'guard' || p1.state === 'crouch') {
    p1.state = moved ? 'walk' : 'idle'; p1.stateTime = 0;
  }

  const fwd = forwardHeld(p1, p2);
  // 必殺技（ショートカット＋モーション入力を優先）
  // 昇龍：T / 前→下→前＋J ｜ 竜巻：G / 下→後＋K ｜ 鉄山靠：B / 前→前＋U
  const jPressed = !!atkJ, kPressed = !!atkK, uPressed = !!atkU;
  let special = null;
  if (keys['KeyT'] || touchEdge.shoryu) special = 'shoryu';
  else if (keys['KeyG'] || touchEdge.tatsu) special = 'tatsu';
  else if (keys['KeyB'] || touchEdge.tesshan) special = 'tesshan';
  else if (jPressed && matchTail(['F', 'D', 'F'], 0.7)) special = 'shoryu';
  else if (kPressed && matchTail(['D', 'B'], 0.6)) special = 'tatsu';
  else if (uPressed && matchTail(['F', 'F'], 0.5)) special = 'tesshan';
  const clearAtkKeys = () => {
    keys['KeyJ'] = keys['KeyK'] = keys['KeyU'] = keys['KeyT'] = keys['KeyG'] = keys['KeyB'] = false;
    padEdge.jab = padEdge.middle = padEdge.upper = false;
    touchEdge.jab = touchEdge.middle = touchEdge.upper = touchEdge.shoryu = touchEdge.tatsu = touchEdge.tesshan = false;
  };
  if (special) {
    if (p1.startAttack(special)) { sfx.whiff(); clearDirHist(); }
    clearAtkKeys();
    keys['KeyI'] = keys['KeyO'] = false; padEdge.low = padEdge.high = false; touchEdge.low = touchEdge.high = false;
  } else if (atkJ) {
    let move = 'jab';
    if (defensive) move = 'body';
    else if (fwd) move = 'straight';
    if (p1.startAttack(move)) sfx.whiff();
    keys['KeyJ'] = false; padEdge.jab = false; touchEdge.jab = false;
  } else {
    if (atkK) {
      let move = 'middle';
      if (defensive) move = 'sweep';
      if (p1.startAttack(move)) sfx.whiff();
      keys['KeyK'] = false; padEdge.middle = false; touchEdge.middle = false;
    }
    if (atkU) { if (p1.startAttack('upper')) sfx.whiff(); keys['KeyU'] = false; padEdge.upper = false; touchEdge.upper = false; }
    if (atkI) { if (p1.startAttack('low')) sfx.whiff(); keys['KeyI'] = false; padEdge.low = false; touchEdge.low = false; }
    if (atkO) { if (p1.startAttack('high')) sfx.whiff(); keys['KeyO'] = false; padEdge.high = false; touchEdge.high = false; }
  }

  if (moved && p1.state === 'idle') { p1.state = 'walk'; p1.stateTime = 0; }
  if (!moved && p1.state === 'walk') { p1.state = 'idle'; p1.stateTime = 0; }
}

// ============ CPU AI ============
const ai = { timer: 0, mode: 'wait', dirX: 0, dirZ: 0, guardTime: 0 };
function cpuControl(dt) {
  if (game.phase !== 'fight' || p2.hp <= 0) return;
  ai.timer -= dt;
  if (ai.guardTime > 0) ai.guardTime -= dt;

  const dx = p1.pos.x - p2.pos.x;
  const dz = p1.pos.z - p2.pos.z;
  const dist = Math.hypot(dx, dz) || 1;
  const nx = dx / dist, nz = dz / dist;

  const DF = DIFFS[game.difficulty];
  // 対空：プレイヤーが跳んだら昇龍で迎撃
  const p1Jumping = !p1.grounded && p1.y > 0.5 && dist < 2.8;
  if (p1Jumping && p2.canAct() && Math.random() < DF.antiAir) {
    ai.mode = 'shoryu'; ai.timer = 0.3;
  }
  const playerAttacking = isAttackState(p1.state) && p1.attackT < 0.3;
  if (playerAttacking && dist < 2.8 && Math.random() < DF.guardP) {
    const ph = ATTACKS[p1.attackType] ? ATTACKS[p1.attackType].height : 'mid';
    if ((ph === 'high') && Math.random() < 0.45) { ai.mode = 'crouch'; ai.guardTime = 0.5 + Math.random() * 0.3; }
    else { ai.mode = 'guard'; ai.guardTime = 0.5 + Math.random() * 0.3; }
  }

  if (ai.timer <= 0) {
    ai.timer = DF.interval[0] + Math.random() * (DF.interval[1] - DF.interval[0]);
    const r = Math.random();
    // ラウンドが進むほど強く
    const aggro = DF.aggro + game.round * 0.1;
    if (!p2.grounded) {
      // 空中では空中キック狙い
      ai.mode = Math.random() < 0.5 ? 'airkick' : 'wait';
    } else if (dist > 3.2) {
      if (r < 0.68) ai.mode = 'approach';
      else if (r < 0.82) ai.mode = 'sidestep';
      else if (r < 0.90) ai.mode = 'jump';
      else if (r < 0.95) ai.mode = 'straight';
      else ai.mode = 'wait';
    } else if (dist > 1.9) {
      if (r < 0.28 * aggro) ai.mode = 'approach';
      else if (r < 0.28 * aggro + 0.14) ai.mode = 'jab';
      else if (r < 0.28 * aggro + 0.26) ai.mode = 'middle';
      else if (r < 0.28 * aggro + 0.33) ai.mode = 'low';
      else if (r < 0.28 * aggro + 0.39) ai.mode = 'tatsu';
      else if (r < 0.28 * aggro + 0.45) ai.mode = 'straight';
      else if (r < 0.28 * aggro + 0.50) ai.mode = 'tesshan';
      else if (r < 0.28 * aggro + 0.55) ai.mode = 'upper';
      else if (r < 0.28 * aggro + 0.63) { ai.mode = 'guard'; ai.guardTime = 0.4; }
      else if (r < 0.28 * aggro + 0.67) { ai.mode = 'crouch'; ai.guardTime = 0.5; }
      else if (r < 0.82) ai.mode = 'sidestep';
      else ai.mode = 'retreat';
    } else {
      if (r < 0.20) ai.mode = 'jab';
      else if (r < 0.32) ai.mode = 'middle';
      else if (r < 0.42) ai.mode = 'upper';
      else if (r < 0.50) ai.mode = 'low';
      else if (r < 0.55) ai.mode = 'high';
      else if (r < 0.60) ai.mode = 'shoryu';
      else if (r < 0.65) ai.mode = 'tatsu';
      else if (r < 0.70) ai.mode = 'tesshan';
      else if (r < 0.74) ai.mode = 'body';
      else if (r < 0.78) ai.mode = 'sweep';
      else if (r < 0.88) { ai.mode = 'guard'; ai.guardTime = 0.5; }
      else if (r < 0.92) { ai.mode = 'crouch'; ai.guardTime = 0.5; }
      else if (r < 0.96) ai.mode = 'retreat';
      else ai.mode = 'sidestep';
    }
    ai.dirZ = Math.random() < 0.5 ? -1 : 1;
  }

  // 空中行動
  if (!p2.grounded) {
    if (ai.mode === 'airkick' && p2.state === 'jump') p2.startAttack('jumpkick');
    // 空中漂い
    if (Math.random() < 0.3) { p2.pos.x += nx * 1.5 * dt; p2.pos.z += nz * 1.5 * dt; }
    if (p2.grounded) ai.mode = 'wait';
    return;
  }

  if (!p2.canAct() && p2.state !== 'guard' && p2.state !== 'crouch') {
    // 硬直中はガード解除しない
    return;
  }

  const spd = 3.3 + game.round * 0.25 + DF.spd;
  const doAtk = (m) => { p2.startAttack(m); ai.mode = 'wait'; };
  const toIdle = () => { if (p2.state === 'guard' || p2.state === 'crouch') p2.state = 'idle'; };
  switch (ai.mode) {
    case 'approach':
      toIdle();
      // 適正間合い（1.7m）で止まる：突っ込み過ぎ・張り付き防止
      if (dist < 1.7) { ai.mode = 'wait'; ai.timer = Math.min(ai.timer, 0.08); break; }
      p2.pos.x += nx * spd * dt;
      p2.pos.z += nz * spd * dt;
      if (p2.state === 'idle') p2.state = 'walk';
      break;
    case 'retreat':
      toIdle();
      p2.pos.x -= nx * spd * 0.8 * dt;
      if (p2.state === 'idle') p2.state = 'walk';
      break;
    case 'sidestep':
      toIdle();
      p2.pos.z += ai.dirZ * 2.2 * dt;
      if (p2.state === 'idle') p2.state = 'walk';
      break;
    case 'jump':
      if (p2.grounded && p2.canAct()) { p2.vy = 5.6; p2.grounded = false; p2.state = 'jump'; p2.stateTime = 0; }
      ai.mode = 'airkick';
      break;
    case 'guard':
      if (p2.state !== 'guard') { p2.state = 'guard'; p2.stateTime = 0; }
      if (ai.guardTime <= 0) { p2.state = 'idle'; ai.mode = 'wait'; }
      break;
    case 'crouch':
      if (p2.state !== 'crouch') { p2.state = 'crouch'; p2.stateTime = 0; }
      if (ai.guardTime <= 0) { p2.state = 'idle'; ai.mode = 'wait'; }
      break;
    case 'jab': doAtk('jab'); break;
    case 'straight': doAtk('straight'); break;
    case 'upper': doAtk('upper'); break;
    case 'body': doAtk('body'); break;
    case 'middle': doAtk('middle'); break;
    case 'low': doAtk('low'); break;
    case 'high': doAtk('high'); break;
    case 'sweep': doAtk('sweep'); break;
    case 'shoryu': doAtk('shoryu'); break;
    case 'tatsu': doAtk('tatsu'); break;
    case 'tesshan': doAtk('tesshan'); break;
    case 'airkick': doAtk('jumpkick'); break;
    case 'wait':
      if (p2.state === 'walk') p2.state = 'idle';
      if ((p2.state === 'guard' || p2.state === 'crouch') && ai.guardTime <= 0) p2.state = 'idle';
      break;
  }
}

// ============ 判定 ============
// 体の押し合い：めり込み・張り付き防止（両者とも低い位置にいる時のみ）
const MIN_DIST = 0.95;
function resolveBodies() {
  if (p1.hp <= 0 || p2.hp <= 0) return;
  // どちらかが高く跳んでいればすり抜け可（めくり・飛び越え用）
  if (p1.y > 0.9 || p2.y > 0.9) return;
  const dx = p2.pos.x - p1.pos.x;
  const dz = p2.pos.z - p1.pos.z;
  const d = Math.hypot(dx, dz);
  if (d >= MIN_DIST || d < 0.0001) return;
  const nx = dx / d, nz = dz / d;
  const push = (MIN_DIST - d) / 2;
  p1.pos.x -= nx * push; p1.pos.z -= nz * push;
  p2.pos.x += nx * push; p2.pos.z += nz * push;
}
function checkHits() {
  for (const [atk, def] of [[p1, p2], [p2, p1]]) {
    if (isAttackState(atk.state) && !atk.hasHit) {
      const data = ATTACKS[atk.attackType];
      if (!data) continue;
      const hits = data.hits || 1;
      const interval = data.hitInterval || 0.14;
      const n = atk.hitCount || 0;
      if (n >= hits) continue;
      // 昇龍拳の上昇中は相手の攻撃が当たらない
      if (def.invulnT > 0) continue;
      if (atk.attackT >= data.startup + n * interval && atk.attackT <= data.startup + data.active) {
        const dx = atk.pos.x - def.pos.x;
        const dz = atk.pos.z - def.pos.z;
        const d = Math.hypot(dx, dz);
        // 高さ：ジャンプでかわせるよう、Y差が大きいと当たらない（ローは空中の相手に当たらない）
        const yDiff = Math.abs(atk.y - def.y);
        if (data.height === 'low' && def.y > 0.9) continue;
        // しゃがみは上段をかわす
        const crouching = def.state === 'crouch' && def.grounded;
        if (crouching && data.height === 'high') continue;
        if (d <= data.range && yDiff < 2.2 && def.state !== 'down') {
          const last = n >= hits - 1;
          const standingGuard = def.state === 'guard' && def.grounded;
          const blocked = standingGuard || crouching;
          // 難易度でCPUの与ダメを調整（プレイヤーは等倍）
          const dmgScale = (atk === p2) ? DIFFS[game.difficulty].dmg : 1;
          def.takeHit({
            ...data,
            damage: data.damage * dmgScale,
            stun: last ? data.stun : 0.28,
            push: last ? data.push : 2.0,
            type: atk.attackType, from: atk.pos.clone(),
          }, blocked);
          atk.hitCount = n + 1;
          if (atk.hitCount >= hits) atk.hasHit = true;
          game.hitstop = blocked ? 0.05 : (last ? (data.damage >= 12 ? 0.11 : 0.08) : 0.04);
          updateHUD();
        }
      }
    }
  }
}

function checkRingOut() {
  for (const [f, other, name] of [[p1, p2, 'CPU'], [p2, p1, 'YOU']]) {
    if (f.hp <= 0) continue;
    const r = Math.hypot(f.pos.x, f.pos.z);
    if (r > RING_R + 0.25 && f.y <= 0.15) {
      endRound(other, name + ' RING OUT!');
      return true;
    }
  }
  return false;
}

// ============ ラウンド進行 ============
function startMatch() {
  p1.wins = 0; p2.wins = 0; game.round = 1;
  startRound();
}
function restartMatch() {
  hideMsg();
  startMatch();
}
function startRound() {
  p1.resetRound(-2.2, 0);
  p2.resetRound(2.2, 0);
  game.timer = 60;
  game.phase = 'intro';
  game.phaseTime = 0;
  game.winner = null;
  hideTaunt();
  hideMoveName();
  stopMusicAll();
  clearDirHist();
  showMsg(`ROUND ${game.round}`, 'READY...');
  sfx.bell();
  updateHUD();
}
function endRound(winner, reason) {
  if (game.phase !== 'fight') return;
  game.phase = 'roundEnd';
  game.phaseTime = 0;
  game.winner = winner;
  winner.wins++;
  winner.state = 'win'; winner.stateTime = 0;
  const loser = winner === p1 ? p2 : p1;
  if (loser.hp > 0 && !reason.includes('RING OUT') && !reason.includes('TIME')) { loser.state = 'lose'; loser.stateTime = 0; }
  showMsg(reason, `${winner === p1 ? 'YOU' : 'CPU'} WINS`);
  showTaunt(winner);
  startBGM('win');
  updateHUD();
}
function updateGame(dt) {
  game.phaseTime += dt;

  if (game.phase === 'intro') {
    if (game.phaseTime > 0.9 && game.phaseTime < 1.0) showMsg(`ROUND ${game.round}`, 'FIGHT!');
    if (game.phaseTime >= 1.6) { game.phase = 'fight'; hideMsg(); startBGM('fight'); }
  } else if (game.phase === 'fight') {
    game.timer -= dt;
    if (game.timer <= 0) {
      game.timer = 0;
      const winner = p1.hp === p2.hp ? (Math.random() < 0.5 ? p1 : p2) : (p1.hp > p2.hp ? p1 : p2);
      endRound(winner, 'TIME UP!');
    }
    if (p1.hp <= 0 && p2.hp <= 0) endRound(p1.hp >= p2.hp ? p1 : p2, 'DOUBLE KO!');
    else if (p1.hp <= 0) endRound(p2, 'K.O.!');
    else if (p2.hp <= 0) endRound(p1, 'K.O.!');
    updateHUD();
  } else if (game.phase === 'roundEnd') {
    if (game.phaseTime >= 2.2) {
      if (p1.wins >= 2 || p2.wins >= 2) {
        game.phase = 'matchEnd';
        game.phaseTime = 0;
        const champ = p1.wins >= 2 ? 'YOU WIN!' : 'CPU WIN!';
        showMsg(champ, 'Rキーで再戦');
      } else {
        game.round++;
        startRound();
      }
    }
  }
}

// ============ カメラ ============
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const mid = new THREE.Vector3().addVectors(p1.pos, p2.pos).multiplyScalar(0.5);
  mid.y = 1.2;
  const dx = p1.pos.x - p2.pos.x;
  const dz = p1.pos.z - p2.pos.z;
  const dist = Math.hypot(dx, dz);
  const desired = new THREE.Vector3(mid.x * 0.7, 3.0 + dist * 0.22, mid.z * 0.5 + 7.2 + dist * 0.55);
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camTarget.lerp(mid, 1 - Math.pow(0.0001, dt));
  let sx = 0, sy = 0;
  if (shakeT > 0) {
    shakeT -= dt;
    sx = (Math.random() - 0.5) * shakeT * 1.2;
    sy = (Math.random() - 0.5) * shakeT * 1.2;
  }
  camera.lookAt(camTarget.x + sx, camTarget.y + sy, camTarget.z);
}

// ============ メインループ ============
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  let dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  pollPad();
  updateDirHistory();

  if (game.hitstop > 0) {
    game.hitstop -= dt;
    dt *= 0.08; // ヒットストップ
  }

  if (game.phase === 'fight') {
    playerControl(dt);
    cpuControl(dt);
  }

  p1.update(dt, time, p2);
  p2.update(dt, time, p1);
  resolveBodies();
  checkHits();
  if (game.phase === 'fight') checkRingOut();
  updateGame(game.phase === 'fight' ? dt : dt);
  updateSparks(dt);
  updateCamera(dt);
  updateTaunt();

  renderer.render(scene, camera);
}
loop();
updateHUD();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============ スタート ============
document.getElementById('start-btn').addEventListener('click', () => {
  initAudio();
  ensureMusicGain();
  document.getElementById('start-screen').classList.add('hide');
  startMatch();
});
const musicBtn = document.getElementById('music-btn');
if (musicBtn) musicBtn.addEventListener('click', (e) => { e.stopPropagation(); initAudio(); ensureMusicGain(); toggleMusic(); musicBtn.blur(); });
document.querySelectorAll('#diff-btns button').forEach(b => {
  b.addEventListener('click', () => { initAudio(); setDifficulty(b.dataset.diff); b.blur(); });
});
try {
  const saved = localStorage.getItem('virtua_diff');
  if (saved && DIFFS[saved]) {
    game.difficulty = saved;
    document.querySelectorAll('#diff-btns button').forEach(b => b.classList.toggle('sel', b.dataset.diff === saved));
  } else {
    document.querySelector('#diff-btns button[data-diff="arcade"]').classList.add('sel');
  }
} catch (_) {
  document.querySelector('#diff-btns button[data-diff="arcade"]').classList.add('sel');
}
setupTouch();
