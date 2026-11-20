// Mini-games for a room (or on your own, for 星集め): the ミニゲーム button.
//
//   鬼ごっこ  3 min. One truck is 鬼 (it). Touch another truck and they are it.
//            A tag can't be passed straight back for 3 s. The least time
//            spent as 鬼 wins. 鬼 glows red, gets a little more power, and
//            everyone gets an arrow: runners to 鬼, 鬼 to the nearest truck.
//   星集め    2 min. Stars everyone can see fall around the players; first to
//            touch one gets it (1 point, rainbow 3) and its effect. Most wins.
//
// The host runs the game: it decides who is 鬼 and who got a star, and sends
// the whole state about once a second (so latecomers catch up) and at once
// on every change. Players only ask ("I touched X", "I touched star 12").
// Nothing here trusts a message beyond its shape.
import * as THREE from 'three';
import { haloTexture } from '../stars.js';
import { t, placeName } from '../i18n.js';

const TAG_TIME = 180;    // s
const STAR_TIME = 120;   // s
const TAG_GRACE = 3;     // s after a tag when nobody can be tagged
const STAR_COUNT = 8;    // stars out at once
const ONI_POWER = 1.15;  // a little extra for 鬼
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length < 64;

export class Games {
  mode = null;   // null | 'tag' | 'stars'
  #o;
  #ui = {};
  // What everyone knows (from the host's state messages).
  #endsAt = 0; #oni = null; #graceUntil = 0; #times = {}; #scores = {};
  // Host only.
  #h = null;
  #auras = new Map(); // truck root -> sprite
  #place = () => {};
  #halo = null;

