// 計算ルールの検証: node tests/calc.test.mjs
import assert from 'node:assert/strict';
import { buildDemoDb } from '../js/demo.js';
import { validateData } from '../js/schema.js';
import {
  sessionProfit, sessionProfitJPY, sessionBB, summarize, tripResult, cumulativeSeries,
  validateSession, validateTrip, groupSummaries, stakeKey, extremes, maxDrawdown, tripMetrics,
} from '../js/calc.js';
import { parseNumber, fmtMoney, fmtYen, fmtBBph, addDaysYMD, toInputInTz, fromInputInTz, ymdInTz } from '../js/util.js';

const empty = () => ({ trips: [], sessions: [], active: null, drafts: {}, prefs: {}, rateCache: {} });
const db = buildDemoDb(empty);
const S = db.sessions;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
let n = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log('ok -', name); } catch (e) { failed++; console.log('FAIL -', name, '\n    ', e.message.split('\n')[0]); }
};

t('4/1 セッション', () => {
  const s = S[0];
  assert.equal(sessionProfit(s), 240);
  assert.equal(sessionProfitJPY(s), 36000);
  close(summarize([s]).byCurrency.USD.hourly, 48, 'USD/h');
  close(summarize([s]).bbPerHour, 9.6, 'bb/h');
});

t('4/2 セッション', () => {
  const s = S[1];
  assert.equal(sessionProfit(s), -100);
  assert.equal(sessionProfitJPY(s), -15000);
  close(summarize([s]).byCurrency.USD.hourly, -50, 'USD/h');
  close(summarize([s]).bbPerHour, -10, 'bb/h');
});

t('4/1 + 4/2 集計', () => {
  const sum = summarize([S[0], S[1]]);
  assert.equal(sum.byCurrency.USD.profit, 140);
  assert.equal(sum.jpy.profit, 21000);
  assert.equal(sum.minutes, 420);
  close(sum.byCurrency.USD.hourly, 20, 'USD/h');
  close(sum.jpy.hourly, 3000, '円/h');
  close(sum.bbPerHour, 4, 'bb/h');
});

t('遠征A', () => {
  const r = tripResult(db.trips[0], S);
  assert.equal(r.summary.jpy.profit, 62720);
  assert.equal(r.summary.minutes, 14 * 60);
  close(r.summary.bb, 56, 'bb');
  close(r.summary.bbPerHour, 4, 'bb/h');
  assert.equal(r.net, 56720);
  assert.equal(r.provisional, false);
});

t('遠征B', () => {
  const r = tripResult(db.trips[1], S);
  assert.equal(r.summary.jpy.profit, 8400);
  assert.equal(r.summary.minutes, 14 * 60);
  close(r.summary.bb, 52.5, 'bb');
  close(r.summary.bbPerHour, 3.75, 'bb/h');
  assert.equal(r.net, -21600);
});

t('タイムレーキの例', () => {
  const base = { currency: 'USD', bb: 10, minutes: 60 };
  assert.equal(sessionProfit({ ...base, buyin: 1000, cashout: 1300, timeRake: 50 }), 250);
  assert.equal(sessionProfit({ ...base, buyin: 1000, cashout: 1250, timeRake: 0 }), 250);
});

t('換算待ちは0円扱いしない', () => {
  const pending = { ...S[0], id: 'x', rate: null };
  const sum = summarize([S[1], pending]);
  assert.equal(sum.jpy.pending, 1);
  assert.equal(sum.jpy.count, 1);
  assert.equal(sum.jpy.profit, -15000);
  close(sum.jpy.hourly, -7500, '換算済み分のみの時給');
  close(sum.bbPerHour, (48 - 20) / 7, 'bb/hは全件');
  const r = tripResult(db.trips[0], [pending]);
  assert.equal(r.provisional, true);
});

t('経費未入力は暫定、0円は確定', () => {
  assert.equal(tripResult({ ...db.trips[0], expenses: null }, S).provisional, true);
  assert.equal(tripResult({ ...db.trips[0], expenses: 0 }, S).provisional, false);
  assert.equal(tripResult({ ...db.trips[0], expenses: 0 }, S).net, 62720);
});

