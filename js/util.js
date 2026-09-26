// 共通ユーティリティ（DOM・日付・数値の整形と解析）

export const CURRENCIES = {
  USD: { code: 'USD', label: '米ドル', unit: 'USD' },
  JPY: { code: 'JPY', label: '日本円', unit: '円' },
  PHP: { code: 'PHP', label: 'フィリピンペソ', unit: 'PHP' },
  KRW: { code: 'KRW', label: '韓国ウォン', unit: 'KRW' },
};
export const CURRENCY_CODES = Object.keys(CURRENCIES);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ---------- 日付（プレイ日は 'YYYY-MM-DD' 文字列で保持し、タイムゾーンに依存させない） ---------- */

const pad = (n) => String(n).padStart(2, '0');

export function ymdFromDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayYMD() {
  return ymdFromDate(new Date());
}
export function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function addDaysYMD(s, days) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function weekday(s) {
  const [y, m, d] = s.split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export function fmtDate(s) {
  if (!isValidYMD(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${y}/${m}/${d}(${weekday(s)})`;
}
export function fmtDateShort(s) {
  if (!isValidYMD(s)) return '—';
  const [, m, d] = s.split('-').map(Number);
  return `${m}/${d}(${weekday(s)})`;
}
export function fmtDateRange(a, b) {
  if (!a) return '';
  return `${fmtDate(a)} 〜 ${b ? fmtDate(b) : '終了日未定'}`;
}
/** タイムスタンプを記録時のタイムゾーンで時刻表示（帰国後も現地時刻のまま） */
export function fmtTimeInTz(ms, tz) {
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: tz || undefined, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString('ja-JP');
  }
}
/** 指定タイムゾーンでの年月日時分 */
function partsInTz(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: Number(o.year), mo: Number(o.month), d: Number(o.day), h: Number(o.hour) % 24, mi: Number(o.minute) };
}
function tzOffsetMs(ms, tz) {
  const p = partsInTz(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
}
/** タイムスタンプ → 記録したタイムゾーンでの 'YYYY-MM-DD' */
export function ymdInTz(ms, tz) {
  try { const p = partsInTz(ms, tz); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; } catch { return ymdFromDate(new Date(ms)); }
}
/** タイムスタンプ → datetime-local 入力値（記録したタイムゾーンの時刻） */
export function toInputInTz(ms, tz) {
  try { const p = partsInTz(ms, tz); return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`; } catch { return ''; }
}
/** datetime-local 入力値（記録したタイムゾーンの時刻）→ タイムスタンプ */
export function fromInputInTz(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return NaN;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    let t = naive - tzOffsetMs(naive, tz);
    t = naive - tzOffsetMs(t, tz); // 夏時間の境目の補正
    return t;
  } catch {
    return new Date(value).getTime();
  }
}

export function currentTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

/* ---------- 数値の入力解析 ---------- */

export function toHalfWidth(str) {
  return String(str ?? '')
    .replace(/[０-９．，－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー]/g, '-')
    .replace(/[\s,、]/g, '');
}

/**
 * 金額などの文字列を解析。{ ok, value, empty, error }
 * min: 下限, allowEmpty: 空欄を許すか, maxDecimals: 小数桁
 */
export function parseNumber(raw, { min = 0, allowEmpty = false, maxDecimals = 2, max = 1e12, integer = false } = {}) {
  const s = toHalfWidth(raw);
  if (s === '') return allowEmpty ? { ok: true, value: null, empty: true } : { ok: false, error: '入力してください' };
  if (!/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return { ok: false, error: '数値を入力してください' };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: '数値を入力してください' };
  if (v < min) return { ok: false, error: min === 0 ? '0以上で入力してください' : `${min}以上で入力してください` };
  if (v > max) return { ok: false, error: '値が大きすぎます' };
  if (integer && !Number.isInteger(v)) return { ok: false, error: '整数で入力してください' };
  const dec = (s.split('.')[1] || '').length;
  if (dec > maxDecimals) return { ok: false, error: `小数は${maxDecimals}桁までです` };
  return { ok: true, value: v };
}

/* ---------- 数値の表示 ---------- */

const MINUS = '−';

export function fmtNum(n, { maxFrac = 2, minFrac = 0 } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.abs(n) < 1e-9 ? 0 : n;
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac })
    .format(v)
    .replace('-', MINUS);
}

function signed(n, body) {
  if (n > 1e-9) return '+' + body;
  if (n < -1e-9) return MINUS + body;
  return '±' + body;
}

/** 損益表示（符号付き） */
export function fmtMoney(n, cur, { sign = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const body = cur === 'JPY' || cur === '円'
    ? fmtNum(Math.round(abs), { maxFrac: 0 }) + '円'
    : fmtNum(abs, { maxFrac: 2 }) + ' ' + cur;
  if (!sign) return (n < -1e-9 ? MINUS : '') + body;
  return signed(n, body);
}
export function fmtYen(n, opts) {
  return fmtMoney(n, 'JPY', opts);
}
/** 符号なしの金額（バイインなど） */
export function fmtAmount(n, cur) {
  return fmtMoney(n, cur, { sign: false });
}
export function fmtBB(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return signed(n, fmtNum(Math.abs(n), { maxFrac: 2, minFrac: 1 }) + ' bb');
}
export function fmtBBph(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return signed(n, fmtNum(Math.abs(n), { maxFrac: 2, minFrac: 1 })) + ' bb/時';
}
export function fmtHourly(n, cur) {
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtMoney(n, cur) + '/時';
}
export function fmtRate(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const frac = v >= 100 ? 2 : v >= 1 ? 4 : 5;
  return fmtNum(v, { maxFrac: frac });
}
export function fmtStake(cur, sb, bb) {
  return `${cur} ${fmtNum(sb)}/${fmtNum(bb)}`;
}
export function fmtDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}分`;
  return r === 0 ? `${h}時間` : `${h}時間${r}分`;
}
export function fmtElapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}
export function signClass(n) {
  if (n == null || !Number.isFinite(n)) return 'na';
  if (n > 1e-9) return 'pos';
  if (n < -1e-9) return 'neg';
  return 'zero';
}
/** 入力欄用：数値を 1,234.5 形式に */
export function fmtInput(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n));
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}
