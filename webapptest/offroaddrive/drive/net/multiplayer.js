// Multiplayer over WebRTC with Trystero: players connect to each other
// directly; public Nostr relays are only used to find each other. The room
// code is also the password that encrypts the connection handshake.
//
// One player hosts (creates the room). The host owns the shared world (time,
// weather, moon) and the キャノンボール course; everyone drives their own truck
// and sends its state ~15 times a second.

import { cleanText } from './chat.js';

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
  onHostLeft = () => {};
  onStatus = () => {};    // (text)
  hostEnv = () => null;   // host: current env to send to a newcomer
  hostSpot = () => null;  // host: where newcomers should appear {x, z, heading}
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
    this.onStatus('接続の準備中…');
    const { joinRoom, selfId } = await import(TRYSTERO);
    this.selfId = selfId;
    this.code = code.toUpperCase();
    this.isHost = host;
    this.hostId = host ? selfId : null;
    this.me = { name: name || 'プレイヤー', color: color || COLORS[0] };
    const room = (this.room = joinRoom({ appId: APP_ID, password: this.code }, `room-${this.code}`, {
      onJoinError: (d) => this.onStatus(`接続できない相手がいます（${d?.error ?? 'error'}）`),
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
      }
    };
    room.onPeerLeave = (peerId) => {
      const p = this.peers.get(peerId);
      this.peers.delete(peerId);
      if (p?.host) { this.hostId = null; this.onHostLeft(p); }
      this.onPeersChanged();
    };
    hello.onMessage = (data, { peerId }) => {
      this.peers.set(peerId, { name: String(data?.name ?? '?').slice(0, 16), color: String(data?.color ?? '#fff').slice(0, 9), host: !!data?.host });
      if (data?.host) this.hostId = peerId;
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
    this.onStatus(host ? '部屋を作りました。参加者を待っています' : 'ホストを探しています…');
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
  sendRace(r) { if (this.isHost) this.#a.race?.send(r); }
  sendFinish(f) { this.#a.fin?.send(f); }
  sendHit(peerId, h) { this.#a.hit?.send(h, { target: peerId }); }
  sendChat(text) { this.#a.chat?.send({ text: cleanText(text) }); }
  sendEmote(i) { this.#a.emote?.send({ i }); }
  /** Mini-game message to everyone, or to one player. */
  sendGame(data, peerId = null) { this.#a.game?.send(data, peerId ? { target: peerId } : undefined); }
}