t('累積推移は期間開始を0とする', () => {
  const ser = cumulativeSeries(S, 'JPY');
  assert.equal(ser.length, 8);
  assert.equal(ser[0].cum, 36000);
  assert.equal(ser.at(-1).cum, 62720 + 8400);
  const usd = cumulativeSeries(S, 'USD');
  assert.equal(usd.at(-1).cum, 240 - 100 + 280 + 0);
});

t('同じブラインドでも通貨が違えば別レート', () => {
  const a = { currency: 'USD', sb: 100, bb: 200 };
  const b = { currency: 'PHP', sb: 100, bb: 200 };
  assert.notEqual(stakeKey(a), stakeKey(b));
  const g = groupSummaries(S, stakeKey, (s) => s.currency);
  assert.equal(g.length, 6);
});

t('入力検証', () => {
  const ok = { date: '2026-04-01', location: 'A', currency: 'USD', sb: '2', bb: '5', hours: '5', mins: '', buyin: '500', cashout: '0', timeRake: '' };
  assert.equal(validateSession(ok).ok, true);
  assert.equal(validateSession(ok).value.timeRake, 0);
  assert.equal(validateSession({ ...ok, bb: '0' }).errors.bb != null, true);
  assert.equal(validateSession({ ...ok, hours: '0', mins: '0' }).errors.duration != null, true);
  assert.equal(validateSession({ ...ok, buyin: '-1' }).errors.buyin != null, true);
  assert.equal(validateSession({ ...ok, cashout: 'abc' }).errors.cashout != null, true);
  assert.equal(validateSession({ ...ok, mins: '75' }).errors.duration != null, true);
  assert.equal(validateSession({ ...ok, buyin: '１，０００' }).value.buyin, 1000);
  assert.equal(validateTrip({ name: 'x', startDate: '2026-04-02', endDate: '2026-04-01' }).errors.endDate != null, true);
  assert.equal(validateTrip({ name: 'x', startDate: '2026-04-02', endDate: '', expenses: '' }).value.expenses, null);
  assert.equal(validateTrip({ name: 'x', startDate: '2026-04-02', endDate: '', expenses: '0' }).value.expenses, 0);
});

t('表示形式', () => {
  assert.equal(fmtMoney(240, 'USD'), '+240 USD');
  assert.equal(fmtYen(-21600), '−21,600円');
  assert.equal(fmtYen(0), '±0円');
  assert.equal(fmtBBph(3.75), '+3.75 bb/時');
  assert.equal(parseNumber('1,000.5').value, 1000.5);
  assert.equal(addDaysYMD('2026-03-01', -1), '2026-02-28');
});

t('最大の勝ち・負け', () => {
  const e = extremes(S, 'JPY');
  assert.equal(e.best.value, 41720);
  assert.equal(e.best.session.date, '2026-04-04');
  assert.equal(e.worst.value, -15000);
  const usd = extremes(S, 'USD');
  assert.equal(usd.best.value, 280);
  assert.equal(usd.worst.value, -100);
  assert.equal(extremes([S[0]], 'JPY').worst, null);
});

t('最大ドローダウン', () => {
  const dd = maxDrawdown(S, 'JPY');
  assert.equal(dd.amount, 15000);
  assert.equal(dd.fromDate, '2026-04-01');
  assert.equal(dd.toDate, '2026-04-02');
  // 開始直後から負け続ける場合は0からの下げ
  const losing = [S[1], { ...S[1], id: 'l2', date: '2026-04-03' }];
  const d2 = maxDrawdown(losing, 'JPY');
  assert.equal(d2.amount, 30000);
  assert.equal(d2.fromDate, null);
  assert.equal(maxDrawdown([S[0]], 'JPY'), null);
});

t('bb単位の推移', () => {
  const ser = cumulativeSeries(S, 'BB');
  close(ser.at(-1).cum, 108.5, '累計bb');
  close(ser[0].cum, 48, '初日');
});

t('遠征の比較指標', () => {
  const m = tripMetrics(db.trips[0], S, '2026-09-26');
  assert.equal(m.days, 7);
  close(m.breakEvenHourly, 6000 / 14, '必要時給');
  const ongoing = tripMetrics({ ...db.trips[0], endDate: null }, S, '2026-04-05');
  assert.equal(ongoing.days, 5);
  assert.equal(ongoing.ongoing, true);
  assert.equal(tripMetrics({ ...db.trips[0], expenses: null }, S, '2026-09-26').breakEvenHourly, null);
});

