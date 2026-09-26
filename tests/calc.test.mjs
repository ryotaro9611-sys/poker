// 計算ルールの検証: node tests/calc.test.mjs
import assert from 'node:assert/strict';
import { buildDemoDb } from '../js/demo.js';
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
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

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

console.log(`\n${n} tests passed`);
