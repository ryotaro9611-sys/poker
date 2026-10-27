// 成績計算（純粋関数のみ。UI・保存処理に依存しない）
import { CURRENCY_CODES, isValidYMD, parseNumber } from './util.js';
import { normalizeCondition, normalizeTags } from './tags.js';

const round2 = (x) => Math.round(x * 100) / 100;

/* ---------- 定額卓（台湾式）：テーブル額を払うと、その 1/11 が料金、残りがチップ ---------- */
export const FIXED_TABLES = [3300, 6600, 11000, 22000, 33000];
export const isFixed = (s) => !!s && s.format === 'fixed';
/** テーブル額から1回あたりの料金の初期値（チップ額の10%）を出す。例：6,600 → 600 */
export function defaultFee(table) {
  return Math.round(table / 11);
}
/** 定額卓の金額：チップ代の合計（buyin）と料金の合計（timeRake） */
export function fixedAmounts(table, fee, count) {
  return { buyin: round2((table - fee) * count), timeRake: round2(fee * count) };
}

/**
 * ポーカー収支 = キャッシュアウト − バイイン − 別払いの料金（タイムレーキ） ＋ レーキバック（現地通貨）
 * 定額卓では、バイイン＝チップ代、別払いの料金＝テーブル額に含まれる料金。
 */
