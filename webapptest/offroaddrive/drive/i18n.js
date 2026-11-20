// Japanese or English. Every text on screen is written as t('日本語', 'English')
// right where it is used, so the two stay side by side.
//
// Which one: ?lang=ja|en, else the player's choice (the English / 日本語
// button, kept in localStorage), else the browser's language. Switching
// reloads the page (the world seed is in the address, so it comes back).
// Messages between players are always built on each screen, so a Japanese
// and an English player can share a room.

const KEY = 'offroad-drive.lang.v1';

function pick() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'ja') return q;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ja') return saved;
  } catch { /* private mode */ }
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
}

export const LANG = pick();
export const EN = LANG === 'en';

/** The text in the current language. */
export const t = (ja, en) => (EN ? en : ja);

/** 1着 / 1st. */
export const placeName = (n) => (EN ? `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}` : `${n}着`);

/** Switch language (reloads the page). */
export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  location.replace(url);
}