t('タイムゾーン：記録した現地時刻で表示・入力', () => {
  const ms = Date.UTC(2026, 8, 25, 17, 54); // マニラ 9/26 01:54
  assert.equal(toInputInTz(ms, 'Asia/Manila'), '2026-09-26T01:54');
  assert.equal(ymdInTz(ms, 'Asia/Manila'), '2026-09-26');
  assert.equal(ymdInTz(ms, 'America/Los_Angeles'), '2026-09-25');
  for (const tz of ['Asia/Manila', 'Asia/Seoul', 'America/Los_Angeles', 'Asia/Tokyo']) {
    assert.equal(fromInputInTz(toInputInTz(ms, tz), tz), ms, tz);
  }
  const dst = Date.UTC(2026, 2, 8, 11, 30); // ロサンゼルスの夏時間切替日
  assert.equal(fromInputInTz(toInputInTz(dst, 'America/Los_Angeles'), 'America/Los_Angeles'), dst);
});

t('冴え・タグの入力検証', () => {
  const ok = { date: '2026-04-01', location: 'A', currency: 'USD', sb: '2', bb: '5', hours: '5', mins: '', buyin: '500', cashout: '0', timeRake: '' };
  assert.equal(validateSession(ok).value.condition, null);
  assert.deepEqual(validateSession(ok).value.tags, []);
  assert.equal(validateSession({ ...ok, condition: '4' }).value.condition, 4);
  assert.equal(validateSession({ ...ok, condition: '9' }).value.condition, null);
  assert.deepEqual(validateSession({ ...ok, tags: ['tilt', 'unknown', 'loose', 'loose'] }).value.tags, ['loose', 'tilt']);
});

t('整合性：入力検証を通った値は、保存・再読み込み・復元でも必ず通る', () => {
  const raws = [
    { date: '2026-04-01', location: 'A', currency: 'USD', sb: '0', bb: '0.01', hours: '0', mins: '1', buyin: '0', cashout: '0', timeRake: '' },
    { date: '2026-04-01', location: 'x'.repeat(60), currency: 'KRW', sb: '1000000000000', bb: '1000000000000', hours: '72', mins: '0', buyin: '1000000000000', cashout: '1000000000000', timeRake: '1000000000000', note: 'n'.repeat(500), condition: '5', tags: ['loose', 'tilt'] },
  ];
  const trips = [{ id: 't1', name: 'x'.repeat(40), startDate: '2026-04-01', endDate: null, expenses: 1000000000000, note: 'm'.repeat(500), createdAt: 1, updatedAt: 1 }];
  const sessions = raws.map((raw, i) => {
    const r = validateSession(raw);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return { id: `s${i}`, ...r.value, tripId: 't1', rate: { value: 1000000000000, date: raw.date, source: '手入力', manual: true, setAt: new Date().toISOString() }, createdAt: 1, updatedAt: 1 };
  });
  const tv = validateTrip({ name: 'x'.repeat(40), startDate: '2026-04-01', endDate: '', expenses: '1000000000000', note: 'm'.repeat(500) });
  assert.equal(tv.ok, true, JSON.stringify(tv.errors));
  const res = validateData({ trips, sessions, active: null, drafts: { 'new-session': { ...raws[1], durationEdited: true, savedAt: 1 } }, prefs: {}, rateCache: {} }, { strict: true });
  assert.deepEqual(res.problems, []);
  assert.equal(res.data.sessions.length, 2);
});

