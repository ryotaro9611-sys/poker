// データ保存層：端末の localStorage に保存。デモはメモリ上だけで扱い、実データには一切書き込まない。
import { buildDemoDb } from './demo.js';

const KEY = 'tripledger:data:v1';
const DEMO_FLAG = 'tripledger:demo';

export class SaveError extends Error {
  constructor(cause) {
    super('端末への保存に失敗しました。空き容量不足やブラウザの設定（プライベートブラウズ等）が原因の可能性があります。入力内容はそのまま残っています。');
    this.name = 'SaveError';
    this.cause = cause;
  }
}
export class UserError extends Error {
  constructor(msg) { super(msg); this.name = 'UserError'; }
}

export function emptyDb() {
  return { version: 1, trips: [], sessions: [], active: null, drafts: {}, prefs: {}, rateCache: {} };
}

let real = null;
let demoDb = null;
let demo = false;
const listeners = new Set();
export const status = { storageOk: true, notice: null };

function normalize(d) {
  const base = emptyDb();
  if (!d || typeof d !== 'object') return base;
  return {
    ...base,
    ...d,
    trips: Array.isArray(d.trips) ? d.trips : [],
    sessions: Array.isArray(d.sessions) ? d.sessions : [],
    drafts: d.drafts && typeof d.drafts === 'object' ? d.drafts : {},
    prefs: d.prefs && typeof d.prefs === 'object' ? d.prefs : {},
    rateCache: d.rateCache && typeof d.rateCache === 'object' ? d.rateCache : {},
  };
}

function readReal() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    status.storageOk = false;
    status.notice = 'この端末のブラウザ保存領域を利用できません。記録は保存されない可能性があります（プライベートブラウズやCookie設定をご確認ください）。';
    return real || emptyDb();
  }
  if (!raw) return emptyDb();
  try {
    return normalize(JSON.parse(raw));
  } catch (e) {
    // 壊れたデータは消さずに退避してから空で開始
    try { localStorage.setItem(`${KEY}:corrupt:${Date.now()}`, raw); } catch { /* noop */ }
    status.notice = '保存データを読み込めなかったため、元データを退避して空の状態で開きました。設定画面のバックアップから復元できます。';
    return emptyDb();
  }
}

export function init() {
  real = readReal();
  try {
    if (sessionStorage.getItem(DEMO_FLAG) === '1') {
      demo = true;
      demoDb = buildDemoDb(emptyDb);
    }
  } catch { /* noop */ }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      real = readReal();
      if (!demo) emit({ external: true });
    }
  });
}

export function getDb() {
  return demo ? demoDb : real;
}
export function getRealDb() {
  return real;
}
export function isDemo() {
  return demo;
}

export function enterDemo() {
  demoDb = buildDemoDb(emptyDb);
  demo = true;
  try { sessionStorage.setItem(DEMO_FLAG, '1'); } catch { /* noop */ }
  emit({ mode: true });
}
export function exitDemo() {
  demo = false;
  demoDb = null;
  try { sessionStorage.removeItem(DEMO_FLAG); } catch { /* noop */ }
  real = readReal();
  emit({ mode: true });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(info = {}) {
  for (const fn of listeners) {
    try { fn(info); } catch (e) { console.error(e); }
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * 変更を適用して保存する。保存に失敗した場合は状態を一切変えずに SaveError を投げる。
 * 別タブでの変更を上書きしないよう、実データは保存直前に最新を読み直してから適用する。
 */
export function commit(mutator, { silent = false } = {}) {
  if (demo) {
    const next = clone(demoDb);
    const result = mutator(next);
    demoDb = next;
    if (!silent) emit();
    return result;
  }
  const base = readReal();
  const next = clone(base);
  const result = mutator(next);
  next.version = 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    real = base;
    throw new SaveError(e);
  }
  real = next;
  if (!silent) emit();
  return result;
}

/** 永続化の要求（対応ブラウザのみ。ホーム画面追加時は iOS でも保持されやすい） */
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* noop */ }
  return false;
}

export function exportJson() {
  return JSON.stringify({ app: 'TripLedger', exportedAt: new Date().toISOString(), data: real }, null, 2);
}

export function importJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new UserError('ファイルを読み取れませんでした（JSON形式ではありません）'); }
  const data = parsed && parsed.data ? parsed.data : parsed;
  if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.trips)) {
    throw new UserError('このアプリのバックアップファイルではないようです');
  }
  if (demo) throw new UserError('デモ中は復元できません。通常モードに戻ってから操作してください');
  const next = normalize(data);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    throw new SaveError(e);
  }
  real = next;
  emit();
  return { trips: next.trips.length, sessions: next.sessions.length };
}

export function wipeAll() {
  if (demo) throw new UserError('デモ中は実行できません');
  const next = emptyDb();
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { throw new SaveError(e); }
  real = next;
  emit();
}
