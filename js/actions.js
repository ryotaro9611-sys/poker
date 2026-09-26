// データ操作（遠征・セッション・タイマー）。すべて store.commit 経由で原子的に保存する。
import { commit, getDb, UserError, ConflictError } from './store.js';
import { uid, todayYMD, ymdFromDate, ymdInTz, currentTz, fmtInput } from './util.js';
import { MAX_MINUTES } from './calc.js';

/* ---------------- 共通 ---------------- */

function rememberPrefs(db, v) {
  const p = db.prefs;
  if (v.tripId !== undefined) p.lastTripId = v.tripId || null;
  if (v.location) p.lastLocation = v.location;
  if (v.currency) {
    p.lastCurrency = v.currency;
    if (v.bb) {
      p.stakes = p.stakes || {};
      p.stakes[v.currency] = { sb: v.sb, bb: v.bb };
    }
    if (v.initialBuyin != null) {
      p.buyins = p.buyins || {};
      p.buyins[v.currency] = v.initialBuyin;
    }
  }
}

/** 日付が含まれる遠征（複数あれば開始日が新しいもの） */
export function tripForDate(db, date) {
  const hits = db.trips
    .filter((t) => t.startDate <= date && (!t.endDate || date <= t.endDate))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return hits[0] || null;
}

export function defaultTripId(db, date = todayYMD()) {
  const t = tripForDate(db, date);
  if (t) return t.id;
  const last = db.prefs.lastTripId;
  if (last && db.trips.some((x) => x.id === last)) return last;
  return '';
}

