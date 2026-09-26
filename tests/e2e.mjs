// 画面操作の自動テスト（ヘッドレス Chrome を DevTools Protocol で操作。追加パッケージ不要）
//   node tests/e2e.mjs
// Chrome の場所が違う場合は CHROME_PATH=... を指定。為替APIはテスト内で差し替えるため通信しない。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 静的サーバー ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* ---------- Chrome ---------- */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tripledger-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 60 && !port; i++) {
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(250); }
}
if (!port) { console.error('Chrome を起動できませんでした（CHROME_PATH を確認してください）'); process.exit(2); }
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let seq = 0;
const waiting = new Map();
const jsErrors = [];
let rateMode = 'ok';
const MOCK_RATES = { USD: 150, PHP: 2.5, KRW: 0.11 };
const rateRequests = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Fetch.requestPaused') {
    // 為替APIを差し替え
    const { requestId, request } = m.params;
    const url = new URL(request.url);
    rateRequests.push(request.url);
    if (rateMode === 'fail') { send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }); return; }
    let body;
    if (url.hostname.includes('frankfurter')) {
      const base = url.searchParams.get('base');
      body = JSON.stringify([{ date: url.searchParams.get('to'), base, quote: 'JPY', rate: MOCK_RATES[base] }]);
    } else {
      send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      return;
    }
    send('Fetch.fulfillRequest', {
      requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(body).toString('base64'),
    });
  }
});

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`評価エラー: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n  式: ${expr.slice(0, 160)}`);
  return r.result.value;
}
async function waitFor(expr, ms = 5000, label = expr) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await ev(expr)) return; } catch { /* ページ遷移中 */ }
    await sleep(60);
  }
  throw new Error(`待機がタイムアウト: ${label}`);
}
const q = (sel) => JSON.stringify(sel);
const click = (sel) => ev(`(() => { const el = document.querySelector(${q(sel)}); if (!el) throw new Error('要素なし: ' + ${q(sel)}); el.click(); return true; })()`);
const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${q(sel)}); if (!el) throw new Error('要素なし: ' + ${q(sel)}); el.value = ${q(String(v))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const text = (sel = '#view') => ev(`(document.querySelector(${q(sel)})?.innerText || '')`);
const data = () => ev(`JSON.parse(localStorage.getItem('tripledger:data:v1') || 'null')`);
const go = async (hash) => { await ev(`location.hash = ${q(hash)}`); await sleep(120); };
async function reload() {
  await send('Page.reload');
  await waitFor(`document.documentElement.classList.contains('ready')`, 8000, '起動');
}
async function fresh() {
  await ev(`localStorage.clear(); sessionStorage.clear(); location.hash = '#/'`);
  await reload();
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function includes(hay, needle, label = '') { assert(hay.includes(needle), `${label}「${needle}」が見つかりません\n--- 実際の表示 ---\n${hay.slice(0, 900)}`); }
const modalPrimary = () => click('.modal .btn-primary');

/** 実データを直接用意する（UI経由でないと確認できない部分以外の準備を短縮） */
async function seed(db) {
  await ev(`localStorage.setItem('tripledger:data:v1', ${q(JSON.stringify({ version: 1, trips: [], sessions: [], active: null, drafts: {}, prefs: {}, rateCache: {}, ...db }))})`);
  await reload();
}

async function manualSession({ date = '2026-04-04', currency = 'USD', location = 'Bellagio', sb = '5', bb = '10', hours = '4', buyin = '1000', cashout = '1300', timeRake = '' } = {}) {
  await go('#/sessions/new');
  await waitFor(`document.querySelector('form [name=location]')`);
  await setVal('[name=date]', date);
  await click(`input[name=currency][value=${currency}]`);
  await setVal('[name=location]', location);
  await setVal('[name=sb]', sb);
  await setVal('[name=bb]', bb);
  await setVal('[name=hours]', hours);
  await setVal('[name=mins]', '');
  await setVal('[name=buyin]', buyin);
  await setVal('[name=cashout]', cashout);
  if (timeRake) { await ev(`document.querySelector('details.disclosure').open = true`); await setVal('[name=timeRake]', timeRake); }
  await click('[data-act=save]');
  await waitFor(`/^#\\/sessions\\/[^/]+$/.test(location.hash)`, 5000, '保存後の詳細画面');
  return location;
}

/* ---------- テスト ---------- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('初回表示：空のデータから始まり、プレイ開始が目立つ', async () => {
  await fresh();
  const t = await text();
  includes(t, 'プレイ開始');
  includes(t, 'ようこそ');
  assert(!(await data()), '初回は何も保存されていないこと');
});

test('遠征：入力ミスの表示、作成、経費未入力は暫定、0円は確定', async () => {
  await fresh();
  await go('#/trips/new');
  await setVal('[name=name]', '');
  await click('[data-act=save]');
  includes(await text(), '遠征名を入力してください');
  await setVal('[name=name]', 'テスト遠征');
  await setVal('[name=startDate]', '2026-09-20');
  await click('[data-act=save]');
  await waitFor(`/^#\\/trips\\/[^/]+$/.test(location.hash) && !location.hash.includes('new')`);
  let t = await text();
  includes(t, '暫定');
  includes(t, '経費未入力');
  await click('[data-act=expenses]');
  await waitFor(`document.querySelector('.modal input')`);
  await setVal('.modal input', '0');
  await modalPrimary();
  await waitFor(`!document.querySelector('.modal-backdrop')`);
  t = await text();
  assert(!t.includes('暫定'), '経費0円なら暫定でないこと');
  assert((await data()).trips[0].expenses === 0, '経費0が保存されていること');
});

test('タイマー：連打しても1件、休憩中の再読み込み、追加バイイン、精算の下書き復元、保存と自動換算', async () => {
  await fresh();
  rateMode = 'ok';
  await go('#/live/start');
  await setVal('[name=location]', 'Okada');
  await click('input[name=currency][value=PHP]');
  await setVal('[name=sb]', '100');
  await setVal('[name=bb]', '200');
  await setVal('[name=buyin]', '20000');
  await ev(`(() => { const b = document.querySelector('[data-act=start]'); b.click(); b.click(); })()`);
  await waitFor(`location.hash === '#/' && document.querySelector('.live-card')`);
  let d = await data();
  assert(d.active && d.active.buyins.length === 1, '進行中セッションは1件');
  // 3時間前に開始したことにして休憩 → 再読み込み
  d.active.startedAt -= 3 * 3600e3; d.active.segments[0].s -= 3 * 3600e3;
  await seed(d);
  await click('[data-live=pause]');
  await waitFor(`document.querySelector('[data-live=resume]')`);
  await reload();
  includes(await text(), '休憩中', '再読み込み後');
  const e1 = await text('[data-tick=elapsed]');
  await sleep(1300);
  assert(e1 === await text('[data-tick=elapsed]'), '休憩中は実プレイ時間が進まないこと');
  await click('[data-live=resume]');
  await waitFor(`document.querySelector('[data-live=pause]')`);
  await click('[data-live=add-buyin]');
  await waitFor(`document.querySelector('.modal input')`);
  await setVal('.modal input', '10000');
  await modalPrimary();
  await waitFor(`document.querySelector('.live-buyin')?.innerText.includes('30,000')`);
  await click('[data-live=finish]');
  await waitFor(`location.hash === '#/live/finish' && document.querySelector('[name=cashout]')`);
  assert((await ev(`document.querySelector('[name=buyin]').value`)) === '30,000', '合計バイインが自動入力されること');
  assert((await ev(`document.querySelector('[name=hours]').value`)) === '3', '実プレイ時間が自動入力されること');
  await setVal('[name=cashout]', '41500');
  await sleep(500);
  await reload();
  assert((await ev(`document.querySelector('[name=cashout]').value`)) === '41500', '精算の入力途中が復元されること');
  includes(await text(), '入力途中の内容を復元しました');
  await ev(`(() => { const b = document.querySelector('[data-act=save]'); b.click(); b.click(); })()`);
  await waitFor(`/^#\\/sessions\\//.test(location.hash)`);
  await waitFor(`document.querySelector('#view').innerText.includes('1 PHP = 2.5円')`, 5000, '自動換算');
  d = await data();
  assert(d.sessions.length === 1 && !d.active, '保存は1件だけ・進行中は終了');
  assert(d.sessions[0].minutes === 180 && d.sessions[0].buyin === 30000, '時間と金額');
  includes(await text(), '+28,750円');
});

test('冴えとタグ：開始時に冴え、進行中カードで変更、精算でタグ、詳細に表示', async () => {
  await fresh();
  rateMode = 'ok';
  await go('#/live/start');
  await setVal('[name=location]', 'Cond Club');
  await click('input[name=currency][value=JPY]');
  await setVal('[name=sb]', '100'); await setVal('[name=bb]', '200'); await setVal('[name=buyin]', '10000');
  await click('input[name=condition][value="4"]');
  await click('[data-act=start]');
  await waitFor(`location.hash === '#/' && document.querySelector('.live-card')`);
  assert((await data()).active.condition === 4, '開始時の冴え');
  await click('.cond-dot[data-v="2"]');
  await waitFor(`document.querySelector('.cond-dot.on')?.dataset.v === '2'`);
  assert((await data()).active.condition === 2, '進行中カードで変更');
  await click('.cond-dot[data-v="2"]');
  await waitFor(`!document.querySelector('.cond-dot.on')`);
  assert((await data()).active.condition === null, 'もう一度押すと未入力');
  await click('.cond-dot[data-v="5"]');
  await waitFor(`document.querySelector('.cond-dot.on')?.dataset.v === '5'`);
  await click('[data-live=finish]');
  await waitFor(`document.querySelector('[name=cashout]')`);
  assert(await ev(`document.querySelector('input[name=condition][value="5"]').checked`), '精算画面に冴えが引き継がれる');
  await setVal('[name=cashout]', '15000');
  await click('input[name=tags][value=loose]');
  await click('input[name=tags][value=alcohol]');
  await sleep(500);
  await reload();
  assert(await ev(`document.querySelector('input[name=tags][value=alcohol]').checked`), 'タグも下書きに残る');
  await click('[data-act=save]');
  await waitFor(`/^#\\/sessions\\//.test(location.hash)`);
  const s = (await data()).sessions[0];
  assert(s.condition === 5 && s.tags.join() === 'loose,alcohol', `保存内容 ${s.condition} ${s.tags}`);
  const t = await text();
  includes(t, '5 冴えてる'); includes(t, 'ルース卓'); includes(t, '飲酒あり');
  // 編集でタグを外す・冴えを未入力に戻す
  await go(`#/sessions/${s.id}/edit`);
  await waitFor(`document.querySelector('input[name=tags][value=loose]')`);
  await click('input[name=tags][value=loose]');
  await click('[data-cond-clear]');
  await click('[data-act=save]');
  await waitFor(`!location.hash.endsWith('/edit')`);
  const s2 = (await data()).sessions[0];
  assert(s2.condition === null && s2.tags.join() === 'alcohol', '編集の反映');
});

test('冴え別・タグ別の比較（デモ）', async () => {
  await fresh();
  await ev(`sessionStorage.setItem('tripledger:demo', '1')`);
  await reload();
  await go('#/stats');
  await click('[data-scope=all]');
  await setVal('[data-f=view]', 'YEN');
  await click('[data-compare=condition]');
  let names = await ev(`[...document.querySelector('.seg-wrap').parentElement.querySelectorAll('.cmp-name')].map((e) => e.firstChild.textContent.trim())`);
  assert(names.join() === '5 冴えてる,4 良い,3 普通,2 低め', `冴え順: ${names}`);
  let t = await text();
  includes(t, '+54,920円'); // 冴え5：41,720 + 13,200
  includes(t, '参考');
  includes(t, '全体');
  await click('[data-compare=tag]');
  t = await text();
  includes(t, 'ルース卓'); includes(t, '+54,200円'); // 36,000 + 5,000 + 13,200
  includes(t, 'タグなし');
  includes(t, 'それぞれのタグに数えます');
  await click('[data-compare=location]');
  await ev(`sessionStorage.clear()`);
});

test('止め忘れ：12時間超のプレイと2時間超の休憩で警告', async () => {
  await fresh();
  const now = Date.now();
  const base = { id: 'a1', tripId: null, location: 'X', currency: 'USD', sb: 1, bb: 2, date: '2026-09-20', tz: 'Asia/Tokyo', buyins: [], draft: null };
  await seed({ active: { ...base, startedAt: now - 13 * 3600e3, segments: [{ s: now - 13 * 3600e3, e: null }], status: 'playing' } });
  includes(await text('.live-card'), '実プレイ時間が13時間を超えています');
  await seed({ active: { ...base, startedAt: now - 5 * 3600e3, segments: [{ s: now - 5 * 3600e3, e: now - 3 * 3600e3 }], status: 'break' } });
  includes(await text('.live-card'), '休憩が3時間を超えています');
  await seed({ active: { ...base, startedAt: now - 3600e3, segments: [{ s: now - 3600e3, e: null }], status: 'playing' } });
  assert(!(await ev(`!!document.querySelector('.live-warn')`)), '通常時は警告なし');
});

test('プレイ中の修正：開始時刻・場所・バイイン内訳', async () => {
  await fresh();
  const now = Date.now();
  await seed({ active: { id: 'a1', tripId: null, location: 'Old Room', currency: 'USD', sb: 1, bb: 2, date: '2026-09-20', tz: 'Asia/Tokyo', startedAt: now - 3600e3, segments: [{ s: now - 3600e3, e: null }], status: 'playing', buyins: [{ amount: 300, at: now - 3600e3 }, { amount: 200, at: now - 1800e3 }], draft: null } });
  await click('.live-edit');
  await waitFor(`location.hash === '#/live/edit' && document.querySelector('[name=startedAt]')`);
  await click('[data-shift="-30"]');
  await setVal('[name=location]', 'New Room');
  await setVal('[name=buyin_1]', '0');
  await click('[data-act=save]');
  await waitFor(`location.hash === '#/'`);
  const a = (await data()).active;
  const shifted = (now - 3600e3) - a.startedAt;
  assert(Math.abs(shifted - 30 * 60e3) < 61e3, `開始時刻が30分早まること（差 ${shifted}ms）`);
  assert(a.segments[0].s === a.startedAt, 'タイマーの起点も変わること');
  assert(a.location === 'New Room', '場所の修正');
  assert(a.buyins.length === 1 && a.buyins[0].amount === 300, '0にしたバイインは削除');
  // 未来の開始時刻はエラー
  await click('.live-edit');
  await waitFor(`document.querySelector('[name=startedAt]')`);
  await ev(`(() => { const d = new Date(Date.now() + 3600e3); const p = (n) => String(n).padStart(2, '0'); const el = document.querySelector('[name=startedAt]'); el.value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); })()`);
  await click('[data-act=save]');
  await waitFor(`document.querySelector('[data-err=startedAt]')?.textContent`);
  includes(await text('[data-err=startedAt]'), '現在より前');
});

test('プレイ中の修正：端末と違うタイムゾーンで始めた記録も現地時刻で直せる', async () => {
  await fresh();
  const start = Date.UTC(2026, 8, 25, 17, 54); // ロサンゼルス 9/25 10:54
  const now = Date.now();
  const s0 = Math.min(start, now - 3600e3);
  await seed({ active: { id: 'a1', tripId: null, location: 'LA', currency: 'USD', sb: 1, bb: 2, date: '2026-09-25', tz: 'America/Los_Angeles', startedAt: s0, segments: [{ s: s0, e: null }], status: 'playing', buyins: [], draft: null } });
  await go('#/live/edit');
  await waitFor(`document.querySelector('[name=startedAt]')`);
  includes(await text('.field-label'), 'America/Los_Angeles の時刻');
  await setVal('[name=startedAt]', '2026-09-25T09:00');
  await click('[data-act=save]');
  await waitFor(`location.hash === '#/'`);
  const a = (await data()).active;
  assert(a.startedAt === Date.UTC(2026, 8, 25, 16, 0), `ロサンゼルスの 9:00 として保存（${new Date(a.startedAt).toISOString()}）`);
  assert(a.date === '2026-09-25', `プレイ日は現地日付（${a.date}）`);
});

test('換算待ち：通信失敗でも保存、0円扱いしない、手入力は上書きされない、日付変更で取り直し', async () => {
  await fresh();
  rateMode = 'fail';
  await manualSession({ timeRake: '50' });
  await waitFor(`document.querySelector('#view').innerText.includes('取得に失敗しました')`, 5000, '失敗表示');
  let t = await text();
  includes(t, '+250 USD', '別払いタイムレーキ控除後');
  includes(t, '換算待ち');
  await go('#/stats');
  includes(await text(), '換算待ち1件');
  // 手入力
  const id = (await data()).sessions[0].id;
  await go(`#/sessions/${id}`);
  await click('[data-act=manual-rate]');
  await waitFor(`document.querySelector('.modal input')`);
  await setVal('.modal input', '149');
  await modalPrimary();
  await waitFor(`document.querySelector('#view').innerText.includes('手入力')`);
  rateMode = 'ok';
  await ev(`import('./js/rates.js').then((m) => m.resolvePending())`);
  let s = (await data()).sessions[0];
  assert(s.rate.manual && s.rate.value === 149, '手入力は自動取得で上書きされない');
  includes(await text(), '+37,250円');
  // 日付を変えると取り直し
  await go(`#/sessions/${id}/edit`);
  await waitFor(`document.querySelector('[name=date]')`);
  await setVal('[name=date]', '2026-04-06');
  includes(await text('[data-rate-note]'), '手入力レートを解除');
  await click('[data-act=save]');
  await waitFor(`document.querySelector('#view').innerText.includes('1 USD = 150円')`, 5000, '取り直し');
  s = (await data()).sessions[0];
  assert(!s.rate.manual && s.rate.date === '2026-04-06', '新しいプレイ日のレート');
});

test('保存失敗：成功したように見せず、入力内容を残す', async () => {
  await fresh();
  await go('#/sessions/new');
  await waitFor(`document.querySelector('[name=location]')`);
  await setVal('[name=location]', 'Fail Club');
  await setVal('[name=sb]', '1'); await setVal('[name=bb]', '2'); await setVal('[name=hours]', '1');
  await setVal('[name=buyin]', '100'); await setVal('[name=cashout]', '50');
  await ev(`window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }`);
  await click('[data-act=save]');
  await waitFor(`document.querySelector('.toast-error')`, 3000, 'エラー表示');
  includes(await text('.toast-error'), '保存に失敗しました');
  assert((await ev('location.hash')) === '#/sessions/new', '画面は入力フォームのまま');
  assert((await ev(`document.querySelector('[name=location]').value`)) === 'Fail Club', '入力内容が残る');
  await ev(`Storage.prototype.setItem = window.__setItem`);
  await click('[data-act=save]');
  await waitFor(`/^#\\/sessions\\/[^/n]/.test(location.hash)`, 3000, '再試行で保存');
});

test('削除：確認後に削除し、元に戻せる', async () => {
  await fresh();
  rateMode = 'ok';
  await manualSession();
  await click('[data-act=delete]');
  await waitFor(`document.querySelector('.modal .btn-danger')`);
  await click('.modal .btn-danger');
  await waitFor(`location.hash === '#/sessions'`);
  assert((await data()).sessions.length === 0, '削除された');
  await click('.toast-action');
  await sleep(200);
  assert((await data()).sessions.length === 1, '元に戻せる');
});

test('遠征の削除：記録は黙って消えない', async () => {
  await fresh();
  await seed({ trips: [{ id: 't1', name: 'T', startDate: '2026-04-01', endDate: null, expenses: null }], sessions: [{ id: 's1', tripId: 't1', date: '2026-04-02', location: 'A', currency: 'JPY', sb: 1, bb: 2, buyin: 100, cashout: 200, timeRake: 0, minutes: 60, rate: null }] });
  await go('#/trips/t1');
  await click('[data-act=delete]');
  await waitFor(`document.querySelector('.modal')`);
  includes(await text('.modal'), '1件のプレイ記録');
  await modalPrimary(); // 記録は残す
  await waitFor(`location.hash === '#/trips'`);
  const d = await data();
  assert(d.trips.length === 0 && d.sessions.length === 1 && d.sessions[0].tripId === null, '記録は遠征なしで残る');
});

test('デモ：仕様の数値どおり、実データと進行中セッションを上書きしない', async () => {
  await fresh();
  const now = Date.now();
  await seed({ sessions: [{ id: 'real1', tripId: null, date: '2026-09-01', location: 'Real', currency: 'JPY', sb: 1, bb: 2, buyin: 100, cashout: 300, timeRake: 0, minutes: 60, rate: null }], active: { id: 'act', tripId: null, location: 'RealLive', currency: 'USD', sb: 1, bb: 2, date: '2026-09-20', tz: 'Asia/Tokyo', startedAt: now, segments: [{ s: now, e: null }], status: 'playing', buyins: [], draft: null } });
  const before = await ev(`localStorage.getItem('tripledger:data:v1')`);
  await go('#/settings');
  await click('[data-act=demo]');
  await waitFor(`document.querySelector('.banner-demo')`);
  await go('#/stats');
  let t = await text();
  includes(t, '+71,120円');
  includes(t, '−21,600円'); includes(t, '+56,720円');
  await click('[data-scope=period]');
  await setVal('[data-f=from]', '2026-04-01');
  await setVal('[data-f=to]', '2026-04-02');
  t = await text();
  includes(t, '+21,000円'); includes(t, '+3,000円/時'); includes(t, '+4.0 bb/時');
  await setVal('[data-f=view]', 'USD');
  t = await text();
  includes(t, '+140 USD'); includes(t, '+20 USD/時');
  await go('#/sessions/demo-s1');
  t = await text();
  includes(t, '+240 USD'); includes(t, '+36,000円'); includes(t, '+48 USD/時'); includes(t, '+9.6 bb/時');
  // デモ中にタイマー開始しても実データは変わらない
  await go('#/');
  assert(await ev(`localStorage.getItem('tripledger:data:v1')`) === before, 'デモ操作で実データが変わらない');
  includes(await text(), '通常モードで進行中のセッションがあります');
  await click('[data-banner=exit-demo]');
  await waitFor(`!document.querySelector('.banner-demo')`);
  includes(await text(), 'RealLive');
  await ev(`sessionStorage.clear()`);
});

test('成績の追加指標：最大の勝ち・負け・ドローダウン、bbグラフ、比較の並べ替え', async () => {
  await fresh();
  await ev(`sessionStorage.setItem('tripledger:demo', '1')`);
  await reload();
  await go('#/stats');
  await click('[data-scope=all]');
  await setVal('[data-f=view]', 'YEN');
  let t = await text();
  includes(t, '最大の勝ち'); includes(t, '+41,720円');
  includes(t, '最大の負け'); includes(t, '−15,000円');
  includes(t, '最大ドローダウン');
  includes(t, '平均プレイ時間'); includes(t, '3時間30分');
  await click('[data-chart-unit=bb]');
  includes(await text('.chart-readout'), '+108.5 bb');
  await click('[data-chart-unit=money]');
  await click('[data-sort=hourly]');
  const names = await ev(`[...document.querySelector('.sort-row').parentElement.querySelectorAll('.cmp-name')].map((e) => e.textContent.trim())`);
  assert(names[0] === 'Club B' && names.at(-1) === 'Room E', `時給順: ${names.join(', ')}`);
  await click('[data-sort=time]');
  await ev(`sessionStorage.clear()`);
});

test('遠征の比較：損益・時給・経費をまかなう時給', async () => {
  await fresh();
  await ev(`sessionStorage.setItem('tripledger:demo', '1')`);
  await reload();
  await go('#/trips');
  await click('a[href="#/trips/compare"]');
  await waitFor(`location.hash === '#/trips/compare' && document.querySelector('.trip-cmp')`);
  const t = await text();
  includes(t, '米国テスト'); includes(t, 'アジアテスト');
  includes(t, '+56,720円'); includes(t, '−21,600円');
  includes(t, '429円/時'); // 6,000円 ÷ 14時間
  includes(t, '2,143円/時'); // 30,000円 ÷ 14時間
  includes(t, '上回った'); includes(t, '届かず');
  await click('[data-sort=net]');
  const first = await ev(`document.querySelector('.trip-cmp .trip-name').textContent`);
  assert(first === '米国テスト', '損益順');
  await ev(`sessionStorage.clear()`);
});

test('バックアップ：お知らせ、共有シートで保存、あとで、復元', async () => {
  await fresh();
  await seed({ sessions: [{ id: 's1', tripId: null, date: '2026-09-01', location: 'A', currency: 'JPY', sb: 1, bb: 2, buyin: 100, cashout: 300, timeRake: 0, minutes: 60, rate: null }] });
  includes(await text(), 'まだ一度もバックアップしていません');
  // 共有シートを差し替え
  await ev(`window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = { name: d.files[0].name, text: await d.files[0].text() }; }`);
  await click('[data-act=backup]');
  await waitFor(`window.__shared`);
  const shared = await ev('window.__shared');
  assert(/^trip-ledger-backup-\d{4}-\d{2}-\d{2}\.json$/.test(shared.name), 'ファイル名');
  assert(JSON.parse(shared.text).data.sessions.length === 1, '中身に記録が入っている');
  await waitFor(`!document.querySelector('.notice-backup')`);
  assert((await data()).prefs.lastBackupAt > 0, '最終バックアップ日時');
  // キャンセルは記録しない
  await ev(`navigator.share = async () => { throw new DOMException('x', 'AbortError'); }`);
  const last = (await data()).prefs.lastBackupAt;
  await go('#/settings');
  await click('[data-act=export]');
  await waitFor(`document.querySelector('.toast')?.innerText.includes('中止')`);
  assert((await data()).prefs.lastBackupAt === last, 'キャンセル時は更新しない');
  // 7日たつとお知らせ、「あとで」で消える
  const d = await data();
  d.prefs.lastBackupAt = Date.now() - 8 * 86400e3; d.lastChangeAt = Date.now();
  await seed(d);
  await go('#/');
  includes(await text(), '8日たっています');
  await click('[data-act=snooze-backup]');
  await reload();
  assert(!(await ev(`!!document.querySelector('.notice-backup')`)), 'あとで → 非表示');
  // 復元
  const backup = JSON.stringify({ data: { trips: [], sessions: [{ id: 'r1', tripId: null, date: '2026-01-01', location: 'Restored', currency: 'JPY', sb: 1, bb: 2, buyin: 1, cashout: 2, timeRake: 0, minutes: 30, rate: null }] } });
  await go('#/settings');
  await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${q(backup)}], 'b.json', { type: 'application/json' })); const i = document.querySelector('input[data-act=import]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelector('.modal .btn-danger')`);
  await click('.modal .btn-danger');
  await waitFor(`JSON.parse(localStorage.getItem('tripledger:data:v1')).sessions[0]?.location === 'Restored'`);
});

test('オフライン：一度読み込めば、通信なしで起動・記録・閲覧できる', async () => {
  await fresh();
  await waitFor(`navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active))`, 10000, 'SW有効化');
  await reload();
  await waitFor(`!!navigator.serviceWorker.controller`, 5000, 'SW制御');
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await reload();
    includes(await text(), 'プレイ開始', 'オフライン起動');
    await go('#/live/start');
    await setVal('[name=location]', 'Offline');
    await setVal('[name=sb]', '1'); await setVal('[name=bb]', '2');
    await click('[data-act=start]');
    await waitFor(`location.hash === '#/' && document.querySelector('.live-card')`);
    await go('#/stats');
    includes(await text(), '成績');
  } finally {
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
});

test('画面幅：375px・430px で横にはみ出さない', async () => {
  await fresh();
  await ev(`sessionStorage.setItem('tripledger:demo', '1')`);
  const routes = ['#/', '#/sessions', '#/sessions/demo-s3', '#/sessions/new', '#/stats', '#/trips', '#/trips/demo-trip-b', '#/trips/compare', '#/settings', '#/live/start'];
  const bad = [];
  for (const w of [375, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: true });
    for (const r of routes) {
      await go(r);
      await sleep(150);
      if (await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)) bad.push(`${w}px ${r}`);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await ev(`sessionStorage.clear()`);
  assert(!bad.length, `横はみ出し: ${bad.join(', ')}`);
});

/* ---------- 実行 ---------- */
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*frankfurter.dev*' }, { urlPattern: '*jsdelivr.net*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: BASE });
await waitFor(`document.documentElement.classList.contains('ready')`, 10000, '初回起動');

let failed = 0;
for (const t of tests) {
  const errBefore = jsErrors.length;
  try {
    await t.fn();
    if (jsErrors.length > errBefore) throw new Error(`画面でJSエラー: ${jsErrors.slice(errBefore).join(' / ')}`);
    console.log(`ok   - ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${t.name}\n       ${String(e.message).split('\n').join('\n       ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
ws.close();
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
process.exit(failed ? 1 : 0);
