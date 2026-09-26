// 保存データの検証。
// ・バックアップ復元（strict）：1か所でも不正があれば取り込まない
// ・端末内データの読み込み（寛容）：収支そのもの（日付・通貨・金額・時間・レート）が壊れた記録だけ除外し、
//   メモ・冴え・タグ・遠征の参照・為替などの付随項目は、その項目だけ初期化して記録を残す
// 入力画面の検証（calc.js / util.js）と同じ上限を使い、アプリ自身が保存した値を拒否しないようにする。
import { CURRENCY_CODES, isValidYMD, ymdFromDate, ymdInTz, MAX_NUMBER } from './util.js';
import { MAX_MINUTES } from './calc.js';
import { normalizeCondition, TAG_IDS } from './tags.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max = 500) => typeof v === 'string' && v.length <= max;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100 && /^[\w-]+$/.test(v);
const isAmount = (v) => isNum(v) && v >= 0 && v <= MAX_NUMBER;
const isTime = (v) => isNum(v) && v > 0 && v < 1e14;
const isTz = (v) => isStr(v, 64) && /^[\w/+-]*$/.test(v);
const LIVE_STATUSES = ['playing', 'break', 'settling'];

/** 記録ごと除外する不正 */
class Bad extends Error {}

/**
 * 項目の不正を扱う。strict なら記録ごと不正、寛容なら fallback を使い、何をしたかを problems に残す
 */
function makeCtx(strict, problems, label) {
  return {
    fail(msg) { throw new Bad(msg); },
    soft(msg, fallback, done) {
      if (strict) throw new Bad(msg);
      problems.push(`${label}：${done}`);
      return fallback;
    },
  };
}

function checkStake(o) {
  return isNum(o.sb) && o.sb >= 0 && isNum(o.bb) && o.bb > 0 && o.sb <= o.bb && o.bb <= MAX_NUMBER;
}

