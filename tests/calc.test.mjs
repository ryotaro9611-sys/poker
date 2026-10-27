// 計算ルールの検証: node tests/calc.test.mjs
import assert from 'node:assert/strict';
import { buildDemoDb } from '../js/demo.js';
import { validateData } from '../js/schema.js';
import {
  sessionProfit, sessionProfitJPY, sessionBB, summarize, tripResult, cumulativeSeries,
  validateSession, validateTrip, groupSummaries, stakeKey, extremes, maxDrawdown, tripMetrics,
  defaultFee, sessionTableProfit, sessionPaid, sessionFeeCount, FIXED_TABLES,
} from '../js/calc.js';
import { parseNumber, fmtMoney, fmtYen, fmtBBph, fmtHourly, addDaysYMD, toInputInTz, fromInputInTz, ymdInTz } from '../js/util.js';

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
  assert.equal(fmtHourly(38600 / 6, 'PHP'), '+6,433 PHP/時');
  assert.equal(fmtHourly(48, 'USD'), '+48 USD/時');
  assert.equal(fmtHourly(-142.857, 'PHP'), '−143 PHP/時');
  assert.equal(fmtHourly(12.345, 'USD'), '+12.35 USD/時');
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

t('R2：壊れたプレイ日は、端末ではなく開始地のタイムゾーンの日付で直す', () => {
  const start = Date.parse('2026-09-26T06:30:00Z'); // ロサンゼルスでは 9/25 23:30、東京では 9/26
  const active = { id: 'a1', tripId: null, location: 'LA', currency: 'USD', sb: 1, bb: 2, date: 'broken', tz: 'America/Los_Angeles', startedAt: start, segments: [{ s: start, e: null }], status: 'playing', buyins: [], draft: null };
  assert.equal(validateData({ trips: [], sessions: [], active }, { strict: false }).data.active.date, '2026-09-25');
});

t('R3：不正な修復履歴は復元で拒否し、読み込みでは不正な要素だけ外す', () => {
  const start = Date.parse('2026-09-26T06:30:00Z');
  const okActive = { id: 'a1', tripId: null, location: 'LA', currency: 'USD', sb: 1, bb: 2, date: '2026-09-25', tz: 'America/Los_Angeles', startedAt: start, segments: [{ s: start, e: null }], status: 'playing', buyins: [], draft: null };
  const empty = { trips: [], sessions: [] };
  assert.equal(validateData({ ...empty, active: { ...okActive, repairs: 123 } }, { strict: true }).data, null, '型が不正なら拒否');
  assert.equal(validateData({ ...empty, active: { ...okActive, repairs: ['ok', 5] } }, { strict: true }).data, null, '要素が不正なら拒否');
  assert.equal(validateData({ ...empty, active: { ...okActive, repairs: Array(11).fill('x') } }, { strict: true }).data, null, '11件以上は拒否');
  assert.ok(validateData({ ...empty, active: { ...okActive, repairs: ['確認してください'] } }, { strict: true }).data, '正しい修復履歴は受け入れる');
  const len = validateData({ ...empty, active: { ...okActive, repairs: ['ok', 5] } }, { strict: false });
  assert.deepEqual(len.data.active.repairs, ['ok'], '読み込みでは不正な要素だけ外す');
  assert.ok(len.problems.length >= 1, '外したことを記録する');
});

t('N2：修復済みのデータを書き出したバックアップは、そのまま復元できる（修復履歴は10件まで）', () => {
  const start = Date.parse('2026-09-26T06:30:00Z');
  const active = { id: 'a1', tripId: null, location: 'LA', currency: 'USD', sb: 1, bb: 2, date: 'broken', tz: 'America/Los_Angeles', startedAt: start, segments: [{ s: start, e: null }], status: 'playing', buyins: [], draft: null,
    repairs: Array.from({ length: 10 }, (_, i) => `以前の修復${i + 1}`) };
  const repaired = validateData({ trips: [], sessions: [], active }, { strict: false }).data;
  assert.ok(repaired.active.repairs.length <= 10, `修復履歴 ${repaired.active.repairs.length}件`);
  assert.ok(repaired.active.repairs.some((m) => m.includes('プレイ日')), '新しい修復の知らせは残す');
  const restored = validateData(JSON.parse(JSON.stringify(repaired)), { strict: true });
  assert.deepEqual(restored.problems, [], '書き出し→復元が通る');
});

/* ---------- 台湾（定額卓・TWD・レーキバック） ---------- */
const fixedRaw = { format: 'fixed', date: '2026-10-30', location: 'Taipei Club', currency: 'TWD', table: '6,600', feePerBuyin: '', buyinCount: '1', sb: '', bb: '', hours: '3', mins: '', cashout: '9,900', rakeback: '' };

