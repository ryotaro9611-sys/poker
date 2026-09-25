// 成績計算（純粋関数のみ。UI・保存処理に依存しない）
import { CURRENCY_CODES, isValidYMD, parseNumber } from './util.js';

const round2 = (x) => Math.round(x * 100) / 100;

/** ポーカー収支 = キャッシュアウト − バイイン − 別払いタイムレーキ（現地通貨） */
export function sessionProfit(s) {
  return round2(s.cashout - s.buyin - (s.timeRake || 0));
}

/** 採用した「1現地通貨 = 何円」。JPYは常に1、未取得は null（換算待ち） */
export function sessionRate(s) {
  if (s.currency === 'JPY') return 1;
  return s.rate && Number.isFinite(s.rate.value) && s.rate.value > 0 ? s.rate.value : null;
}

export function sessionProfitJPY(s) {
  const r = sessionRate(s);
  return r == null ? null : round2(sessionProfit(s) * r);
}

export function sessionBB(s) {
  return sessionProfit(s) / s.bb;
}

export function isPending(s) {
  return sessionRate(s) == null;
}

export function perHour(total, minutes) {
  return minutes > 0 ? total / (minutes / 60) : null;
}

/**
 * セッション群の集計。
 * 時給・bb/時間は「合計 ÷ 合計時間」で算出（セッションごとの値の平均ではない）。
 * 円は換算済みのみを合算し、換算待ちは件数として別に返す（0円扱いしない）。
 */
export function summarize(sessions) {
  const out = {
    count: 0, minutes: 0, bb: 0, wins: 0, losses: 0,
    jpy: { count: 0, minutes: 0, profit: 0, pending: 0, pendingMinutes: 0 },
    byCurrency: {},
  };
  for (const s of sessions) {
    const p = sessionProfit(s);
    out.count++;
    out.minutes += s.minutes;
    out.bb += sessionBB(s);
    if (p > 0) out.wins++;
    else if (p < 0) out.losses++;
    const pj = sessionProfitJPY(s);
    if (pj == null) {
      out.jpy.pending++;
      out.jpy.pendingMinutes += s.minutes;
    } else {
      out.jpy.count++;
      out.jpy.minutes += s.minutes;
      out.jpy.profit += pj;
    }
    const c = (out.byCurrency[s.currency] ||= { currency: s.currency, count: 0, minutes: 0, profit: 0, bb: 0 });
    c.count++;
    c.minutes += s.minutes;
    c.profit = round2(c.profit + p);
    c.bb += sessionBB(s);
  }
  out.jpy.profit = round2(out.jpy.profit);
  out.bb = Math.round(out.bb * 1e6) / 1e6;
  out.bbPerHour = perHour(out.bb, out.minutes);
  out.jpy.hourly = perHour(out.jpy.profit, out.jpy.minutes);
  for (const c of Object.values(out.byCurrency)) {
    c.bb = Math.round(c.bb * 1e6) / 1e6;
    c.hourly = perHour(c.profit, c.minutes);
    c.bbPerHour = perHour(c.bb, c.minutes);
  }
  return out;
}

/** 遠征全体の損益 = 円換算ポーカー収支合計 − 遠征経費（円） */
export function tripResult(trip, sessions) {
  const own = sessions.filter((s) => s.tripId === trip.id);
  const sum = summarize(own);
  const hasExpenses = trip.expenses != null && Number.isFinite(trip.expenses);
  const net = round2(sum.jpy.profit - (hasExpenses ? trip.expenses : 0));
  const reasons = [];
  if (!hasExpenses) reasons.push('経費未入力');
  if (sum.jpy.pending > 0) reasons.push(`換算待ち${sum.jpy.pending}件`);
  return { sessions: own, summary: sum, expenses: hasExpenses ? trip.expenses : null, net, provisional: reasons.length > 0, reasons };
}

/** 並び順：プレイ日 → 開始時刻 → 作成時刻 */
export function sortSessions(list, dir = 1) {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -dir : dir;
    const ta = a.startedAt || a.createdAt || 0;
    const tb = b.startedAt || b.createdAt || 0;
    return (ta - tb) * dir;
  });
}

/**
 * 日付順の累積推移（期間の開始を0とする）。
 * mode: 'JPY'（円換算。換算待ちは除外）または通貨コード（その通貨のみ）
 */
export function cumulativeSeries(sessions, mode) {
  const byDate = new Map();
  for (const s of sortSessions(sessions)) {
    let v;
    if (mode === 'JPY') {
      v = sessionProfitJPY(s);
      if (v == null) continue;
    } else {
      if (s.currency !== mode) continue;
      v = sessionProfit(s);
    }
    const e = byDate.get(s.date) || { date: s.date, day: 0, count: 0 };
    e.day = round2(e.day + v);
    e.count++;
    byDate.set(s.date, e);
  }
  let cum = 0;
  return [...byDate.values()].map((e) => {
    cum = round2(cum + e.day);
    return { ...e, cum };
  });
}