function checkRate(r, currency, playDate, ctx) {
  if (r == null || currency === 'JPY') return null;
  const ok = isObj(r) && isNum(r.value) && r.value > 0 && r.value <= MAX_NUMBER && isValidYMD(r.date) && r.date <= playDate;
  if (!ok) return ctx.soft('為替レートが不正です（プレイ日より後の日付を含む）', null, '為替レートを換算待ちに戻しました');
  return {
    value: r.value, date: r.date, source: isStr(r.source, 100) ? r.source : '不明',
    ...(isStr(r.url, 200) && /^https:\/\//.test(r.url) ? { url: r.url } : {}),
    manual: r.manual === true,
    ...(r.demo === true ? { demo: true } : {}),
    ...(isStr(r.fetchedAt, 40) ? { fetchedAt: r.fetchedAt } : {}),
    ...(isStr(r.setAt, 40) ? { setAt: r.setAt } : {}),
  };
}

function checkCondition(c, ctx) {
  if (c == null || c === '') return null;
  const n = normalizeCondition(c);
  if (n == null || n !== c) return ctx.soft('今日の冴えが不正です', null, '今日の冴えを未入力に戻しました');
  return n;
}

function checkTags(tags, ctx) {
  if (tags == null) return [];
  if (!Array.isArray(tags) || tags.some((t) => !TAG_IDS.includes(t))) {
    return ctx.soft('タグが不正です', Array.isArray(tags) ? TAG_IDS.filter((id) => tags.includes(id)) : [], '不明なタグを外しました');
  }
  return TAG_IDS.filter((id) => tags.includes(id));
}

function checkText(v, max, ctx, what) {
  if (v == null) return '';
  if (typeof v !== 'string') return ctx.soft(`${what}が不正です`, '', `${what}を空にしました`);
  if (v.length > max) return ctx.soft(`${what}が長すぎます`, v.slice(0, max), `${what}を${max}文字に切り詰めました`);
  return v;
}

function checkLocation(v, ctx) {
  const loc = typeof v === 'string' ? v.trim() : '';
  if (!loc) return ctx.soft('場所が不正です', '場所不明', '場所を「場所不明」にしました');
  if (loc.length > 60) return ctx.soft('場所が長すぎます', loc.slice(0, 60), '場所を60文字に切り詰めました');
  return loc;
}

function checkTripRef(id, tripIds, ctx) {
  if (id == null || id === '') return null;
  if (!isId(id) || !tripIds.has(id)) return ctx.soft('遠征の参照が不正です', null, '該当する遠征がないため「遠征なし」にしました');
  return id;
}

function checkTrip(t, ctx) {
  if (!isObj(t) || !isId(t.id)) ctx.fail('IDが不正です');
  if (!isValidYMD(t.startDate)) ctx.fail('開始日が不正です');
  let name = typeof t.name === 'string' ? t.name.trim() : '';
  if (!name || name.length > 40) name = ctx.soft('遠征名が不正です', name ? name.slice(0, 40) : '名称不明の遠征', '遠征名を直しました');
  let endDate = t.endDate ?? null;
  if (endDate != null && (!isValidYMD(endDate) || endDate < t.startDate)) endDate = ctx.soft('終了日が不正です', null, '終了日を未定に戻しました');
  let expenses = t.expenses ?? null;
  if (expenses != null && !(isAmount(expenses) && Number.isInteger(expenses))) expenses = ctx.soft('経費が不正です', null, '経費を未入力に戻しました');
  return {
    id: t.id, name, startDate: t.startDate, endDate, expenses, note: checkText(t.note, 500, ctx, 'メモ'),
    createdAt: isTime(t.createdAt) ? t.createdAt : 1, updatedAt: isTime(t.updatedAt) ? t.updatedAt : 1,
  };
}

function checkSession(s, tripIds, ctx) {
  if (!isObj(s) || !isId(s.id)) ctx.fail('IDが不正です');
  // 収支そのものに関わる項目：壊れていれば記録ごと除外（推測で埋めない）
  if (!isValidYMD(s.date)) ctx.fail('プレイ日が不正です');
  if (!CURRENCY_CODES.includes(s.currency)) ctx.fail('通貨が不正です');
  if (!checkStake(s)) ctx.fail('レート（SB/BB）が不正です');
  if (!(Number.isInteger(s.minutes) && s.minutes > 0 && s.minutes <= MAX_MINUTES)) ctx.fail('実プレイ時間が不正です');
  if (!isAmount(s.buyin) || !isAmount(s.cashout)) ctx.fail('金額が不正です');
  if (s.timeRake != null && !isAmount(s.timeRake)) ctx.fail('タイムレーキが不正です');
  const out = {
    id: s.id, tripId: checkTripRef(s.tripId, tripIds, ctx), date: s.date, location: checkLocation(s.location, ctx), currency: s.currency,
    sb: s.sb, bb: s.bb, minutes: s.minutes, buyin: s.buyin, cashout: s.cashout, timeRake: s.timeRake ?? 0,
    rate: checkRate(s.rate, s.currency, s.date, ctx), condition: checkCondition(s.condition, ctx), tags: checkTags(s.tags, ctx),
    note: checkText(s.note, 500, ctx, 'メモ'),
    createdAt: isTime(s.createdAt) ? s.createdAt : 1, updatedAt: isTime(s.updatedAt) ? s.updatedAt : 1,
  };
  if (s.startedAt != null) {
    if (!isTime(s.startedAt) || !isTime(s.endedAt) || s.endedAt < s.startedAt) {
      ctx.soft('開始・終了時刻が不正です', null, '開始・終了時刻の情報を外しました');
    } else {
      out.startedAt = s.startedAt;
      out.endedAt = s.endedAt;
      out.tz = isTz(s.tz) ? s.tz : '';
      out.breakMinutes = Number.isInteger(s.breakMinutes) && s.breakMinutes >= 0 ? s.breakMinutes : 0;
      if (Number.isInteger(s.timerMinutes) && s.timerMinutes >= 0) out.timerMinutes = s.timerMinutes;
    }
  }
  return out;
}

/** 下書き：項目ごとに型を決めて検証する */
const DRAFT_TEXT = [
  'tripId', 'date', 'location', 'currency', 'sb', 'bb', 'hours', 'mins', 'buyin', 'cashout', 'timeRake', 'note', 'condition',
  'name', 'startDate', 'endDate', 'expenses',
];
const DRAFT_BOOL = ['durationEdited', 'buyinEdited'];

function checkDraft(d, ctx) {
  if (d == null) return null;
  if (!isObj(d)) return ctx.soft('下書きが不正です', null, '下書きを破棄しました');
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (DRAFT_TEXT.includes(k)) {
      if (isStr(v, 600)) out[k] = v;
      else ctx.soft(`下書きの「${k}」が不正です`, null, `下書きの「${k}」を外しました`);
    } else if (DRAFT_BOOL.includes(k)) {
      if (typeof v === 'boolean') out[k] = v;
      else ctx.soft(`下書きの「${k}」が不正です`, null, `下書きの「${k}」を外しました`);
    } else if (k === 'tags') {
      if (Array.isArray(v) && v.every((t) => TAG_IDS.includes(t))) out.tags = TAG_IDS.filter((id) => v.includes(id));
      else ctx.soft('下書きのタグが不正です', null, '下書きのタグを外しました');
    } else if (k === 'savedAt') {
      if (isTime(v)) out.savedAt = v;
    } else {
      ctx.soft(`下書きに不明な項目「${String(k).slice(0, 20)}」があります`, null, '下書きの不明な項目を外しました');
    }
  }
  return out;
}