t('定額卓：テーブル額の 1/11 が料金（チップの10%）', () => {
  assert.deepEqual(FIXED_TABLES.map(defaultFee), [300, 600, 1000, 2000, 3000]);
});

t('定額卓：6,600 を払って 9,900 で換金 → 卓上+3,900・料金600・収支+3,300・ROI+50%', () => {
  const r = validateSession(fixedRaw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const s = { ...r.value, rate: { value: 4.8, date: '2026-10-30', manual: true, source: 'x' } };
  assert.equal(s.buyin, 6000);
  assert.equal(s.timeRake, 600);
  assert.equal(s.sb, null);
  assert.equal(s.bb, null);
  assert.equal(sessionTableProfit(s), 3900);
  assert.equal(sessionProfit(s), 3300);
  assert.equal(sessionPaid(s), 6600);
  assert.equal(sessionFeeCount(s), 1);
  assert.equal(sessionBB(s), null, 'ブラインドなしは bb なし');
  const sum = summarize([s]);
  close(sum.byCurrency.TWD.roi, 0.5, 'ROI');
  assert.equal(sum.jpy.profit, 15840);
  assert.equal(sum.jpy.fee, 2880);
  close(sum.jpy.feePerHour, 960, '1時間あたりの料金（円）');
  assert.equal(sum.bbPerHour, null);
});

t('定額卓：買い足し2回目・料金の手直し・レーキバック', () => {
  const r = validateSession({ ...fixedRaw, buyinCount: '2', feePerBuyin: '500', cashout: '20,000', rakeback: '300' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.buyin, 12200); // (6,600−500)×2
  assert.equal(r.value.timeRake, 1000);
  assert.equal(r.value.rakeback, 300);
  assert.equal(sessionProfit(r.value), 20000 - 12200 - 1000 + 300);
  assert.equal(sessionFeeCount(r.value), 2);
  const sum = summarize([{ ...r.value, rate: null }]);
  assert.equal(sum.byCurrency.TWD.netFee, 700, '料金からレーキバックを引いた実質の料金');
});

t('定額卓：入力の誤り', () => {
  assert.ok(validateSession({ ...fixedRaw, table: '0' }).errors.table);
  assert.ok(validateSession({ ...fixedRaw, feePerBuyin: '6,600' }).errors.feePerBuyin);
  assert.ok(validateSession({ ...fixedRaw, buyinCount: '0' }).errors.buyinCount);
  assert.ok(validateSession({ ...fixedRaw, buyinCount: '1.5' }).errors.buyinCount);
  assert.ok(validateSession({ ...fixedRaw, sb: '25', bb: '' }).errors.bb, 'SB だけは不可');
  assert.equal(validateSession({ ...fixedRaw, sb: '25', bb: '50' }).value.bb, 50, 'ブラインドを入れれば bb も出せる');
});

t('bb/時間はブラインドを記録した分の時間で割る（定額卓を混ぜても薄まらない）', () => {
  const fixed = { ...validateSession(fixedRaw).value, rate: null };
  const sum = summarize([S[0], fixed]); // 4/1：+48bb・5時間
  close(sum.bbPerHour, 9.6, 'bb/時間');
  assert.equal(sum.bbCount, 1);
  assert.equal(sum.minutes, 480);
});

t('レート別の比較：定額卓はテーブル額ごと', () => {
  const a = validateSession(fixedRaw).value;
  const b = validateSession({ ...fixedRaw, table: '11,000' }).value;
  assert.notEqual(stakeKey(a), stakeKey(b));
  assert.equal(stakeKey(a), 'TWD|fixed|6600');
});

t('ブラインド制はこれまでと同じ（レーキバック欄を空けても結果は変わらない）', () => {
  const ok = { date: '2026-04-01', location: 'A', currency: 'USD', sb: '2', bb: '5', hours: '5', mins: '', buyin: '500', cashout: '750', timeRake: '10', rakeback: '' };
  const r = validateSession(ok);
  assert.equal(r.value.format, 'blind');
  assert.equal(r.value.rakeback, 0);
  assert.equal(sessionProfit(r.value), 240);
  assert.equal(r.value.table, null);
});

t('保存データの検査：定額卓の記録・進行中タイマーを受け付け、往復できる', () => {
  const v = validateSession({ ...fixedRaw, buyinCount: '2', rakeback: '300' }).value;
  const session = { id: 'tw1', ...v, tripId: null, rate: null, createdAt: 1, updatedAt: 1 };
  const now = Date.now();
  const active = { id: 'tw-live', tripId: null, location: 'Taipei Club', currency: 'TWD', sb: null, bb: null, format: 'fixed', table: 6600, feePerBuyin: 600, date: '2026-10-30', tz: 'Asia/Taipei', startedAt: now - 3600e3, segments: [{ s: now - 3600e3, e: null }], status: 'playing', buyins: [{ amount: 6000, fee: 600, at: now - 3600e3 }], draft: { format: 'fixed', table: '6,600', buyinCount: '1', rakeback: '' }, rev: 0 };
  const db = { trips: [], sessions: [session], active, drafts: {}, prefs: { lastFormat: 'fixed', fixed: { TWD: { table: 6600, fee: 600 } } }, rateCache: {} };
  const r = validateData(db, { strict: true });
  assert.deepEqual(r.problems, []);
  assert.equal(r.data.sessions[0].format, 'fixed');
  assert.equal(r.data.sessions[0].rakeback, 300);
  assert.equal(r.data.active.buyins[0].fee, 600);
  assert.deepEqual(r.data.prefs.fixed.TWD, { table: 6600, fee: 600 });
  const again = validateData(JSON.parse(JSON.stringify(r.data)), { strict: true });
  assert.deepEqual(again.problems, [], '書き出し→復元の往復');
  // 壊れた定額卓は拒否
  for (const bad of [{ table: 0 }, { feePerBuyin: 7000 }, { buyinCount: 0 }, { format: 'other' }, { rakeback: -1 }, { sb: 25, bb: null }]) {
    assert.equal(validateData({ ...db, active: null, sessions: [{ ...session, ...bad }] }, { strict: true }).data, null, JSON.stringify(bad));
  }
});

t('保存データの検査：旧版の記録（方式の項目なし）はブラインド制として、そのまま通る', () => {
  const r = validateData(JSON.parse(JSON.stringify(db)), { strict: true });
  assert.deepEqual(r.problems, []);
  assert.equal(r.data.sessions.length, 8);
  assert.ok(r.data.sessions.every((s) => s.format === undefined && s.bb > 0));
  assert.equal(summarize(r.data.sessions).jpy.profit, 71120, 'デモの合計は変わらない');
});

t('T5：定額卓の回数・料金とチップ代・料金合計が食い違うバックアップは拒否する', () => {
  const ok = { id: 'tw', tripId: null, date: '2026-10-30', location: 'T', currency: 'TWD', format: 'fixed', sb: null, bb: null, table: 6600, feePerBuyin: 600, buyinCount: 2, buyin: 12000, timeRake: 1200, cashout: 9900, minutes: 120, rate: null, createdAt: 1, updatedAt: 1 };
  assert.deepEqual(validateData({ trips: [], sessions: [ok] }, { strict: true }).problems, []);
  for (const bad of [{ buyinCount: 1 }, { buyin: 6000 }, { timeRake: 600 }]) {
    assert.equal(validateData({ trips: [], sessions: [{ ...ok, ...bad }] }, { strict: true }).data, null, JSON.stringify(bad));
  }
  const now = Date.now();
  const active = { id: 'a', tripId: null, location: 'T', currency: 'TWD', sb: null, bb: null, format: 'fixed', table: 6600, feePerBuyin: 600, date: '2026-10-30', tz: 'Asia/Taipei', startedAt: now - 3600e3, segments: [{ s: now - 3600e3, e: null }], status: 'playing', buyins: [{ amount: 6000, fee: 600, at: now - 3600e3 }], draft: null, rev: 0 };
  assert.deepEqual(validateData({ trips: [], sessions: [], active }, { strict: true }).problems, []);
  assert.equal(validateData({ trips: [], sessions: [], active: { ...active, buyins: [{ amount: 5000, fee: 600, at: now }] } }, { strict: true }).data, null, '進行中の1回分が食い違う');
});

t('T7：円換算の料金の回数は、換算済みの記録だけで数える', () => {
  const v = validateSession({ ...fixedRaw }).value;
  const done = { ...v, rate: { value: 4.8, date: '2026-10-30', source: 'x', manual: true } };
  const pend = { ...validateSession({ ...fixedRaw, buyinCount: '2' }).value, rate: null };
  const sum = summarize([done, pend]);
  assert.equal(sum.feeCount, 3, '全件では3回');
  assert.equal(sum.jpy.feeCount, 1, '円換算の料金（2,880円）に対応するのは1回');
  assert.equal(sum.jpy.fee, 2880);
});

console.log(`\n${n} tests passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