t('復元の検証：不正な下書き・プレイ日より後のレートは拒否、読み込みでは項目だけ直す', () => {
  const base = buildDemoDb(() => ({ trips: [], sessions: [], active: null, drafts: {}, prefs: {}, rateCache: {} }));
  const withDraft = { ...base, drafts: { 'new-session': { tags: 1 } } };
  assert.equal(validateData(withDraft, { strict: true }).data, null);
  const lenientDraft = validateData(withDraft, { strict: false }).data;
  assert.ok(!('tags' in (lenientDraft.drafts['new-session'] || {})), '壊れたtagsは落とす');
  const future = JSON.parse(JSON.stringify(base));
  future.sessions[2].rate.date = '2026-04-05'; // プレイ日 4/4
  assert.equal(validateData(future, { strict: true }).data, null);
  assert.equal(validateData(future, { strict: false }).data.sessions[2].rate, null, '換算待ちに戻す');
  const note = JSON.parse(JSON.stringify(base));
  note.trips[0].note = 7;
  const n = validateData(note, { strict: false }).data;
  assert.equal(n.trips.length, 2, '遠征は残す');
  assert.equal(n.sessions.filter((s) => s.tripId === 'demo-trip-a').length, 4, '関連記録も残す');
  const orphan = JSON.parse(JSON.stringify(base));
  orphan.trips.shift();
  const o = validateData(orphan, { strict: false }).data;
  assert.equal(o.sessions.length, 8, '参照切れでも記録は残す');
  assert.equal(o.sessions[0].tripId, null);
  assert.equal(validateData(orphan, { strict: true }).data, null, '復元では拒否');
});

t('読み込み：壊れたタイマーは可能な範囲で修復して残す', () => {
  const now = Date.now();
  const active = { id: 'a1', tripId: null, location: 'X', currency: 'USD', sb: 1, bb: 2, date: '2026-09-20', tz: 'Asia/Tokyo', startedAt: now - 3 * 3600e3, status: 'playing', buyins: [], draft: null,
    segments: [{ s: now - 3 * 3600e3, e: now - 2 * 3600e3 }, { s: now - 3600e3, e: null }, { s: now - 1800e3, e: null }] };
  const empty = { trips: [], sessions: [], prefs: {}, rateCache: {}, drafts: {} };
  assert.equal(validateData({ ...empty, active }, { strict: true }).data, null);
  const a = validateData({ ...empty, active }, { strict: false }).data.active;
  assert.ok(a, '進行中のタイマーを捨てない');
  assert.equal(a.segments.filter((g) => g.e == null).length, 1, '終わっていない区間は最後の1つだけ');
  assert.equal(a.status, 'playing');
  // 区間1（1時間）＋区間2（30分で次の区間の開始まで）＋区間3（進行中）
  assert.equal(a.segments[1].e, now - 1800e3, '重なった区間は次の開始で閉じる');
  assert.ok(Array.isArray(a.repairs) && a.repairs.length >= 1, '修復した内容をタイマーに残す（画面で知らせる）');

  // 最後の区間が閉じているのにプレイ中 → 休憩中に直し、知らせる
  const closed = { ...active, segments: [{ s: now - 3600e3, e: now - 600e3 }] };
  const c = validateData({ ...empty, active: closed }, { strict: false }).data.active;
  assert.equal(c.status, 'break');
  assert.ok(c.repairs.some((m) => m.includes('休憩中')), c.repairs.join());

  // バイインの日時だけ壊れていても金額は残す
  const b = validateData({ ...empty, active: { ...active, currency: 'JPY', segments: [{ s: now - 3600e3, e: null }], buyins: [{ amount: 1000, at: 'broken' }, { amount: 'x', at: now }] } }, { strict: false }).data.active;
  assert.equal(b.buyins.length, 1);
  assert.equal(b.buyins[0].amount, 1000, '金額は残す');
  assert.ok(b.repairs.some((m) => m.includes('金額')), '読めない金額があったことを知らせる');
});

t('夏時間：秋の重複時刻はどの地域でも早いほう', () => {
  const cases = [
    ['Europe/Berlin', '2026-10-25T02:30', Date.UTC(2026, 9, 25, 0, 30)],
    ['Europe/London', '2026-10-25T01:30', Date.UTC(2026, 9, 25, 0, 30)],
    ['Australia/Sydney', '2026-04-05T02:30', Date.UTC(2026, 3, 4, 15, 30)],
    ['America/Los_Angeles', '2026-11-01T01:30', Date.UTC(2026, 10, 1, 8, 30)],
  ];
  for (const [tz, v, expected] of cases) assert.equal(fromInputInTz(v, tz), expected, tz);
  assert.ok(Number.isNaN(fromInputInTz('2026-03-29T02:30', 'Europe/Berlin')), '春の存在しない時刻');
});

console.log(`\n${n} tests passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