/** タイマーの区間を修復（寛容な読み込み用）。終わっていない区間は最後の1つだけにする */
function repairSegments(a, ctx) {
  const segs = (Array.isArray(a.segments) ? a.segments : [])
    .filter((g) => isObj(g) && isTime(g.s))
    .map((g) => ({ s: g.s, e: isTime(g.e) && g.e >= g.s ? g.e : null }))
    .sort((x, y) => x.s - y.s);
  if (!segs.length) ctx.fail('タイマーの記録が不正です');
  for (let i = 0; i < segs.length - 1; i++) {
    const next = segs[i + 1].s;
    if (segs[i].e == null || segs[i].e > next) segs[i].e = next;
  }
  const last = segs[segs.length - 1];
  let status = a.status;
  if (status === 'playing' && last.e != null) status = 'break';
  if (status !== 'playing' && last.e == null) last.e = isTime(a.endedAt) && a.endedAt >= last.s ? a.endedAt : last.s;
  return { segs, status };
}

function segmentsValid(a) {
  if (!Array.isArray(a.segments) || !a.segments.length) return false;
  let prev = 0;
  for (let i = 0; i < a.segments.length; i++) {
    const g = a.segments[i];
    const last = i === a.segments.length - 1;
    if (!isObj(g) || !isTime(g.s) || g.s < prev) return false;
    if (g.e == null) {
      if (!last || a.status !== 'playing') return false;
    } else if (!isTime(g.e) || g.e < g.s) return false;
    prev = g.e ?? g.s;
  }
  return !(a.status === 'playing' && a.segments[a.segments.length - 1].e != null);
}