  /**
   * @param {object} o  { net, bar, vehicle, truck, remotes, stars, sound, chat,
   *   toast(text), cannonball, ground, camMode() }
   */
  constructor(o) {
    this.#o = o;
    const ui = this.#ui;
    ui.button = document.createElement('button');
    ui.button.textContent = t('ミニゲーム', 'Mini-games');
    ui.button.addEventListener('click', (e) => { e.stopPropagation(); this.#togglePanel(); });
    o.bar.appendChild(ui.button);
    const el = (cls) => { const d = document.createElement('div'); d.className = cls; d.hidden = true; document.body.appendChild(d); return d; };
    ui.panel = el('cb-panel game-panel');
    ui.hud = el('cb-hud game-hud');
    ui.board = el('cb-board game-board');
    ui.result = el('cb-big game-result');
    ui.panel.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.go;
      if (act === 'tag' || act === 'stars') this.start(act);
      else if (act === 'stop') this.stop();
      if (act) ui.panel.hidden = true;
    });
    // The HUD sits under the bar (however many rows it wraps to) and, on a
    // narrow phone screen, under the meter too.
    const place = () => {
      const narrow = innerWidth <= 700;
      const meter = document.getElementById('meter');
      const below = Math.max(o.bar.getBoundingClientRect().bottom, narrow && meter ? meter.getBoundingClientRect().bottom : 0);
      ui.hud.style.top = `${Math.round(below + 8)}px`;
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(o.bar);
    addEventListener('resize', place);
    this.#place = place;
    place();
    // Messages from the room.
    o.net.onGame = (peerId, d) => this.#receive(peerId, d);
    setInterval(() => this.#hostTick(), 250); // keeps going in a background tab
  }

  // --- who is playing ---------------------------------------------------------

  get #self() { return this.#o.net.active ? this.#o.net.selfId : 'me'; }
  get #isHost() { return !this.#o.net.active || this.#o.net.isHost; }
  #players() {
    const { net } = this.#o;
    if (!net.active) return [{ id: 'me', name: net.me.name || t('あなた', 'You'), color: net.me.color, self: true }];
    return net.players;
  }
  #name(id) { return this.#players().find((p) => p.id === id)?.name ?? '?'; }
  #pos(id) {
    if (id === this.#self) return this.#o.vehicle.position;
    const r = this.#o.remotes.list.get(id);
    return r?.root.visible ? r.position : null;
  }

  // --- panel ------------------------------------------------------------------

  #togglePanel() {
    const ui = this.#ui;
    if (!ui.panel.hidden) { ui.panel.hidden = true; return; }
    const host = this.#isHost;
    const players = this.#players().length;
    const racing = ['countdown', 'running'].includes(this.#o.cannonball.state);
    ui.panel.innerHTML = `
      <h2>${t('ミニゲーム', 'Mini-games')}</h2>
      <h3>👹 ${t('鬼ごっこ（3分）', 'Tag (3 min)')}</h3>
      <p>${t('鬼が車にぶつけると鬼が交代（交代して3秒はタッチ無効）。鬼だった時間がいちばん短い人の勝ち。2人以上で。', 'Whoever is “it” passes it on by bumping another truck (no tag-backs for 3 s). Least time as “it” wins. Two or more players.')}</p>
      <h3>⭐ ${t('星集め（2分）', 'Star hunt (2 min)')}</h3>
      <p>${t('みんなの近くに降ってくる星を早い者勝ちで取る。普通の星1点、虹の星3点。星の効果も付きます。1人でも練習できます。', 'Stars fall near everyone: first come, first served. A star is 1 point, a rainbow star 3, and they work as power-ups too. You can practise alone.')}</p>
      ${!host ? t('<p><b>ゲームを始めるのはホストです。</b></p>', '<p><b>The host starts the games.</b></p>')
        : racing ? t('<p><b>キャノンボールの最中は始められません。</b></p>', '<p><b>Not during a Cannonball race.</b></p>')
        : this.mode ? `<div class="cb-row"><button data-go="stop">${t('今のゲームをやめる', 'Stop this game')}</button></div>`
        : `<div class="cb-row">
            <button data-go="tag" ${players < 2 ? 'disabled' : ''}>${t('鬼ごっこ', 'Tag')}<small>${players < 2 ? t('マルチで2人以上', 'Two or more online') : t(`${players}人`, `${players} players`)}</small></button>
            <button data-go="stars">${t('星集め', 'Star hunt')}<small>${t(`${players}人`, `${players} player${players > 1 ? 's' : ''}`)}</small></button>
          </div>`}
      <div class="cb-row"><button data-go="close" data-act="close">${t('閉じる', 'Close')}</button></div>`;
    ui.panel.hidden = false;
  }

  // --- host: start, rule, end -------------------------------------------------

  /** Host: start a game (`seconds` only to shorten it in tests). */
  start(mode, seconds = null) {
    if (!this.#isHost || this.mode) return;
    const players = this.#players();
    if (mode === 'tag' && players.length < 2) return;
    const now = performance.now() / 1000;
    this.#h = {
      mode, endsAt: now + (seconds ?? (mode === 'tag' ? TAG_TIME : STAR_TIME)), lastSent: 0,
      oni: mode === 'tag' ? players[Math.floor(Math.random() * players.length)].id : null,
      since: now, lastTag: now, times: {}, scores: {}, stars: new Map(), seq: 1,
    };
    for (const p of players) { this.#h.times[p.id] = 0; this.#h.scores[p.id] = 0; }
    this.#broadcast({ t: 'begin', mode });
    this.#apply({ t: 'begin', mode });
    this.#sendState();
  }

  stop() {
    if (!this.#isHost || !this.#h) return;
    this.#h = null;
    const d = { t: 'end', mode: this.mode, rank: [], stopped: true };
    this.#broadcast(d);
    this.#apply(d);
  }

  #hostTick() {
    const h = this.#h;
    if (!h) return;
    // The host left a room we were hosting, or we left: stop.
    if (this.#o.net.active && !this.#o.net.isHost) { this.#h = null; return; }
    const now = performance.now() / 1000;
    if (now >= h.endsAt) return this.#finish();
    if (h.mode === 'stars') {
      while (h.stars.size < STAR_COUNT) if (!this.#hostDropStar()) break;
    }
    if (now - h.lastSent > 1) this.#sendState();
  }

  #hostDropStar() {
    const h = this.#h, { ground } = this.#o;
    const players = this.#players();
    const n = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const p = this.#pos(players[Math.floor(Math.random() * players.length)].id);
      if (!p) continue;
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 140;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (ground.height(x, z) < ground.water(x, z) + 0.6 || ground.normal(x, z, n).y < 0.85) continue;
      const kind = Math.random() < 0.1 ? 'rainbow' : Math.random() < 0.5 ? 'boost' : 'grip';
      h.stars.set(h.seq, { kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
      h.seq++;
      this.#sendState();
      return true;
    }
    return false;
  }

  /** Host: player `a` reports touching truck `b`. */
  #hostTouch(a, b) {
    const h = this.#h;
    if (!h || h.mode !== 'tag') return;
    const now = performance.now() / 1000;
    if (now - h.lastTag < TAG_GRACE || (h.oni !== a && h.oni !== b) || a === b) return;
    const next = h.oni === a ? b : a;
    if (!this.#players().some((p) => p.id === next)) return;
    h.times[h.oni] = (h.times[h.oni] ?? 0) + (now - h.since);
    const from = h.oni;
    h.oni = next; h.since = now; h.lastTag = now;
    const d = { t: 'tagged', from, to: next };
    this.#broadcast(d);
    this.#apply(d);
    this.#sendState();
  }

  /** Host: player `by` reports touching star `id`. */
  #hostTake(by, id) {
    const h = this.#h;
    const st = h?.mode === 'stars' ? h.stars.get(id) : null;
    if (!st) return;
    h.stars.delete(id);
    h.scores[by] = (h.scores[by] ?? 0) + (st.kind === 'rainbow' ? 3 : 1);
    const d = { t: 'took', id, by };
    this.#broadcast(d);
    this.#apply(d);
    this.#sendState();
  }

  #finish() {
    const h = this.#h;
    this.#h = null;
    const now = performance.now() / 1000;
    const players = this.#players();
    let rank;
    if (h.mode === 'tag') {
      h.times[h.oni] = (h.times[h.oni] ?? 0) + (now - h.since);
      rank = players.map((p) => ({ id: p.id, v: Math.round(h.times[p.id] ?? 0) })).sort((x, y) => x.v - y.v);
    } else {
      rank = players.map((p) => ({ id: p.id, v: h.scores[p.id] ?? 0 })).sort((x, y) => y.v - x.v);
    }
    const d = { t: 'end', mode: h.mode, rank, lastOni: h.oni };
    this.#broadcast(d);
    this.#apply(d);
  }

  #sendState() {
    const h = this.#h;
    if (!h) return;
    const now = performance.now() / 1000;
    h.lastSent = now;
    const times = { ...h.times };
    if (h.mode === 'tag') times[h.oni] = (times[h.oni] ?? 0) + (now - h.since);
    const d = {
      t: 'state', mode: h.mode, left: Math.max(0, h.endsAt - now),
      oni: h.oni, grace: Math.max(0, TAG_GRACE - (now - h.lastTag)),
      times, scores: { ...h.scores },
      stars: [...h.stars].map(([id, s]) => [id, s.kind, s.x, s.z]),
    };
    this.#broadcast(d);
    this.#apply(d);
  }

  #broadcast(d) { if (this.#o.net.active) this.#o.net.sendGame(d); }

  // --- players: ask the host ----------------------------------------------------

  /** Our truck touched another player's (from either side's physics). */
  touched(otherId) {
    if (this.mode !== 'tag' || !isId(otherId)) return;
    if (this.#isHost) this.#hostTouch(this.#self, otherId);
    else this.#o.net.sendGame({ t: 'touch', other: otherId }, this.#o.net.hostId);
  }

  /** We drove into a game star. */
  take(id) {
    if (this.mode !== 'stars') return;
    if (this.#isHost) this.#hostTake(this.#self, id);
    else this.#o.net.sendGame({ t: 'take', id }, this.#o.net.hostId);
  }

  #receive(peerId, d) {
    const { net } = this.#o;
    if (this.#isHost) {
      // Requests from players.
      if (d.t === 'touch' && isId(d.other)) this.#hostTouch(peerId, d.other);
      else if (d.t === 'take' && Number.isInteger(d.id)) this.#hostTake(peerId, d.id);
      return;
    }
    if (peerId !== net.hostId) return; // the rest only counts from the host
    if (!['begin', 'state', 'tagged', 'took', 'end'].includes(d.t)) return;
    this.#apply(d);
  }

  // --- everyone: show what the host says ------------------------------------------

  #apply(d) {
    const { stars, sound, toast, chat } = this.#o;
    const self = this.#self;
    const now = performance.now() / 1000;
    if (d.t === 'begin' && (d.mode === 'tag' || d.mode === 'stars')) {
      this.mode = d.mode;
      this.#times = {}; this.#scores = {};
      this.#ui.result.hidden = true;
      stars.pauseLocal = true;
      sound.chime?.('go');
      const text = d.mode === 'tag' ? t('👹 鬼ごっこスタート！', '👹 Tag: go!') : t('⭐ 星集めスタート！', '⭐ Star hunt: go!');
      toast(text);
      chat?.add(null, text);
    } else if (d.t === 'state' && (d.mode === 'tag' || d.mode === 'stars')) {
      if (!this.mode) { this.mode = d.mode; stars.pauseLocal = true; } // joined late
      if (Number.isFinite(d.left)) this.#endsAt = now + d.left;
      this.#oni = isId(d.oni) ? d.oni : null;
      if (Number.isFinite(d.grace)) this.#graceUntil = now + d.grace;
      if (d.times && typeof d.times === 'object') this.#times = d.times;
      if (d.scores && typeof d.scores === 'object') this.#scores = d.scores;
      if (Array.isArray(d.stars)) {
        const live = new Set();
        for (const s of d.stars) {
          if (!Array.isArray(s) || !Number.isInteger(s[0]) || !['boost', 'grip', 'rainbow'].includes(s[1]) || !Number.isFinite(s[2]) || !Number.isFinite(s[3])) continue;
          live.add(s[0]);
          stars.addShared(s[0], s[1], s[2], s[3]);
        }
        for (const st of [...stars.stars]) if (st.shared !== null && !live.has(st.shared)) stars.removeShared(st.shared);
      }
    } else if (d.t === 'tagged' && isId(d.to)) {
      this.#oni = d.to;
      this.#graceUntil = now + TAG_GRACE;
      sound.chime?.('other-goal');
      const text = d.to === self ? t('👹 あなたが鬼！ だれかにぶつけろ！', '👹 You’re it! Bump someone!') : t(`👹 ${this.#name(d.to)} が鬼になった！`, `👹 ${this.#name(d.to)} is it!`);
      toast(text);
      chat?.add(null, text);
    } else if (d.t === 'took' && Number.isInteger(d.id)) {
      stars.removeShared(d.id, d.by === self);
    } else if (d.t === 'end') {
      this.#end(d);
    }
  }

  /** The host left: whoever judged the game is gone, so it is over (for everyone, each on their own). */
  hostLost() {
    this.#h = null;
    if (this.mode) this.#end({ stopped: true });
  }

  #end(d) {
    const { stars, sound, chat } = this.#o;
    const mode = this.mode;
    this.mode = null;
    this.#oni = null;
    stars.clearShared();
    stars.pauseLocal = false;
    this.#ui.hud.hidden = true;
    this.#ui.board.hidden = true;
    for (const a of this.#auras.values()) a.visible = false;
    for (const r of this.#o.remotes.list.values()) delete r.tag.dataset.oni;
    if (d.stopped || !Array.isArray(d.rank) || !mode) { chat?.add(null, t('ミニゲームを終了しました', 'Mini-game over')); return; }
    const rank = d.rank.filter((r) => r && isId(r.id) && Number.isFinite(r.v));
    const fmt = (v) => (mode === 'tag' ? t(`鬼 ${clock(v)}`, `it for ${clock(v)}`) : t(`${v} 点`, `${v} pt`));
    const medal = (i) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
    const lines = rank.map((r, i) => `${medal(i)} ${esc(this.#name(r.id))}${r.id === this.#self ? t('（自分）', ' (you)') : ''}　${fmt(r.v)}`);
    const first = rank[0]?.id === this.#self;
    this.#ui.result.innerHTML = `<div class="cb-title">${mode === 'tag' ? t('👹 鬼ごっこ', '👹 Tag') : t('⭐ 星集め', '⭐ Star hunt')} ${t('終了！', 'over!')}</div>
      <div class="cb-sub game-rank">${lines.join('<br>')}</div>`;
    this.#ui.result.hidden = false;
    setTimeout(() => { this.#ui.result.hidden = true; }, 7000);
    sound.chime?.(first ? 'goal-first' : 'goal');
    chat?.add(null, t(`${mode === 'tag' ? '👹 鬼ごっこ' : '⭐ 星集め'}の結果: ${rank.map((r, i) => `${i + 1}位 ${this.#name(r.id)}（${fmt(r.v)}）`).join('、')}`,
      `${mode === 'tag' ? '👹 Tag' : '⭐ Star hunt'} results: ${rank.map((r, i) => `${placeName(i + 1).replace(/着$/, '')} ${this.#name(r.id)} (${fmt(r.v)})`).join(', ')}`));
  }

  // --- every frame ------------------------------------------------------------------

  update(dt, camera) {
    const { vehicle, truck, remotes, net } = this.#o;
    // Lost the host (they left): the game is over for us.
    if (this.mode && net.active && !net.isHost && !net.hostId) this.#end({ stopped: true });
    const ui = this.#ui;
    if (!this.mode) return;
    const now = performance.now() / 1000;
    const self = this.#self;
    const left = this.#endsAt - now;

    // 鬼: red halo, 👹 on the name tag, a little more power.
    if (this.mode === 'tag') {
      this.#aura(truck.root, this.#oni === self && this.#o.camMode() < 2, now);
      for (const r of remotes.list.values()) {
        const it = r.id === this.#oni;
        this.#aura(r.root, it, now);
        if (it) r.tag.dataset.oni = '1'; else delete r.tag.dataset.oni;
      }
      if (this.#oni === self) vehicle.power *= ONI_POWER;
    }

    // The arrow: runners to 鬼, 鬼 to the nearest truck.
    let target = null, label = '';
    if (this.mode === 'tag' && this.#oni) {
      if (this.#oni === self) {
        let best = Infinity;
        for (const p of this.#players()) {
          if (p.id === self) continue;
          const q = this.#pos(p.id);
          const d = q ? q.distanceTo(vehicle.position) : Infinity;
          if (d < best) { best = d; target = q; label = p.name; }
        }
      } else { target = this.#pos(this.#oni); label = t(`鬼 ${this.#name(this.#oni)}`, `it: ${this.#name(this.#oni)}`); }
    }
    let arrow = '';
    if (target) {
      const f = camera.getWorldDirection(_v);
      const camYaw = Math.atan2(f.x, -f.z);
      const yaw = Math.atan2(target.x - vehicle.position.x, -(target.z - vehicle.position.z));
      const d = Math.hypot(target.x - vehicle.position.x, target.z - vehicle.position.z);
      arrow = `<span class="game-arrow" style="transform:rotate(${yaw - camYaw}rad)">▲</span><span>${esc(label)} ${Math.round(d)} m</span>`;
    }
    const grace = this.mode === 'tag' && now < this.#graceUntil ? ` <small>${t('（タッチ無効 ', '(no tag-backs ')}${Math.ceil(this.#graceUntil - now)}${t('）', ')')}</small>` : '';
    const head = this.mode === 'tag'
      ? (this.#oni === self ? t('<b class="oni">👹 あなたが鬼！</b>', '<b class="oni">👹 You’re it!</b>') : `👹 ${t('鬼', 'it')}: ${esc(this.#name(this.#oni))}`) + grace
      : t(`⭐ 星集め　${this.#scores[self] ?? 0} 点`, `⭐ Star hunt　${this.#scores[self] ?? 0} pt`);
    ui.hud.innerHTML = `<span>${head}</span>${arrow}<span class="cb-clock">${clock(left)}</span>`;
    if (ui.hud.hidden) { ui.hud.hidden = false; this.#place(); }

    // The board: everyone, best first.
    const rows = this.#players().map((p) => ({
      p, v: this.mode === 'tag' ? (this.#times[p.id] ?? 0) : (this.#scores[p.id] ?? 0),
    })).sort((a, b) => (this.mode === 'tag' ? a.v - b.v : b.v - a.v));
    ui.board.innerHTML = rows.map((r, i) => `<div class="${r.p.id === self ? 'me' : ''}"><span>${i + 1}</span><i style="background:${esc(r.p.color)}"></i><em>${esc(r.p.name)}${this.mode === 'tag' && r.p.id === this.#oni ? ' 👹' : ''}</em>${this.mode === 'tag' ? clock(r.v) : r.v + t(' 点', ' pt')}</div>`).join('');
    ui.board.hidden = false;
  }

  /** A red pulsing halo on 鬼's truck. */
  #aura(root, on, now) {
    let a = this.#auras.get(root);
    if (!a) {
      if (!on) return;
      this.#halo ??= haloTexture();
      a = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#halo, color: 0xff2a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      a.scale.setScalar(9);
      a.position.set(0, 0.6, 0);
      a.renderOrder = 6;
      root.add(a);
      this.#auras.set(root, a);
    }
    a.visible = on;
    if (on) a.material.opacity = 0.45 + 0.25 * Math.sin(now * 8);
  }
}

const _v = new THREE.Vector3();