export function stakeKey(s) {
  return `${s.currency}|${Number(s.sb)}|${Number(s.bb)}`;
}
export function locationKey(s) {
  return (s.location || '').trim().toLowerCase();
}

/** キーごとにグループ化して集計 */
export function groupSummaries(sessions, keyFn, labelFn) {
  const groups = new Map();
  for (const s of sessions) {
    const k = keyFn(s);
    if (!groups.has(k)) groups.set(k, { key: k, label: labelFn(s), sessions: [] });
    groups.get(k).sessions.push(s);
  }
  return [...groups.values()].map((g) => ({ ...g, summary: summarize(g.sessions) }));
}

/* ---------- 入力検証 ---------- */

export const MAX_MINUTES = 72 * 60;

/**
 * セッション入力の検証。raw は文字列のフォーム値。
 * 戻り値 { ok, errors: {field: message}, value }
 */
export function validateSession(raw) {
  const errors = {};
  const v = {};
  if (!isValidYMD(raw.date)) errors.date = 'プレイ日を入力してください';
  else v.date = raw.date;

  const loc = String(raw.location ?? '').trim();
  if (!loc) errors.location = '場所・店舗名を入力してください';
  else if (loc.length > 60) errors.location = '60文字以内で入力してください';
  else v.location = loc;

  if (!CURRENCY_CODES.includes(raw.currency)) errors.currency = '通貨を選択してください';
  else v.currency = raw.currency;

  const sb = parseNumber(raw.sb, { min: 0 });
  const bb = parseNumber(raw.bb, { min: 0 });
  if (!sb.ok) errors.sb = sb.error;
  else v.sb = sb.value;
  if (!bb.ok) errors.bb = bb.error;
  else if (bb.value <= 0) errors.bb = 'BBは0より大きい値にしてください';
  else v.bb = bb.value;
  if (v.sb != null && v.bb != null && v.sb > v.bb) errors.sb = 'SBはBB以下にしてください';

  const h = parseNumber(raw.hours, { min: 0, allowEmpty: true, integer: true, max: 72 });
  const m = parseNumber(raw.mins, { min: 0, allowEmpty: true, integer: true, max: 59 });
  if (!h.ok) errors.duration = h.error === '値が大きすぎます' ? '72時間以内で入力してください' : '時間：' + h.error;
  else if (!m.ok) errors.duration = m.error === '値が大きすぎます' ? '分は0〜59で入力してください' : '分：' + m.error;
  else {
    const total = (h.value || 0) * 60 + (m.value || 0);
    if (total <= 0) errors.duration = '実プレイ時間を入力してください（0より大きい値）';
    else if (total > MAX_MINUTES) errors.duration = '72時間以内で入力してください';
    else v.minutes = total;
  }

  const bi = parseNumber(raw.buyin, { min: 0 });
  const co = parseNumber(raw.cashout, { min: 0 });
  const tr = parseNumber(raw.timeRake, { min: 0, allowEmpty: true });
  if (!bi.ok) errors.buyin = bi.error;
  else v.buyin = bi.value;
  if (!co.ok) errors.cashout = co.error;
  else v.cashout = co.value;
  if (!tr.ok) errors.timeRake = tr.error;
  else v.timeRake = tr.value ?? 0;

  v.tripId = raw.tripId || null;
  v.note = String(raw.note ?? '').trim().slice(0, 500);

  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

export function validateTrip(raw) {
  const errors = {};
  const v = {};
  const name = String(raw.name ?? '').trim();
  if (!name) errors.name = '遠征名を入力してください';
  else if (name.length > 40) errors.name = '40文字以内で入力してください';
  else v.name = name;
  if (!isValidYMD(raw.startDate)) errors.startDate = '開始日を入力してください';
  else v.startDate = raw.startDate;
  if (raw.endDate) {
    if (!isValidYMD(raw.endDate)) errors.endDate = '日付が正しくありません';
    else if (v.startDate && raw.endDate < v.startDate) errors.endDate = '終了日は開始日以降にしてください';
    else v.endDate = raw.endDate;
  } else v.endDate = null;
  const ex = parseNumber(raw.expenses, { min: 0, allowEmpty: true, maxDecimals: 0 });
  if (!ex.ok) errors.expenses = ex.error === '小数は0桁までです' ? '円単位（整数）で入力してください' : ex.error;
  else v.expenses = ex.value; // null = 未入力（0円とは区別）
  v.note = String(raw.note ?? '').trim().slice(0, 500);
  return { ok: Object.keys(errors).length === 0, errors, value: v };
}