function checkActive(a, tripIds, ctx) {
  if (!isObj(a) || !isId(a.id)) ctx.fail('IDが不正です');
  if (!LIVE_STATUSES.includes(a.status)) ctx.fail('状態が不正です');
  if (!CURRENCY_CODES.includes(a.currency) || !checkStake(a)) ctx.fail('通貨・レートが不正です');
  if (!isTime(a.startedAt)) ctx.fail('開始日時が不正です');
  // 時間・状態・金額の意味が変わる修復は、タイマー自体に残して画面で知らせる（利用者が確認するまで消さない）
  let repairs = [];
  if (a.repairs != null) {
    const okRepair = (m) => isStr(m, 200) && m.length > 0;
    if (!Array.isArray(a.repairs) || a.repairs.length > 10 || !a.repairs.every(okRepair)) {
      repairs = ctx.soft('修復履歴が不正です', Array.isArray(a.repairs) ? a.repairs.filter(okRepair).slice(0, 10) : [], '修復履歴の不正な項目を外しました');
    } else repairs = [...a.repairs];
  }
  const note = (m) => { if (!repairs.includes(m)) repairs.push(m); };

  let segs = a.segments;
  let status = a.status;
  if (!segmentsValid(a)) {
    ({ segs, status } = ctx.soft('タイマーの記録が不正です', repairSegments(a, ctx), 'タイマーの記録を修復しました'));
    note(status !== a.status
      ? 'プレイ中の記録が途中で止まっていたため「休憩中」にしました。実プレイ時間を確認してください。'
      : 'タイマーの記録が壊れていたため修復しました。実プレイ時間を確認してください。');
  }

  // バイイン：金額が有効なら残す（日時だけ壊れていれば開始時刻にする）。金額が読めないものは外して知らせる
  let buyins = [];
  const rawBuyins = Array.isArray(a.buyins) ? a.buyins : null;
  if (!rawBuyins) ctx.soft('バイインの記録が不正です', null, 'バイインの記録を初期化しました');
  let unreadable = rawBuyins ? 0 : 1;
  let undated = 0;
  for (const b of rawBuyins || []) {
    if (!isObj(b) || !isAmount(b.amount) || b.amount <= 0) { unreadable++; continue; }
    if (!isTime(b.at)) undated++;
    buyins.push({ amount: b.amount, at: isTime(b.at) ? b.at : a.startedAt });
  }
  if (unreadable && rawBuyins) {
    ctx.soft('バイインの記録が不正です', null, '金額が読めないバイインの記録を外しました');
    note(`金額が読めないバイインの記録が${unreadable}件あったため外しました。合計バイインを確認してください。`);
  } else if (!rawBuyins) {
    note('バイインの記録が壊れていたため空にしました。合計バイインを確認してください。');
  }
  if (undated) {
    ctx.soft('バイインの日時が不正です', null, 'バイインの日時を開始時刻にしました');
    note('日時が不明なバイインの記録があったため、開始時刻の記録にしました。');
  }

  let date = a.date;
  if (!isValidYMD(date)) {
    // 記録したタイムゾーン（開始地）が分かれば、その土地の日付で直す（帰国後の端末のタイムゾーンは使わない）
    const tz = isTz(a.tz) && a.tz ? a.tz : null;
    date = ctx.soft('開始日が不正です', tz ? ymdInTz(a.startedAt, tz) : ymdFromDate(new Date(a.startedAt)), '開始日を開始時刻から直しました');
    note('プレイ日が壊れていたため、開始時刻の日付にしました。プレイ日を確認してください。');
  }
  let endedAt = isTime(a.endedAt) ? a.endedAt : null;
  if (status === 'settling' && endedAt == null) {
    endedAt = ctx.soft('終了時刻が不正です', segs[segs.length - 1].e, '終了時刻を直しました');
    note('終了時刻が壊れていたため、最後の記録から直しました。実プレイ時間を確認してください。');
  }
  const location = checkLocation(a.location, ctx);
  if (location !== (typeof a.location === 'string' ? a.location.trim() : '')) note(`場所の記録が壊れていたため「${location}」にしました。`);
  return {
    id: a.id, tripId: checkTripRef(a.tripId, tripIds, ctx),
    location, currency: a.currency, sb: a.sb, bb: a.bb, date,
    tz: isTz(a.tz) ? a.tz : '',
    startedAt: a.startedAt, segments: segs.map((g) => ({ s: g.s, e: g.e ?? null })),
    status, buyins,
    condition: checkCondition(a.condition, ctx), draft: checkDraft(a.draft, ctx),
    rev: Number.isInteger(a.rev) && a.rev >= 0 ? a.rev : 0,
    ...(endedAt != null ? { endedAt } : {}),
    ...(repairs.length ? { repairs } : {}),
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
  const quiet = { soft: () => null, fail: () => { throw new Bad(''); } };
  for (const [k, v] of Object.entries(rc)) {
    const m = /^([A-Z]{3})\|(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (!m || !CURRENCY_CODES.includes(m[1]) || !isValidYMD(m[2])) continue;
    const r = checkRate(v, m[1], m[2], quiet);
    if (r) out[k] = { value: r.value, date: r.date, source: r.source, ...(r.url ? { url: r.url } : {}) };
  }
  return out;
}

function each(list, labelOf, strict, problems, fn) {
  const out = [];
  list.forEach((item, i) => {
    const label = labelOf(i);
    try {
      out.push(fn(item, makeCtx(strict, problems, label)));
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      problems.push(`${label}：${e.message}`);
    }
  });
  return out;
}

/**
 * データ全体を検証して正規化する。
 * 戻り値: { data, problems: [文字列] }（strict で問題があれば data は null）
 */
export function validateData(raw, { strict = false } = {}) {
  const problems = [];
  if (!isObj(raw) || !Array.isArray(raw.trips) || !Array.isArray(raw.sessions)) {
    return { data: null, problems: ['データの形式が正しくありません'] };
  }
  const trips = [];
  const tripIds = new Set();
  for (const t of each(raw.trips, (i) => `遠征${i + 1}件目`, strict, problems, (t, ctx) => checkTrip(t, ctx))) {
    if (tripIds.has(t.id)) problems.push(`遠征「${t.name}」：IDが重複しています`);
    else { tripIds.add(t.id); trips.push(t); }
  }
  const sessions = [];
  const sessionIds = new Set();
  for (const s of each(raw.sessions, (i) => `記録${i + 1}件目`, strict, problems, (s, ctx) => checkSession(s, tripIds, ctx))) {
    if (sessionIds.has(s.id)) problems.push(`記録（${s.date} ${s.location}）：IDが重複しています`);
    else { sessionIds.add(s.id); sessions.push(s); }
  }
  let active = null;
  if (raw.active != null) {
    [active = null] = each([raw.active], () => '進行中のセッション', strict, problems, (a, ctx) => checkActive(a, tripIds, ctx));
  }
  if (active && sessionIds.has(active.id)) active = null; // 保存済みの進行中セッションは終了扱い

  const drafts = {};
  if (raw.drafts != null) {
    if (!isObj(raw.drafts)) problems.push('下書き：形式が不正です');
    else {
      for (const [k, v] of Object.entries(raw.drafts)) {
        if (!/^[\w:-]{1,120}$/.test(k)) { problems.push('下書き：不明な項目があります'); continue; }
        const [d] = each([v], () => `下書き（${k}）`, strict, problems, (x, ctx) => checkDraft(x, ctx));
        if (d) drafts[k] = d;
      }
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