export function sessionProfit(s) {
  return round2(s.cashout - s.buyin - (s.timeRake || 0) + (s.rakeback || 0));
}
/** 料金を引く前の収支（卓上の収支）＝ キャッシュアウト − バイイン */
export function sessionTableProfit(s) {
  return round2(s.cashout - s.buyin);
}
/** 実際に払った額の合計（チップ代＋料金）。ROI の分母 */
export function sessionPaid(s) {
  return round2(s.buyin + (s.timeRake || 0));
}
/** 料金を払った回数：定額卓はバイイン回数、それ以外は別払いの料金があれば1回 */
export function sessionFeeCount(s) {
  if (isFixed(s)) return s.buyinCount || 0;
  return (s.timeRake || 0) > 0 ? 1 : 0;
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

/** 獲得bb。ブラインドを記録していない記録（定額卓など）は null */
export function sessionBB(s) {
  return s.bb > 0 ? sessionProfit(s) / s.bb : null;
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
  const money = () => ({ profit: 0, tableProfit: 0, fee: 0, rakeback: 0, paid: 0 });
  const out = {
    count: 0, minutes: 0, bb: 0, bbMinutes: 0, bbCount: 0, wins: 0, losses: 0, feeCount: 0,
    jpy: { count: 0, minutes: 0, pending: 0, pendingMinutes: 0, feeCount: 0, ...money() },
    byCurrency: {},
  };
  // 円換算は記録ごとに丸めてから足す（sessionProfitJPY と同じ。合計の端数がずれないように）
  const addMoney = (o, s, rate) => {
    const conv = (x) => round2(x * rate);
    o.profit = round2(o.profit + conv(sessionProfit(s)));
    o.tableProfit = round2(o.tableProfit + conv(sessionTableProfit(s)));
    o.fee = round2(o.fee + conv(s.timeRake || 0));
    o.rakeback = round2(o.rakeback + conv(s.rakeback || 0));
    o.paid = round2(o.paid + conv(sessionPaid(s)));
  };
  for (const s of sessions) {
    const p = sessionProfit(s);
    const bbv = sessionBB(s);
    out.count++;
    out.minutes += s.minutes;
    out.feeCount += sessionFeeCount(s);
    if (bbv != null) { out.bb += bbv; out.bbMinutes += s.minutes; out.bbCount++; }
    if (p > 0) out.wins++;
    else if (p < 0) out.losses++;
    const rate = sessionRate(s);
    if (rate == null) {
      out.jpy.pending++;
      out.jpy.pendingMinutes += s.minutes;
    } else {
      out.jpy.count++;
      out.jpy.minutes += s.minutes;
      out.jpy.feeCount += sessionFeeCount(s); // 円換算の料金に対応する回数（換算済みの分だけ）
      addMoney(out.jpy, s, rate);
    }
    const c = (out.byCurrency[s.currency] ||= { currency: s.currency, count: 0, minutes: 0, bb: 0, bbMinutes: 0, feeCount: 0, ...money() });
    c.count++;
    c.minutes += s.minutes;
    c.feeCount += sessionFeeCount(s);
    addMoney(c, s, 1);
    if (bbv != null) { c.bb += bbv; c.bbMinutes += s.minutes; }
  }
  // 時給・bb/時間・ROI は「合計 ÷ 合計」（bb はブラインドを記録した分の時間で割る）
  const finish = (o) => {
    o.hourly = perHour(o.profit, o.minutes);
    o.netFee = round2(o.fee - o.rakeback);
    o.feePerHour = perHour(o.netFee, o.minutes);
    o.roi = o.paid > 0 ? o.profit / o.paid : null;
  };
  out.bb = Math.round(out.bb * 1e6) / 1e6;
  out.bbPerHour = perHour(out.bb, out.bbMinutes);
  finish(out.jpy);
  for (const c of Object.values(out.byCurrency)) {
    c.bb = Math.round(c.bb * 1e6) / 1e6;
    c.bbPerHour = perHour(c.bb, c.bbMinutes);
    finish(c);
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
 * 1セッションの値。mode: 'JPY'（円換算。換算待ちは null）/ 'BB'（獲得bb）/ 通貨コード（その通貨以外は null）
 */
export function sessionValue(s, mode) {
  if (mode === 'JPY') return sessionProfitJPY(s);
  if (mode === 'BB') return sessionBB(s);
  return s.currency === mode ? sessionProfit(s) : null;
}

/**
 * 日付順の累積推移（期間の開始を0とする）。
 * mode: 'JPY'（円換算。換算待ちは除外）/ 'BB' / 通貨コード（その通貨のみ）
 */
export function cumulativeSeries(sessions, mode) {
  const byDate = new Map();
  for (const s of sortSessions(sessions)) {
    const v = sessionValue(s, mode);
    if (v == null) continue;
    const e = byDate.get(s.date) || { date: s.date, day: 0, count: 0 };
    e.day = mode === 'BB' ? e.day + v : round2(e.day + v);
    e.count++;
    byDate.set(s.date, e);
  }
  let cum = 0;
  return [...byDate.values()].map((e) => {
    cum = mode === 'BB' ? Math.round((cum + e.day) * 1e6) / 1e6 : round2(cum + e.day);
    return { ...e, day: mode === 'BB' ? Math.round(e.day * 1e6) / 1e6 : e.day, cum };
  });
}

/** 最大の勝ち・最大の負け（勝ち/負けのセッションがなければ null） */
export function extremes(sessions, mode) {
  let best = null;
  let worst = null;
  for (const s of sessions) {
    const v = sessionValue(s, mode);
    if (v == null) continue;
    if (v > 0 && (!best || v > best.value)) best = { session: s, value: v };
    if (v < 0 && (!worst || v < worst.value)) worst = { session: s, value: v };
  }
  return { best, worst };
}

/**
 * 最大ドローダウン：累計収支のピーク（開始時の0を含む）からの最大の下げ幅。
 * セッション単位（日付・開始時刻順）で計算する。下げがなければ null。
 */
export function maxDrawdown(sessions, mode) {
  let cum = 0;
  let peak = 0;
  let peakDate = null;
  let best = null;
  for (const s of sortSessions(sessions)) {
    const v = sessionValue(s, mode);
    if (v == null) continue;
    cum = round2(cum + v);
    if (cum > peak) { peak = cum; peakDate = s.date; }
    const dd = round2(peak - cum);
    if (dd > 0 && (!best || dd > best.amount)) best = { amount: dd, fromDate: peakDate, toDate: s.date, peak, trough: cum };
  }
  return best;
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * 遠征の比較用指標。
 * days: 日数（終了日未定なら今日まで）、breakEvenHourly: 経費をまかなうのに必要だった円時給（経費 ÷ 実プレイ時間）
 */
export function tripMetrics(trip, sessions, today) {
  const r = tripResult(trip, sessions);
  const end = trip.endDate || (today >= trip.startDate ? today : trip.startDate);
  const days = daysBetween(trip.startDate, end) + 1;
  const hours = r.summary.minutes / 60;
  return {
    ...r,
    days,
    ongoing: !trip.endDate,
    breakEvenHourly: r.expenses != null && hours > 0 ? r.expenses / hours : null,
    hoursPerDay: days > 0 ? hours / days : null,
  };
}

export function stakeKey(s) {
  return isFixed(s) ? `${s.currency}|fixed|${Number(s.table)}` : `${s.currency}|${Number(s.sb)}|${Number(s.bb)}`;
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

  const fixed = raw.format === 'fixed';
  v.format = fixed ? 'fixed' : 'blind';
  // ブラインド：ブラインド制では必須、定額卓では任意（入れなければ bb の集計に含めない）
  const sb = parseNumber(raw.sb, { min: 0, allowEmpty: fixed });
  const bb = parseNumber(raw.bb, { min: 0, allowEmpty: fixed });
  if (!sb.ok) errors.sb = 'SB：' + sb.error;
  else v.sb = sb.value;
  if (!bb.ok) errors.bb = 'BB：' + bb.error;
  else if (bb.value != null && bb.value <= 0) errors.bb = 'BBは0より大きい値にしてください';
  else v.bb = bb.value;
  if (fixed && (v.sb == null) !== (v.bb == null) && !errors.sb && !errors.bb) errors.bb = 'SBとBBは両方入れるか、両方空欄にしてください';
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

  const co = parseNumber(raw.cashout, { min: 0 });
  if (!co.ok) errors.cashout = co.error;
  else v.cashout = co.value;
  if (fixed) {
    // 定額卓：テーブル額・1回あたりの料金・回数から、チップ代と料金の合計を出す
    const fx = validateFixed(raw);
    Object.assign(errors, fx.errors);
    Object.assign(v, fx.value);
  } else {
    const bi = parseNumber(raw.buyin, { min: 0 });
    const tr = parseNumber(raw.timeRake, { min: 0, allowEmpty: true });
    if (!bi.ok) errors.buyin = bi.error;
    else v.buyin = bi.value;
    if (!tr.ok) errors.timeRake = tr.error;
    else v.timeRake = tr.value ?? 0;
    Object.assign(v, { table: null, feePerBuyin: null, buyinCount: null });
  }
  const rb = parseNumber(raw.rakeback, { min: 0, allowEmpty: true });
  if (!rb.ok) errors.rakeback = rb.error;
  else v.rakeback = rb.value ?? 0;

  v.tripId = raw.tripId || null;
  v.note = String(raw.note ?? '').trim().slice(0, 500);
  v.condition = normalizeCondition(raw.condition);
  v.tags = normalizeTags(raw.tags);

  return { ok: Object.keys(errors).length === 0, errors, value: v };
}

/** 定額卓の入力（テーブル額・料金・回数）の検証。回数を省くと1回として検証する（開始画面用） */
export function validateFixed(raw, { requireCount = true } = {}) {
  const errors = {};
  const value = {};
  const tb = parseNumber(raw.table, { min: 0 });
  if (!tb.ok) errors.table = 'テーブル：' + tb.error;
  else if (tb.value <= 0) errors.table = 'テーブルの額は0より大きい値にしてください';
  else value.table = tb.value;
  const fe = parseNumber(raw.feePerBuyin, { min: 0, allowEmpty: true });
  if (!fe.ok) errors.feePerBuyin = '料金：' + fe.error;
  else if (value.table != null) {
    const fee = fe.value ?? defaultFee(value.table);
    if (fee >= value.table) errors.feePerBuyin = '料金はテーブルの額より小さくしてください';
    else value.feePerBuyin = fee;
  }
  const cn = parseNumber(requireCount ? raw.buyinCount : (raw.buyinCount || '1'), { min: 0, integer: true, max: 999 });
  if (!cn.ok) errors.buyinCount = 'バイイン回数：' + (cn.error === '値が大きすぎます' ? '999回以内で入力してください' : cn.error);
  else if (cn.value < 1) errors.buyinCount = 'バイイン回数は1回以上にしてください';
  else value.buyinCount = cn.value;
  if (value.table != null && value.feePerBuyin != null && value.buyinCount != null) {
    Object.assign(value, fixedAmounts(value.table, value.feePerBuyin, value.buyinCount));
  }
  return { ok: !Object.keys(errors).length, errors, value };
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
