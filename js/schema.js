// 保存データの検証。バックアップ復元（厳格：1か所でも不正なら取り込まない）と、
// 端末内データの読み込み（寛容：不正な記録だけ除外し、元データは別キーに退避）の両方で使う。
import { CURRENCY_CODES, isValidYMD } from './util.js';
import { MAX_MINUTES } from './calc.js';
import { normalizeCondition, TAG_IDS } from './tags.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max = 500) => typeof v === 'string' && v.length <= max;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100 && /^[\w-]+$/.test(v);
const isAmount = (v) => isNum(v) && v >= 0 && v <= 1e12;
const isTime = (v) => isNum(v) && v > 0 && v < 1e14;
const optStr = (v, max) => (v == null ? '' : isStr(v, max) ? v : null);
const LIVE_STATUSES = ['playing', 'break', 'settling'];

function checkRate(r, currency) {
  if (r == null) return { ok: true, value: null };
  if (currency === 'JPY') return { ok: true, value: null };
  if (!isObj(r) || !isNum(r.value) || r.value <= 0 || r.value > 1e6 || !isValidYMD(r.date)) return { ok: false };
  return {
    ok: true,
    value: {
      value: r.value, date: r.date, source: isStr(r.source, 100) ? r.source : '不明',
      ...(isStr(r.url, 200) && /^https:\/\//.test(r.url) ? { url: r.url } : {}),
      manual: r.manual === true,
      ...(r.demo === true ? { demo: true } : {}),
      ...(isStr(r.fetchedAt, 40) ? { fetchedAt: r.fetchedAt } : {}),
      ...(isStr(r.setAt, 40) ? { setAt: r.setAt } : {}),
    },
  };
}

function checkTags(tags) {
  if (tags == null) return [];
  if (!Array.isArray(tags) || tags.some((t) => !TAG_IDS.includes(t))) return null;
  return TAG_IDS.filter((id) => tags.includes(id));
}

function checkCondition(c) {
  if (c == null || c === '') return { ok: true, value: null };
  const n = normalizeCondition(c);
  return n == null || n !== c ? { ok: false } : { ok: true, value: n };
}

function checkTrip(t) {
  if (!isObj(t) || !isId(t.id)) return 'IDが不正です';
  const name = isStr(t.name, 40) ? t.name.trim() : '';
  if (!name) return '遠征名が不正です';
  if (!isValidYMD(t.startDate)) return '開始日が不正です';
  if (t.endDate != null && (!isValidYMD(t.endDate) || t.endDate < t.startDate)) return '終了日が不正です';
  if (t.expenses != null && !(isAmount(t.expenses) && Number.isInteger(t.expenses))) return '経費が不正です';
  const note = optStr(t.note, 500);
  if (note == null) return 'メモが不正です';
  return {
    id: t.id, name, startDate: t.startDate, endDate: t.endDate ?? null, expenses: t.expenses ?? null, note,
    createdAt: isTime(t.createdAt) ? t.createdAt : 1, updatedAt: isTime(t.updatedAt) ? t.updatedAt : 1,
  };
}

function checkStake(o) {
  return isNum(o.sb) && o.sb >= 0 && isNum(o.bb) && o.bb > 0 && o.sb <= o.bb && o.bb <= 1e9;
}

function checkSession(s, tripIds, strict, warn) {
  if (!isObj(s) || !isId(s.id)) return 'IDが不正です';
  if (s.tripId != null && !(isId(s.tripId) && tripIds.has(s.tripId))) return '遠征の参照が不正です';
  if (!isValidYMD(s.date)) return 'プレイ日が不正です';
  const location = isStr(s.location, 60) ? s.location.trim() : '';
  if (!location) return '場所が不正です';
  if (!CURRENCY_CODES.includes(s.currency)) return '通貨が不正です';
  if (!checkStake(s)) return 'レート（SB/BB）が不正です';
  if (!(Number.isInteger(s.minutes) && s.minutes > 0 && s.minutes <= MAX_MINUTES)) return '実プレイ時間が不正です';
  if (!isAmount(s.buyin) || !isAmount(s.cashout)) return '金額が不正です';
  if (s.timeRake != null && !isAmount(s.timeRake)) return 'タイムレーキが不正です';
  // 付随的な項目は、読み込み時（寛容）なら記録を残してその項目だけ初期化する
  let rate = checkRate(s.rate, s.currency);
  if (!rate.ok) { if (strict) return '為替レートが不正です'; warn('為替レートを換算待ちに戻しました'); rate = { value: null }; }
  let cond = checkCondition(s.condition);
  if (!cond.ok) { if (strict) return '今日の冴えが不正です'; warn('今日の冴えを未入力に戻しました'); cond = { value: null }; }
  let tags = checkTags(s.tags);
  if (tags == null) { if (strict) return 'タグが不正です'; warn('タグを外しました'); tags = []; }
  let note = optStr(s.note, 500);
  if (note == null) { if (strict) return 'メモが不正です'; warn('メモを空にしました'); note = ''; }
  const out = {
    id: s.id, tripId: s.tripId ?? null, date: s.date, location, currency: s.currency,
    sb: s.sb, bb: s.bb, minutes: s.minutes, buyin: s.buyin, cashout: s.cashout, timeRake: s.timeRake ?? 0,
    rate: rate.value, condition: cond.value, tags, note,
    createdAt: isTime(s.createdAt) ? s.createdAt : 1, updatedAt: isTime(s.updatedAt) ? s.updatedAt : 1,
  };
  if (s.startedAt != null) {
    if (!isTime(s.startedAt) || !isTime(s.endedAt) || s.endedAt < s.startedAt) return '開始・終了時刻が不正です';
    out.startedAt = s.startedAt;
    out.endedAt = s.endedAt;
    out.tz = isStr(s.tz, 64) && /^[\w/+-]*$/.test(s.tz) ? s.tz : '';
    out.breakMinutes = Number.isInteger(s.breakMinutes) && s.breakMinutes >= 0 ? s.breakMinutes : 0;
    if (Number.isInteger(s.timerMinutes) && s.timerMinutes >= 0) out.timerMinutes = s.timerMinutes;
  }
  return out;
}

function checkDraft(d) {
  if (!isObj(d)) return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (!/^[\w]{1,40}$/.test(k)) continue;
    if (typeof v === 'string' && v.length <= 600) out[k] = v;
    else if (typeof v === 'boolean' || isNum(v)) out[k] = v;
    else if (k === 'tags' && Array.isArray(v)) out.tags = v.filter((t) => TAG_IDS.includes(t));
  }
  return out;
}

