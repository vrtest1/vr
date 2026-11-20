// Multiplayer over WebRTC with Trystero: players connect to each other
// directly; public Nostr relays are only used to find each other. The room
// code is also the password that encrypts the connection handshake.
//
// One player hosts (creates the room). The host owns the shared world (time,
// weather, moon) and the キャノンボール course; everyone drives their own truck
// and sends its state ~15 times a second. When the host leaves, the player with
// the smallest id takes over: every machine works that out by itself (same
// list, same rule), and the new host says so with a hello.

import { cleanText } from './chat.js';
import { t } from '../i18n.js';

const TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
const APP_ID = 'offroad-drive.procedural-world.v1';
export const COLORS = ['#e8a33d', '#4fb3e8', '#e8584f', '#6fd36a', '#c77be8', '#e8d94f', '#4fe8c8', '#e87bb0'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export class Multiplayer {
  room = null;
  code = '';
  isHost = false;
  selfId = '';
  me = { name: '', color: COLORS[0] };
  /** peerId -> { name, color, host } */
  peers = new Map();
  hostId = null;
  // Callbacks set by the app.
  onPeersChanged = () => {};
  onState = () => {};     // (peerId, stateArray)
  onEnv = () => {};       // (env) from the host
  onRace = () => {};      // (race) from the host
  onFinish = () => {};    // (peerId, {time})
  onHit = () => {};       // (peerId, {x, z, s}) another truck hit ours
  onChat = () => {};      // (peerId, text) a chat message (already cleaned)
  onEmote = () => {};     // (peerId, index) a stamp
  onGame = () => {};      // (peerId, data) mini-game messages (net/games.js checks them)
  onHostLeft = () => {};  // (oldHost, newHostId) the host left; newHostId took over
  onBecameHost = () => {}; // we are the new host (send the world to everyone)
  onStatus = () => {};    // (text)
  hostEnv = () => null;   // host: current env to send to a newcomer
  hostSpot = () => null;  // host: where newcomers should appear {x, z, heading}
  hostRace = () => null;  // host: (peerId) a race in progress for a newcomer to join, or null
  onSpot = () => {};      // guest: (spot) from the host on joining

  #a = {};

  get active() { return !!this.room; }

  /** Everyone in the room, host first, then by id (a stable order on every machine). */
  get players() {
    const all = [{ id: this.selfId, ...this.me, host: this.isHost, self: true }];
    for (const [id, p] of this.peers) all.push({ id, ...p, self: false });
    return all.sort((a, b) => (b.host - a.host) || (a.id < b.id ? -1 : 1));
  }

  async join(code, { host = false, name, color } = {}) {
    if (this.room) this.leave();
    this.onStatus(t('接続の準備中…', 'Getting ready to connect…'));
    const { joinRoom, selfId } = await import(TRYSTERO);
    this.selfId = selfId;
    this.code = code.toUpperCase();
    this.isHost = host;
    this.hostId = host ? selfId : null;
    this.me = { name: name || t('プレイヤー', 'Player'), color: color || COLORS[0] };
    const room = (this.room = joinRoom({ appId: APP_ID, password: this.code }, `room-${this.code}`, {
      onJoinError: (d) => this.onStatus(t(`接続できない相手がいます（${d?.error ?? 'error'}）`, `Could not reach someone (${d?.error ?? 'error'})`)),
    }));
    const act = (name) => (this.#a[name] = room.makeAction(name));
    const hello = act('hello'), state = act('st'), env = act('env'), race = act('race'), fin = act('fin'), spot = act('spot'), hit = act('hit'), chat = act('chat'), emote = act('emote'), game = act('game');

    room.onPeerJoin = (peerId) => {
      hello.send({ ...this.me, host: this.isHost }, { target: peerId });
      if (this.isHost) {
        const e = this.hostEnv();
        if (e) env.send(e, { target: peerId });
        const s = this.hostSpot();
        if (s) spot.send(s, { target: peerId });
        const r = this.hostRace(peerId);
        if (r) race.send(r, { target: peerId });
      }
    };
    room.onPeerLeave = (peerId) => {
      const p = this.peers.get(peerId);
      this.peers.delete(peerId);
      if (p?.host || peerId === this.hostId) {
        // Hand over: the smallest id among those left (us included) hosts now.
        const next = [this.selfId, ...this.peers.keys()].sort()[0];
        this.hostId = next;
        if (next === this.selfId) {
          this.isHost = true;
          hello.send({ ...this.me, host: true });
        } else {
          const q = this.peers.get(next);
          if (q) q.host = true;
        }
        if (p) this.onHostLeft(p, next);
        if (this.isHost) this.onBecameHost();
      }
      this.onPeersChanged();
    };
    hello.onMessage = (data, { peerId }) => {
      const host = !!data?.host;
      this.peers.set(peerId, { name: String(data?.name ?? '?').slice(0, 16), color: String(data?.color ?? '#fff').slice(0, 9), host });
      if (host) {
        // Two hosts (both took over at once with different lists): the smaller id keeps it.
        if (this.isHost && this.selfId < peerId) {
          hello.send({ ...this.me, host: true }, { target: peerId });
          this.peers.get(peerId).host = false;
        } else {
          if (this.isHost) this.isHost = false;
          for (const [id, q] of this.peers) if (id !== peerId) q.host = false;
          this.hostId = peerId;
        }
      }
      this.onPeersChanged();
    };
    state.onMessage = (data, { peerId }) => { if (Array.isArray(data)) this.onState(peerId, data); };
    // World and course only count when they come from the host.
    env.onMessage = (data, { peerId }) => { if (peerId === this.hostId) this.onEnv(data); };
    race.onMessage = (data, { peerId }) => { if (peerId === this.hostId) this.onRace(data); };
    spot.onMessage = (data, { peerId }) => { if (peerId === this.hostId) this.onSpot(data); };
    fin.onMessage = (data, { peerId }) => this.onFinish(peerId, data);
    hit.onMessage = (data, { peerId }) => { if (data && Number.isFinite(data.x) && Number.isFinite(data.z)) this.onHit(peerId, data); };
    emote.onMessage = (data, { peerId }) => {
      if (this.peers.has(peerId) && Number.isInteger(data?.i)) this.onEmote(peerId, data.i);
    };
    game.onMessage = (data, { peerId }) => {
      if (this.peers.has(peerId) && data && typeof data === 'object') this.onGame(peerId, data);
    };
    chat.onMessage = (data, { peerId }) => {
      if (!this.peers.has(peerId)) return; // only from players who said hello
      const text = cleanText(data?.text);
      if (text) this.onChat(peerId, text);
    };
    this.onStatus(host ? t('部屋を作りました。参加者を待っています', 'Room made. Waiting for players') : t('ホストを探しています…', 'Looking for the host…'));
    this.onPeersChanged();
  }

  leave() {
    try { this.room?.leave(); } catch { /* already gone */ }
    this.room = null;
    this.peers.clear();
    this.hostId = null;
    this.isHost = false;
    this.#a = {};
    this.onPeersChanged();
  }

  sendState(arr) { this.#a.st?.send(arr); }
  sendEnv(env) { if (this.isHost) this.#a.env?.send(env); }
  sendRace(r, peerId = null) { if (this.isHost) this.#a.race?.send(r, peerId ? { target: peerId } : undefined); }
  sendFinish(f) { this.#a.fin?.send(f); }
  sendHit(peerId, h) { this.#a.hit?.send(h, { target: peerId }); }
  sendChat(text) { this.#a.chat?.send({ text: cleanText(text) }); }
  sendEmote(i) { this.#a.emote?.send({ i }); }
  /** Mini-game message to everyone, or to one player. */
  sendGame(data, peerId = null) { this.#a.game?.send(data, peerId ? { target: peerId } : undefined); }
}
