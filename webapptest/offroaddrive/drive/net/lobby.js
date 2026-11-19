// The マルチ button and its panel: name and colour, create a room (host) or
// join one by code, the player list, leave. Also a small toast for events.
import { COLORS, makeCode } from './multiplayer.js';

const STORE = 'offroad-drive.player.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? 'null') ?? {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode */ }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createLobby({ bar, net, onJoined = () => {}, onLeft = () => {} }) {
  const saved = load();
  const me = { name: saved.name || '', color: saved.color || COLORS[Math.floor(Math.random() * COLORS.length)] };
  let status = '';

  const button = document.createElement('button');
  button.textContent = 'マルチ';
  bar.appendChild(button);
  const panel = document.createElement('div');
  panel.className = 'cb-panel mp-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  const toastEl = document.createElement('div');
  toastEl.className = 'mp-toast';
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  const toast = (text, ms = 3500) => {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  };

  const refreshButton = () => {
    button.textContent = net.active ? `👥 ${net.players.length}人${net.isHost ? '（ホスト）' : ''}` : 'マルチ';
    button.setAttribute('aria-pressed', String(net.active));
  };

  const render = () => {
    refreshButton();
    if (panel.hidden) return;
    const colors = COLORS.map((c) => `<button class="mp-color${c === me.color ? ' on' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    if (!net.active) {
      panel.innerHTML = `
        <h2>マルチプレイ</h2>
        <p>部屋を作ると5文字の部屋コードが出ます。友だちにコードを伝えて、同じコードで参加してもらってください。</p>
        <label class="mp-field">名前 <input id="mpName" maxlength="16" value="${esc(me.name)}" placeholder="プレイヤー"></label>
        <div class="mp-colors">${colors}</div>
        <div class="cb-row"><button data-act="host">部屋を作る（ホスト）</button></div>
        <div class="cb-row mp-join"><input id="mpCode" maxlength="5" placeholder="部屋コード" autocapitalize="characters" autocomplete="off"><button data-act="join">参加</button></div>
        <p class="mp-note">ホストは時間・天気・月とキャノンボールのコースを決めます。BGM・画質・視点はそれぞれ自由です。<br>
        通信は参加者どうしの直接接続（P2P）です。相手を見つけるのに公開の中継サーバー（Nostr）を使い、参加者にはお互いのIPアドレスが伝わります。</p>
        ${status ? `<p class="mp-status">${esc(status)}</p>` : ''}
        <div class="cb-row"><button data-act="close">閉じる</button></div>`;
    } else {
      const list = net.players.map((p) => `<li><i style="background:${p.color}"></i>${esc(p.name)}${p.host ? ' <b>ホスト</b>' : ''}${p.self ? ' <small>（あなた）</small>' : ''}</li>`).join('');
      panel.innerHTML = `
        <h2>マルチプレイ</h2>
        <div class="mp-code">部屋コード <b>${net.code}</b> <button data-act="copy">コピー</button></div>
        <ul class="mp-list">${list}</ul>
        ${net.players.length < 2 ? '<p>参加者を待っています…（同じコードで「参加」してもらってください）</p>' : ''}
        ${status ? `<p class="mp-status">${esc(status)}</p>` : ''}
        <div class="cb-row"><button data-act="leave">退出</button><button data-act="close">閉じる</button></div>`;
    }
    panel.querySelector('#mpName')?.addEventListener('input', (e) => { me.name = e.target.value.trim(); save(me); });
    for (const b of panel.querySelectorAll('.mp-color')) b.addEventListener('click', (e) => { e.stopPropagation(); me.color = b.dataset.color; save(me); render(); });
    const code = panel.querySelector('#mpCode');
    code?.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    code?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(code.value, false); });
    panel.querySelector('#mpName')?.addEventListener('keydown', (e) => e.stopPropagation());
    for (const b of panel.querySelectorAll('button[data-act]')) {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === 'close') panel.hidden = true;
        else if (act === 'host') join(makeCode(), true);
        else if (act === 'join') join(panel.querySelector('#mpCode').value, false);
        else if (act === 'leave') { net.leave(); status = ''; onLeft(); render(); }
        else if (act === 'copy') { try { await navigator.clipboard.writeText(net.code); toast('部屋コードをコピーしました'); } catch { toast(net.code); } }
      });
    }
  };

  async function join(code, host) {
    code = String(code || '').toUpperCase();
    if (code.length !== 5) { status = '部屋コードは5文字です'; render(); return; }
    try {
      await net.join(code, { host, name: me.name || 'プレイヤー', color: me.color });
      onJoined();
    } catch (err) {
      console.warn(err);
      status = `接続に失敗しました: ${err?.message ?? err}`;
    }
    render();
  }

  net.onStatus = (text) => { status = text; render(); };
  button.addEventListener('click', (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; render(); });

  return { render, toast, panel, me, join };
}
