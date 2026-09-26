// データ保存層：端末の localStorage に保存。デモはメモリ上だけで扱い、実データには一切書き込まない。
import { buildDemoDb } from './demo.js';
import { validateData } from './schema.js';

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
/** 別の画面・タブで先に変更された（入力内容は残す） */
export class ConflictError extends UserError {
  constructor(msg, code = '') { super(msg); this.name = 'ConflictError'; this.code = code; }
}

export function emptyDb() {
  return { version: 1, trips: [], sessions: [], active: null, drafts: {}, prefs: {}, rateCache: {} };
}

let real = null;
let demoDb = null;
let demo = false;
// デモ⇔通常の切り替えごとに増える。遅延保存が切り替え後の別データへ書き込むのを防ぐ
let generation = 0;
let quarantined = null;
const listeners = new Set();
// blocked: 壊れたデータの退避に失敗したため、元データを上書きしないよう保存を止めている
// repaired: 直して開いたことを知らせるバナーの文言（閉じるまで表示）
export const status = { storageOk: true, notice: null, blocked: false, repaired: null };

/** 端末内データの読み込み：不正な記録は除外し、元データは消さずに別キーへ退避する */
/**
 * 元データを別キーに退避する。成功するまでは status.blocked にして、元データの上書き（保存）を止める。
 */
function quarantine(raw, doneNotice, reason) {
  if (quarantined === raw) return true;
  try {
    localStorage.setItem(`${KEY}:corrupt:${Date.now()}`, raw);
    quarantined = raw; // 退避できたときだけ処理済みにする
    status.blocked = false;
    status.notice = doneNotice;
    status.repaired = doneNotice;
    return true;
  } catch {
    status.blocked = true;
    status.notice = `保存データに不正な値がありますが、元のデータを退避できなかったため、保存を止めています（空き容量不足の可能性）。表示中の内容はそのままバックアップできます。容量を空けてからアプリを開き直してください。（${reason}）`;
    return false;
  }
}

/** 端末内データの読み込み：不正な項目は直し（収支が壊れた記録は除外）、元データは消さずに退避する */
function normalize(d, raw) {
  const { data, problems } = validateData(d, { strict: false });
  if (!problems.length) {
    status.blocked = false;
    return data;
  }
  quarantine(raw, `保存データの一部に不正な値があったため、直して開きました（${problems.length}件：${problems[0]}）。元のデータは端末内に退避しています。`, problems[0]);
  return data || emptyDb();
}

/** 正常なデータで置き換えたら（復元・全削除）、停止や修復の表示を解除する */
function clearRecoveryState() {
  status.blocked = false;
  status.notice = null;
  status.repaired = null;
  quarantined = null;
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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSONとして読めない：退避できたら空で開始、退避できなければ保存を止める
    quarantine(raw, '保存データを読み込めなかったため、元のデータを端末内に退避して空の状態で開きました。バックアップがあれば設定画面から復元できます。', 'データを読み込めません');
    return emptyDb();
  }
  return normalize(parsed, raw);
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

export function modeGeneration() {
  return generation;
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
  generation++;
  try { sessionStorage.setItem(DEMO_FLAG, '1'); } catch { /* noop */ }
  emit({ mode: true });
}
export function exitDemo() {
  demo = false;
  demoDb = null;
  generation++;
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
export function commit(mutator, { silent = false, touch = !silent, gen = null } = {}) {
  // 画面を開いたときとモードが変わっていたら書き込まない（遅延保存用）
  if (gen != null && gen !== generation) return undefined;
  if (demo) {
    const next = clone(demoDb);
    if (touch) next.lastChangeAt = Date.now();
    const result = mutator(next);
    demoDb = next;
    if (!silent) emit();
    return result;
  }
  const base = readReal();
  // 読み直した最新の内容を手元にも反映する（保存が止まっても、画面は最新の状態で判断できる）
  real = base;
  if (status.blocked) throw new UserError(status.notice);
  const next = clone(base);
  // バックアップ後に変更があったかを判断するため、記録の変更時刻を残す（下書き保存などは除く）
  if (touch) next.lastChangeAt = Date.now();
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
  // 1か所でも不正があれば取り込まず、今のデータをそのまま残す
  const { data: next, problems } = validateData(data, { strict: true });
  if (!next) {
    throw new UserError(`バックアップの内容に不正な値があるため復元しませんでした（${problems.length}件：${problems.slice(0, 2).join('／')}）。今のデータはそのままです。`);
  }
  next.lastChangeAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    throw new SaveError(e);
  }
  real = next;
  clearRecoveryState();
  emit();
  return { trips: next.trips.length, sessions: next.sessions.length };
}

export function wipeAll() {
  if (demo) throw new UserError('デモ中は実行できません');
  const next = emptyDb();
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { throw new SaveError(e); }
  real = next;
  clearRecoveryState();
  emit();
}

export function dismissRepaired() {
  status.repaired = null;
}
