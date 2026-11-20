// Text chat for multiplayer: a チャット button in the bar, a log window in the
// top-right corner, and speech bubbles over each truck (ours too).
//
//   Enter (or the button) opens the input, Enter sends, Esc closes.
//
// Messages are plain text everywhere (textContent, never innerHTML), at most
// MAX characters, and a chatty peer is throttled on the receiving side.
import * as THREE from 'three';

const MAX = 120;          // characters per message
const LOG = 40;           // messages kept in the window
const BUBBLE_MS = (text) => 4500 + text.length * 120;
const FADE_MS = 15000;    // the window dims when nothing has happened for this long

/** Plain one-line text: no control characters, trimmed, length-limited. */
export function cleanText(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX);
}

export function createChat({ bar, net, remotes, vehicle, onOpen = () => {} }) {
  // --- button
  const button = document.createElement('button');
  button.textContent = 'チャット';
  button.title = 'チャット（Enter）';
  button.classList.add('keep'); // stays when the bar is folded on phones
  bar.appendChild(button);

  // --- window
  const win = document.createElement('div');
  win.className = 'chat';
  win.hidden = true;
  const log = document.createElement('div');
  log.className = 'chat-log';
  const form = document.createElement('form');
  form.className = 'chat-form';
  form.hidden = true;
  const input = document.createElement('input');
  input.maxLength = MAX;
  input.placeholder = 'メッセージ（Enter で送信、Esc で閉じる）';
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  form.appendChild(input);
  win.append(log, form);
  document.body.appendChild(win);
  // Sit just under the bar, however many rows it wraps to.
  const place = () => { win.style.top = `${Math.round(bar.getBoundingClientRect().bottom + 8)}px`; };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(bar);
  window.addEventListener('resize', place);
  place();

  let lastActivity = 0;
  const touch = () => { lastActivity = performance.now(); win.classList.remove('idle'); };

  const add = (who, text, color = null) => {
    const line = document.createElement('div');
    if (who) {
      const name = document.createElement('b');
      name.textContent = who;
      if (color) name.style.color = color;
      line.append(name, document.createTextNode(' ' + text));
    } else {
      line.className = 'sys';
      line.textContent = text;
    }
    log.appendChild(line);
    while (log.children.length > LOG) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    win.hidden = false;
    touch();
  };

  // --- bubbles over the trucks
  const bubbles = new Map(); // id ('self' for ours) -> { el, until }
  const say = (id, text) => {
    let b = bubbles.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'chat-bubble';
      document.body.appendChild(el);
      b = { el, until: 0 };
      bubbles.set(id, b);
    }
    b.el.textContent = text;
    b.until = performance.now() + BUBBLE_MS(text);
  };

  // --- open / send / close
  const isOpen = () => !form.hidden;
  const open = () => {
    if (!net.active) {
      add(null, 'チャットはマルチで部屋に入ると使えます');
      return;
    }
    win.hidden = false;
    form.hidden = false;
    touch();
    onOpen();
    input.focus();
  };
  const close = () => {
    form.hidden = true;
    input.blur();
    if (!log.children.length) win.hidden = true;
  };
  button.addEventListener('click', (e) => { e.stopPropagation(); isOpen() ? close() : open(); });
  // Japanese (and other) input methods: the Return that confirms a
  // conversion must not send. Chrome marks that keydown as composing; Safari
  // ends the composition just before it, so a Return right after counts too.
  let composing = false, composedAt = -1e9, imeEnter = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; composedAt = performance.now(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (imeEnter) { imeEnter = false; return; }
    const text = cleanText(input.value);
    input.value = '';
    if (text && net.active) {
      net.sendChat(text);
      add(net.me.name, text, net.me.color);
      say('self', text);
    }
    close();
  });
  // Typing must not drive the truck or trigger the shortcuts.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      imeEnter = composing || e.isComposing || e.keyCode === 229 || performance.now() - composedAt < 100;
      if (imeEnter) { e.preventDefault(); imeEnter = false; return; }
    }
    if (e.key === 'Escape' && !(composing || e.isComposing)) { input.value = ''; close(); }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    open();
  });
  win.addEventListener('pointerenter', touch);

  // --- incoming, with a simple flood guard per peer (5 messages per 4 s)
  const recent = new Map();
  net.onChat = (peerId, text) => {
    const now = performance.now();
    const times = (recent.get(peerId) ?? []).filter((t) => now - t < 4000);
    if (times.length >= 5) return;
    times.push(now);
    recent.set(peerId, times);
    const p = net.peers.get(peerId);
    add(p?.name ?? '?', text, p?.color);
    say(peerId, text);
  };

  // Who came and went.
  let known = new Map();
  const peersChanged = () => {
    const now = new Map(net.peers);
    if (net.active) {
      for (const [id, p] of now) if (!known.has(id)) add(null, `${p.name} が参加しました`);
      for (const [id, p] of known) if (!now.has(id)) add(null, `${p.name} が退出しました`);
    }
    for (const id of known.keys()) if (!now.has(id)) { bubbles.get(id)?.el.remove(); bubbles.delete(id); }
    known = now;
    if (!net.active) close();
  };

  // --- every frame: place the bubbles, dim an idle window
  const v = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const update = (camera, renderer) => {
    const now = performance.now();
    if (!win.hidden && !isOpen() && !win.matches(':hover') && now - lastActivity > FADE_MS) win.classList.add('idle');
    if (!bubbles.size) return;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    camera.getWorldPosition(camPos);
    for (const [id, b] of bubbles) {
      const r = id === 'self' ? null : remotes.list.get(id);
      const pos = id === 'self' ? vehicle.position : r?.root.visible ? r.position : null;
      let show = !!pos && now < b.until;
      if (show) {
        // Above the name tag (others) or above the cab (ours).
        v.copy(pos).add(_lift.set(0, id === 'self' ? 2.0 : 2.35, 0));
        const d = v.distanceTo(camPos);
        v.project(camera);
        show = v.z < 1 && d < 600;
        if (show) {
          b.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h - (id === 'self' ? 0 : 26)}px)`;
          b.el.style.opacity = String(Math.min(1, (b.until - now) / 600) * THREE.MathUtils.clamp(1.3 - d / 500, 0.4, 1));
        }
      }
      b.el.style.display = show ? 'block' : 'none';
    }
  };

  return { update, peersChanged, open, close, add, say, get typing() { return isOpen(); } };
}

const _lift = new THREE.Vector3();