function checkActive(a, tripIds) {
  if (a == null) return null;
  if (!isObj(a) || !isId(a.id)) return 'IDが不正です';
  if (!LIVE_STATUSES.includes(a.status)) return '状態が不正です';
  const location = isStr(a.location, 60) ? a.location.trim() : '';
  if (!location) return '場所が不正です';
  if (!CURRENCY_CODES.includes(a.currency) || !checkStake(a)) return '通貨・レートが不正です';
  if (!isValidYMD(a.date) || !isTime(a.startedAt)) return '開始日時が不正です';
  if (!Array.isArray(a.segments) || !a.segments.length) return 'タイマーの記録が不正です';
  let prev = 0;
  for (let i = 0; i < a.segments.length; i++) {
    const g = a.segments[i];
    const last = i === a.segments.length - 1;
    if (!isObj(g) || !isTime(g.s) || g.s < prev) return 'タイマーの記録が不正です';
    if (g.e == null) {
      if (!last || a.status !== 'playing') return 'タイマーの記録が不正です';
    } else if (!isTime(g.e) || g.e < g.s) return 'タイマーの記録が不正です';
    prev = g.e ?? g.s;
  }
  if (a.status === 'playing' && a.segments[a.segments.length - 1].e != null) return 'タイマーの記録が不正です';
  if (!Array.isArray(a.buyins) || a.buyins.some((b) => !isObj(b) || !isAmount(b.amount) || b.amount <= 0 || !isTime(b.at))) return 'バイインの記録が不正です';
  const cond = checkCondition(a.condition);
  if (!cond.ok) return '今日の冴えが不正です';
  return {
    id: a.id, tripId: a.tripId != null && tripIds.has(a.tripId) ? a.tripId : null,
    location, currency: a.currency, sb: a.sb, bb: a.bb, date: a.date,
    tz: isStr(a.tz, 64) && /^[\w/+-]*$/.test(a.tz) ? a.tz : '',
    startedAt: a.startedAt, segments: a.segments.map((g) => ({ s: g.s, e: g.e ?? null })),
    status: a.status, buyins: a.buyins.map((b) => ({ amount: b.amount, at: b.at })),
    condition: cond.value, draft: checkDraft(a.draft),
    ...(isTime(a.endedAt) ? { endedAt: a.endedAt } : {}),
  };
}