/** 最近使った場所（新しい順・重複なし） */
export function recentLocations(db, limit = 6) {
  const seen = new Map();
  const list = [...db.sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (db.active) list.unshift(db.active);
  for (const s of list) {
    const k = (s.location || '').trim();
    if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/** 通貨ごとの最近使ったレート */
export function recentStakes(db, currency, limit = 4) {
  const seen = new Map();
  const list = [...db.sessions].filter((s) => s.currency === currency).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const s of list) {
    const k = `${s.sb}/${s.bb}`;
    if (!seen.has(k)) seen.set(k, { sb: s.sb, bb: s.bb });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/* ---------------- 遠征 ---------------- */

export const TRIP_MISSING = 'trip-missing';
/** 選んでいた遠征が別の画面で削除されていないか（参照切れの記録を作らない） */
function assertTrip(db, tripId) {
  if (tripId && !db.trips.some((t) => t.id === tripId)) {
    throw new ConflictError('選んでいた遠征は別の画面（タブ）で削除されました。遠征を選び直してから保存してください。入力内容は残っています。', TRIP_MISSING);
  }
}

export function createTrip(v) {
  return commit((db) => {
    const now = Date.now();
    const trip = { id: uid(), ...v, createdAt: now, updatedAt: now };
    db.trips.push(trip);
    return trip;
  });
}

export function updateTrip(id, v, baseUpdatedAt) {
  return commit((db) => {
    const t = db.trips.find((x) => x.id === id);
    if (!t) throw new UserError('この遠征は見つかりません（削除された可能性があります）');
    if (baseUpdatedAt != null && t.updatedAt !== baseUpdatedAt) throw new ConflictError(CHANGED_ELSEWHERE);
    Object.assign(t, v, { updatedAt: Date.now() });
    return t;
  });
}

export function updateTripExpenses(id, expenses) {
  return updateTrip(id, { expenses });
}

/** mode: 'detach'（記録は「遠征なし」に移して残す）/ 'cascade'（記録も削除） */
export function deleteTrip(id, mode) {
  return commit((db) => {
    const idx = db.trips.findIndex((x) => x.id === id);
    if (idx < 0) throw new UserError('この遠征は見つかりません');
    const [trip] = db.trips.splice(idx, 1);
    const related = db.sessions.filter((s) => s.tripId === id);
    if (mode === 'cascade') {
      db.sessions = db.sessions.filter((s) => s.tripId !== id);
    } else {
      for (const s of related) { s.tripId = null; s.updatedAt = Date.now(); }
    }
    if (db.active && db.active.tripId === id) db.active.tripId = null;
    if (db.prefs.lastTripId === id) db.prefs.lastTripId = null;
    return { trip, count: related.length };
  });
}

/* ---------------- セッション ---------------- */

export function createSession(v, extra = {}) {
  return commit((db) => {
    assertTrip(db, v.tripId);
    const now = Date.now();
    const s = { id: uid(), ...v, rate: null, ...extra, createdAt: now, updatedAt: now };
    db.sessions.push(s);
    rememberPrefs(db, v);
    return s;
  });
}

export function updateSession(id, v, baseUpdatedAt) {
  return commit((db) => {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) throw new UserError('このセッションは見つかりません（削除された可能性があります）');
    if (baseUpdatedAt != null && s.updatedAt !== baseUpdatedAt) throw new ConflictError(CHANGED_ELSEWHERE);
    assertTrip(db, v.tripId);
    const rateReset = s.date !== v.date || s.currency !== v.currency;
    Object.assign(s, v, { updatedAt: Date.now() });
    if (rateReset) s.rate = null; // プレイ日・通貨が変わったら、そのプレイ日のレートを取り直す
    return { session: s, rateReset };
  });
}

export function deleteSession(id) {
  return commit((db) => {
    const idx = db.sessions.findIndex((x) => x.id === id);
    if (idx < 0) throw new UserError('このセッションは見つかりません');
    return db.sessions.splice(idx, 1)[0];
  });
}

export function restoreSession(s) {
  return commit((db) => {
    if (!db.sessions.some((x) => x.id === s.id)) {
      if (s.tripId && !db.trips.some((t) => t.id === s.tripId)) s.tripId = null;
      db.sessions.push(s);
    }
  });
}

export function setManualRate(id, value) {
  return commit((db) => {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) throw new UserError('このセッションは見つかりません');
    s.rate = { value, date: s.date, source: '手入力', manual: true, setAt: new Date().toISOString() };
    s.updatedAt = Date.now();
  });
}

/** 手入力を解除して自動取得に戻す */
export function clearRate(id) {
  return commit((db) => {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) throw new UserError('このセッションは見つかりません');
    s.rate = null;
    s.updatedAt = Date.now();
  });
}

/* ---------------- タイマー（進行中のセッションは常に1件） ---------------- */

export function liveElapsedMs(a, now = Date.now()) {
  if (!a) return 0;
  return a.segments.reduce((sum, seg) => sum + ((seg.e ?? now) - seg.s), 0);
}
export function liveBreakMs(a, now = Date.now()) {
  if (!a || !a.segments.length) return 0;
  let total = 0;
  for (let i = 1; i < a.segments.length; i++) total += a.segments[i].s - a.segments[i - 1].e;
  const last = a.segments[a.segments.length - 1];
  if (a.status === 'break' && last.e) total += now - last.e;
  // 休憩中に終了した場合、最後の休憩は終了時刻まで
  if (a.status === 'settling' && last.e && a.endedAt && a.endedAt > last.e) total += a.endedAt - last.e;
  return total;
}
export function liveBuyinTotal(a) {
  return Math.round(a.buyins.reduce((s, b) => s + b.amount, 0) * 100) / 100;
}

export function startLive(v) {
  return commit((db) => {
    if (db.active) throw new UserError('すでに進行中のセッションがあります');
    assertTrip(db, v.tripId);
    const now = Date.now();
    db.active = {
      id: uid(),
      tripId: v.tripId || null,
      location: v.location,
      currency: v.currency,
      sb: v.sb,
      bb: v.bb,
      date: ymdFromDate(new Date(now)), // 開始した現地の日付
      tz: currentTz(),
      startedAt: now,
      segments: [{ s: now, e: null }],
      status: 'playing',
      buyins: v.buyin > 0 ? [{ amount: v.buyin, at: now }] : [],
      condition: v.condition ?? null,
      draft: null,
      rev: 0,
    };
    rememberPrefs(db, { ...v, initialBuyin: v.buyin });
    return db.active;
  });
}

const CHANGED_ELSEWHERE = '別の画面（タブ）でこの内容が先に変更されました。入力内容は残っています。画面を開き直して確認してください。';
const LIVE_CHANGED = '別の画面（タブ）で、このセッションはすでに保存・破棄されたか、新しいセッションが始まっています。入力内容は残っています。';

const LIVE_UPDATED = '別の画面（タブ）で、このセッションの内容（再開・バイインなど）が変わりました。入力内容は残っています。画面を開き直してから操作してください。';

/**
 * 進行中セッションの変更。
 * expectedId：画面が扱っているセッションと同じときだけ変更する
 * expectedRev：画面を開いた時点から、別の画面で変更されていないときだけ変更する
 * 変更のたびに rev（更新番号）を増やす（下書き保存は除く）
 */
function withActive(fn, expectedId, expectedRev) {
  return commit((db) => {
    if (!db.active) throw new (expectedId ? ConflictError : UserError)(expectedId ? LIVE_CHANGED : '進行中のセッションはありません');
    if (expectedId && db.active.id !== expectedId) throw new ConflictError(LIVE_CHANGED);
    if (expectedRev != null && (db.active.rev || 0) !== expectedRev) throw new ConflictError(LIVE_UPDATED);
    const r = fn(db.active, db);
    if (db.active) db.active.rev = (db.active.rev || 0) + 1;
    return r;
  });
}

export function pauseLive() {
  return withActive((a) => {
    if (a.status !== 'playing') return a;
    a.segments[a.segments.length - 1].e = Date.now();
    a.status = 'break';
    return a;
  });
}

export function resumeLive() {
  return withActive((a) => {
    if (a.status === 'playing') return a;
    a.segments.push({ s: Date.now(), e: null });
    a.status = 'playing';
    return a;
  });
}

export function addBuyin(amount, expectedId) {
  return withActive((a) => {
    a.buyins.push({ amount, at: Date.now() });
    return a;
  }, expectedId);
}
export function removeLastBuyin(expectedId) {
  return withActive((a) => {
    a.buyins.pop();
    return a;
  }, expectedId);
}
/**
 * プレイ中の情報を修正（場所・通貨・レート・遠征・バイイン内訳・開始時刻）。
 * 開始時刻を変えるとプレイ日もその日付になる（開始の押し忘れ対策）。
 */
export function editLive(v, expectedId, expectedRev) {
  return withActive((a, db) => {
    if (a.status === 'settling') throw new UserError('精算入力中です。精算画面で修正してください');
    if (v.tripId !== undefined) assertTrip(db, v.tripId);
    const before = { location: a.location, currency: a.currency, sb: a.sb, bb: a.bb, tripId: a.tripId, condition: a.condition, date: a.date };
    const now = Date.now();
    if (v.startedAt != null && v.startedAt !== a.startedAt) {
      const first = a.segments[0];
      const limit = first.e ?? now;
      if (v.startedAt >= limit) {
        throw new UserError(first.e ? '開始時刻は最初の休憩より前にしてください' : '開始時刻は現在より前にしてください');
      }
      if (now - v.startedAt > MAX_MINUTES * 60000) throw new UserError('開始時刻は72時間以内にしてください');
      first.s = v.startedAt;
      a.startedAt = v.startedAt;
      a.date = a.tz ? ymdInTz(v.startedAt, a.tz) : ymdFromDate(new Date(v.startedAt));
    }
    for (const k of ['location', 'currency', 'sb', 'bb', 'tripId', 'condition']) if (v[k] !== undefined) a[k] = v[k];
    if (Array.isArray(v.buyins)) a.buyins = v.buyins;
    syncDraft(a, v, before);
    return a;
  }, expectedId, expectedRev);
}

/**
 * プレイ中に直した情報を、精算の下書きにも反映する（古い下書きで巻き戻さない）。
 * 実際に値が変わった項目だけを反映し、精算画面で手で直した値やキャッシュアウトはそのまま残す。
 */
function syncDraft(a, v, before) {
  const d = a.draft;
  if (!d) return;
  const changed = (k) => a[k] !== before[k];
  if (changed('location')) d.location = a.location;
  if (changed('currency')) d.currency = a.currency;
  if (changed('sb')) d.sb = fmtInput(a.sb);
  if (changed('bb')) d.bb = fmtInput(a.bb);
  if (changed('tripId')) d.tripId = a.tripId || '';
  if (changed('condition')) d.condition = a.condition == null ? '' : String(a.condition);
  // プレイ日は、下書きで手動で変えていなければ開始時刻の日付に合わせる
  if (changed('date') && d.date === before.date) d.date = a.date;
}

/** 読み込み時にタイマーを修復したお知らせを、確認済みにする */
export function ackLiveRepairs(expectedId) {
  return withActive((a) => { delete a.repairs; return a; }, expectedId);
}

/** 終了して精算画面へ（タイマー停止） */
export function settleLive() {
  return withActive((a) => {
    const now = Date.now();
    const last = a.segments[a.segments.length - 1];
    if (a.status === 'playing' && last && last.e == null) last.e = now;
    if (a.status !== 'settling') {
      a.status = 'settling';
      a.endedAt = now;
    }
    return a;
  });
}

/** 精算をやめてプレイに戻る（タイマー再開） */
export function backToPlay(expectedId) {
  return withActive((a) => {
    // すでに別の画面で再開されていれば何もしない（二重に再開しない）
    if (a.status !== 'settling') return a;
    a.segments.push({ s: Date.now(), e: null });
    a.status = 'playing';
    a.endedAt = null;
    return a;
  }, expectedId);
}

/**
 * 精算の下書き。画面を開いたときと同じモード・同じセッション・同じ更新番号のときだけ書き込む
 * （別の画面で変更された後の古い画面の入力で、最新の内容を上書きしない）。
 * 戻り値：書き込んだら true
 */
export function saveLiveDraft(draft, { activeId, gen, rev }) {
  return commit((db) => {
    const a = db.active;
    if (!a || a.id !== activeId || (rev != null && (a.rev || 0) !== rev)) return false;
    a.draft = draft;
    return true;
  }, { silent: true, touch: false, gen }) === true;
}

/** 精算して保存。同じ進行中セッションから二重に保存されない（idで判定） */
export function finishLive(v, expectedId, expectedRev) {
  return commit((db) => {
    const a = db.active;
    if (!a || (expectedId && a.id !== expectedId)) {
      if (expectedId && db.sessions.some((x) => x.id === expectedId)) throw new ConflictError('このセッションは別の画面（タブ）ですでに保存されています。入力内容は残っています。');
      throw new ConflictError(LIVE_CHANGED);
    }
    // 精算画面を開いた後に、別の画面で再開・変更されていたら保存しない
    if (a.status !== 'settling' || (expectedRev != null && (a.rev || 0) !== expectedRev)) throw new ConflictError(LIVE_UPDATED);
    assertTrip(db, v.tripId);
    let s = db.sessions.find((x) => x.id === a.id);
    if (!s) {
      const now = Date.now();
      s = {
        id: a.id, ...v, rate: null,
        startedAt: a.startedAt, endedAt: a.endedAt || now, tz: a.tz,
        breakMinutes: Math.round(liveBreakMs(a, a.endedAt || now) / 60000),
        timerMinutes: Math.round(liveElapsedMs(a, a.endedAt || now) / 60000),
        createdAt: now, updatedAt: now,
      };
      db.sessions.push(s);
    }
    db.active = null;
    rememberPrefs(db, v);
    return s;
  });
}

export function discardLive(expectedId) {
  return withActive((a, db) => { db.active = null; }, expectedId);
}

/* ---------------- 入力途中の内容 ---------------- */

export function setDraft(key, data, { gen } = {}) {
  return commit((db) => { db.drafts[key] = { ...data, savedAt: Date.now() }; }, { silent: true, touch: false, gen });
}
export function clearDraft(key) {
  const db = getDb();
  if (!db.drafts[key]) return;
  try { commit((d) => { delete d.drafts[key]; }, { silent: true }); } catch { /* 下書き削除の失敗は無視 */ }
}
