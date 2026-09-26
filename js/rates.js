// 為替レートの自動取得（無料・APIキー不要）
// 1. Frankfurter API（各国中央銀行の参考レート）… 主な取得元
// 2. currency-api（jsDelivr 配信の日次レート）… 1が失敗したときの予備
// どちらも「プレイ日以前で最も新しいレート」だけを採用し、未来日の値は使わない。
// 一度確定したレートはセッションに保存され、アプリを開き直しても変わらない。
import { commit, getDb, isDemo } from './store.js';
import { todayYMD, addDaysYMD } from './util.js';

export const rateState = { running: false, errors: new Map(), lastError: null, lastRunAt: null };
const listeners = new Set();
export function onRateState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((fn) => { try { fn(rateState); } catch (e) { console.error(e); } });

export const needsRate = (s) => s.currency !== 'JPY' && !s.rate;
export const isFutureDate = (s) => s.date > todayYMD();

class HttpError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}

async function fetchJson(url, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new HttpError(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

async function fromFrankfurter(cur, date) {
  const from = addDaysYMD(date, -10);
  const url = `https://api.frankfurter.dev/v2/rates?from=${from}&to=${date}&base=${cur}&quotes=JPY`;
  const arr = await fetchJson(url);
  if (!Array.isArray(arr)) throw new Error('応答の形式が想定外です');
  const hit = arr
    .filter((r) => r && r.quote === 'JPY' && typeof r.date === 'string' && r.date <= date && r.rate > 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!hit) throw new Error('プレイ日以前のレートが見つかりません');
  return { value: round6(hit.rate), date: hit.date, source: 'Frankfurter API（各国中央銀行の参考レート）', url: 'https://frankfurter.dev' };
}

async function fromCurrencyApi(cur, date) {
  const c = cur.toLowerCase();
  for (let i = 0; i < 6; i++) {
    const d = addDaysYMD(date, -i);
    try {
      const j = await fetchJson(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/${c}.json`);
      const v = j && j[c] && j[c].jpy;
      const rd = (j && j.date) || d;
      if (v > 0 && rd <= date) return { value: round6(v), date: rd, source: 'currency-api（jsDelivr配信の日次レート）', url: 'https://github.com/fawazahmed0/exchange-api' };
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
  throw new Error('プレイ日以前のレートが見つかりません');
}

async function getRate(cur, date) {
  const key = `${cur}|${date}`;
  const cached = getDb().rateCache[key];
  if (cached && cached.value > 0 && cached.date <= date) return cached;
  try {
    return await fromFrankfurter(cur, date);
  } catch (e1) {
    try {
      return await fromCurrencyApi(cur, date);
    } catch (e2) {
      const msg = e1.name === 'AbortError' || e2.name === 'AbortError' ? '通信がタイムアウトしました'
        : e1 instanceof TypeError || e2 instanceof TypeError ? '通信に失敗しました'
          : e2.message || e1.message || '取得に失敗しました';
      throw new Error(msg);
    }
  }
}

let current = null;
let queued = null;

/**
 * 換算待ちのセッションのレートを取得する。
 * only: 対象セッションidの配列（省略時はすべての換算待ち）
 */
export function resolvePending({ only } = {}) {
  if (isDemo()) return Promise.resolve({ skipped: 'demo' });
  // 取得中に呼ばれた分は、終わった後の1回にまとめる（日付の変更などで増えた対象を取りにいく）。
  // その1回では、直前に失敗した通貨・日付は取り直さない（失敗直後に同じ通信を繰り返さない）
  if (current) {
    if (!queued) {
      queued = current.catch(() => {}).then((prev) => {
        queued = null;
        return start(undefined, (prev && prev.failedKeys) || []);
      });
    }
    return queued;
  }
  return start(only, []);
}

function start(only, skipKeys) {
  current = run(only, skipKeys).finally(() => {
    current = null;
    rateState.running = false;
    rateState.lastRunAt = Date.now();
    notify();
  });
  return current;
}

async function run(only, skipKeys = []) {
  const db = getDb();
  const today = todayYMD();
  const targets = db.sessions.filter((s) => needsRate(s) && s.date <= today && (!only || only.includes(s.id)) && !skipKeys.includes(`${s.currency}|${s.date}`));
  if (!targets.length) return { fetched: 0, failed: 0, failedKeys: [] };
  if (navigator.onLine === false) {
    rateState.lastError = 'オフラインのため為替を取得できません。接続が戻ると自動で再取得します。';
    notify();
    return { offline: true };
  }
  rateState.running = true;
  rateState.lastError = null;
  notify();

  const groups = new Map();
  for (const s of targets) {
    const k = `${s.currency}|${s.date}`;
    if (!groups.has(k)) groups.set(k, { cur: s.currency, date: s.date, ids: [] });
    groups.get(k).ids.push(s.id);
  }
  let fetched = 0;
  let failed = 0;
  const failedKeys = [];
  for (const g of groups.values()) {
    try {
      const rate = await getRate(g.cur, g.date);
      const fetchedAt = new Date().toISOString();
      commit((d) => {
        d.rateCache[`${g.cur}|${g.date}`] = { value: rate.value, date: rate.date, source: rate.source, url: rate.url };
        for (const s of d.sessions) {
          // 取得中に編集・手入力された場合は上書きしない
          if (s.currency === g.cur && s.date === g.date && !s.rate) {
            s.rate = { value: rate.value, date: rate.date, source: rate.source, url: rate.url, manual: false, fetchedAt };
          }
        }
      });
      g.ids.forEach((id) => rateState.errors.delete(id));
      fetched += g.ids.length;
    } catch (e) {
      failed += g.ids.length;
      failedKeys.push(`${g.cur}|${g.date}`);
      const msg = e.name === 'SaveError' ? '取得したレートを保存できませんでした' : e.message;
      g.ids.forEach((id) => rateState.errors.set(id, msg));
      rateState.lastError = `一部のレートを取得できませんでした（${msg}）`;
    }
  }
  return { fetched, failed, failedKeys };
}

let lastAuto = 0;
/** 自動再取得（起動時・再接続時・画面復帰時） */
export function autoResolve(force = false) {
  if (!force && Date.now() - lastAuto < 60_000) return;
  lastAuto = Date.now();
  resolvePending().catch((e) => console.warn(e));
}