function checkPrefs(p) {
  const out = {};
  if (!isObj(p)) return out;
  if (isId(p.lastTripId)) out.lastTripId = p.lastTripId;
  if (isStr(p.lastLocation, 60)) out.lastLocation = p.lastLocation;
  if (CURRENCY_CODES.includes(p.lastCurrency)) out.lastCurrency = p.lastCurrency;
  if (isObj(p.stakes)) {
    out.stakes = {};
    for (const c of CURRENCY_CODES) if (isObj(p.stakes[c]) && checkStake(p.stakes[c])) out.stakes[c] = { sb: p.stakes[c].sb, bb: p.stakes[c].bb };
  }
  if (isObj(p.buyins)) {
    out.buyins = {};
    for (const c of CURRENCY_CODES) if (isAmount(p.buyins[c])) out.buyins[c] = p.buyins[c];
  }
  for (const k of ['lastBackupAt', 'backupSnoozeUntil', 'backupVersion']) if (isNum(p[k]) && p[k] >= 0) out[k] = p[k];
  if (p.lastBackupMethod === 'share' || p.lastBackupMethod === 'download') out.lastBackupMethod = p.lastBackupMethod;
  return out;
}

function checkRateCache(rc) {
  const out = {};
  if (!isObj(rc)) return out;
  for (const [k, v] of Object.entries(rc)) {
    const m = /^([A-Z]{3})\|(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (!m || !CURRENCY_CODES.includes(m[1]) || !isValidYMD(m[2])) continue;
    const r = checkRate(v, m[1]);
    if (r.ok && r.value && r.value.date <= m[2]) out[k] = { value: r.value.value, date: r.value.date, source: r.value.source, ...(r.value.url ? { url: r.value.url } : {}) };
  }
  return out;
}

/**
 * データ全体を検証して正規化する。
 * strict = true: 不正な記録が1件でもあれば data を返さない（復元用）
 * strict = false: 不正な記録を除外して返す（端末内データの読み込み用）
 * 戻り値: { data, problems: [文字列] }
 */
export function validateData(raw, { strict = false } = {}) {
  const problems = [];
  if (!isObj(raw) || !Array.isArray(raw.trips) || !Array.isArray(raw.sessions)) {
    return { data: null, problems: ['データの形式が正しくありません'] };
  }
  const trips = [];
  const tripIds = new Set();
  raw.trips.forEach((t, i) => {
    const r = checkTrip(t);
    if (typeof r === 'string') problems.push(`遠征${i + 1}件目：${r}`);
    else if (tripIds.has(r.id)) problems.push(`遠征${i + 1}件目：IDが重複しています`);
    else { tripIds.add(r.id); trips.push(r); }
  });
  const sessions = [];
  const sessionIds = new Set();
  raw.sessions.forEach((s, i) => {
    const r = checkSession(s, tripIds, strict, (m) => problems.push(`記録${i + 1}件目：${m}`));
    if (typeof r === 'string') problems.push(`記録${i + 1}件目：${r}`);
    else if (sessionIds.has(r.id)) problems.push(`記録${i + 1}件目：IDが重複しています`);
    else { sessionIds.add(r.id); sessions.push(r); }
  });
  let active = null;
  const a = checkActive(raw.active, tripIds);
  if (typeof a === 'string') problems.push(`進行中のセッション：${a}`);
  else active = a;
  if (active && sessionIds.has(active.id)) active = null; // 保存済みの進行中セッションは終了扱い

  const drafts = {};
  if (isObj(raw.drafts)) {
    for (const [k, v] of Object.entries(raw.drafts)) {
      if (!/^[\w:-]{1,120}$/.test(k)) continue;
      const d = checkDraft(v);
      if (d) drafts[k] = d;
    }
  }
  if (strict && problems.length) return { data: null, problems };
  return {
    data: {
      version: 1, trips, sessions, active, drafts,
      prefs: checkPrefs(raw.prefs), rateCache: checkRateCache(raw.rateCache),
      ...(isNum(raw.lastChangeAt) ? { lastChangeAt: raw.lastChangeAt } : {}),
    },
    problems,
  };
}
