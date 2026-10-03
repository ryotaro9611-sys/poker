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
// 更新のテスト用：swVersion を入れると、その版名の sw.js を返す（新しい版の公開を再現）
let swVersion = null;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (p === '/sw.js' && swVersion) {
    res.end(fs.readFileSync(file, 'utf8').replace(/const VERSION = '[^']+';/, `const VERSION = '${swVersion}';`));
    return;
  }
  if (p === '/js/views/settings.js' && swVersion) {
    // 新しい版のアプリ本体（JS）も配信する：画面に出る版名を変える
    res.end(fs.readFileSync(file, 'utf8').replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${swVersion}'`));
    return;
  }
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* ---------- Chrome ---------- */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tripledger-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
  if (m.method === 'Fetch.requestPaused') handleRateRequest(m.params);
});

/* ---------- 為替APIの差し替え ----------
 * rateMode: 'ok'（要求日のレート）/ 'fail'（通信失敗）/ 'mixed'（要求日なし・未来日あり）
 *           'fallback'（Frankfurter失敗→currency-apiで成功）/ 'hold'（応答を保留。releaseHeld() で返す）
 */
const held = [];
function addDays(ymd, n) {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}
const harnessErrors = [];
// ページの再読み込み等で保留中の要求が消えるのは想定内。それ以外は記録してテストを失敗させる
function cdpSettle(p) {
  return p.catch((e) => { if (!/Invalid InterceptionId|No resource with given id/i.test(e.message)) harnessErrors.push(e.message); });
}
process.on('unhandledRejection', (e) => { harnessErrors.push(`未処理のPromise: ${e && e.message ? e.message : e}`); });
function fulfillJson(requestId, obj) {
  return cdpSettle(send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    body: Buffer.from(JSON.stringify(obj)).toString('base64'),
  }));
}
const failReq = (requestId) => cdpSettle(send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }));
function answerRate({ requestId, request }, mode) {
  const url = new URL(request.url);
  if (mode === 'fail') return failReq(requestId);
  if (url.hostname.includes('frankfurter')) {
    if (mode === 'fallback') return failReq(requestId);
    const base = url.searchParams.get('base');
    const to = url.searchParams.get('to');
    const rows = mode === 'mixed'
      ? [{ date: addDays(to, -3), rate: 140 }, { date: addDays(to, -2), rate: 141 }, { date: addDays(to, 2), rate: 999 }]
      : [{ date: to, rate: MOCK_RATES[base] }];
    return fulfillJson(requestId, rows.map((r) => ({ ...r, base, quote: 'JPY' })));
  }
  // currency-api（jsDelivr）: .../currency-api@YYYY-MM-DD/v1/currencies/usd.json
  const mm = /currency-api@(\d{4}-\d{2}-\d{2})\/v1\/currencies\/([a-z]+)\.json/.exec(url.pathname);
  if (mode === 'fallback' && mm) return fulfillJson(requestId, { date: mm[1], [mm[2]]: { jpy: 155 } });
  return failReq(requestId);
}
function handleRateRequest(params) {
  rateRequests.push(params.request.url);
  if (rateMode === 'hold') { held.push(params); return; }
  answerRate(params, rateMode);
}
function releaseHeld(mode = 'ok') {
  while (held.length) answerRate(held.shift(), mode);
}

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
  // 古いページの「起動完了」を見て先へ進まないよう、目印を付けてから再読み込みし、新しいページの起動を待つ
  await ev(`window.__beforeReload = true`);
  await send('Page.reload');
  await waitFor(`!window.__beforeReload && document.documentElement.classList.contains('ready')`, 8000, '起動');
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

import nodeAssert from 'node:assert/strict';

const KEY = 'tripledger:data:v1';
const canonical = (d) => { const { lastChangeAt, ...rest } = d; return rest; };
const fixture = {
  version: 1,
  trips: [{ id: 'audit-trip', name: '架空遠征', startDate: '2026-04-01', endDate: '2026-04-30', expenses: 12345, note: '架空データのみ', createdAt: 1775000000000, updatedAt: 1775000000001 }],
  sessions: ['USD', 'PHP', 'JPY', 'KRW'].map((currency, i) => ({
    id: `audit-${currency}`, tripId: 'audit-trip', date: '2026-04-04', location: `架空 ${currency}`, currency,
    sb: 0.25, bb: 0.5, buyin: 123.45, cashout: 200.01, timeRake: 1.23, minutes: 73,
    rate: currency === 'JPY' ? null : { value: [150.123456, 2.654321, 1, 0.123456][i], date: '2026-04-03', source: i === 0 ? '手入力' : '架空レート', manual: i === 0, ...(i === 0 ? { setAt: '2026-04-04T01:02:03.456Z' } : { fetchedAt: '2026-04-04T01:02:03.456Z', url: 'https://example.invalid' }) },
    condition: 3, tags: ['tired'], note: '日本語・小数・現地日時 🃏', createdAt: 1775264400000 + i, updatedAt: 1775264400005 + i,
    startedAt: 1775264400000, endedAt: 1775268800123, tz: i === 0 ? 'America/Los_Angeles' : 'Asia/Manila', breakMinutes: 0, timerMinutes: 73,
  })),
  active: { id: 'audit-live', tripId: 'audit-trip', location: '架空進行中', currency: 'PHP', sb: 1.25, bb: 2.5, date: '2026-04-05', tz: 'Asia/Manila', startedAt: 1775340000000, segments: [{ s: 1775340000000, e: 1775341800000 }, { s: 1775342100000, e: null }], status: 'playing', buyins: [{ amount: 345.67, at: 1775340000000 }, { amount: 12.34, at: 1775342400000 }], condition: 4, draft: { cashout: '400.01', note: '未保存下書き', tags: ['tired'] }, rev: 7 },
  drafts: { 'new-session': { date: '2026-04-04', currency: 'USD', buyin: '123.45', cashout: '200.01', note: '架空下書き', savedAt: 1775264400000 } },
  prefs: { lastTripId: 'audit-trip', lastCurrency: 'PHP', lastLocation: '架空進行中', stakes: { PHP: { sb: 1.25, bb: 2.5 } }, buyins: { PHP: 345.67 } },
  rateCache: { 'USD|2026-04-04': { value: 150.123456, date: '2026-04-03', source: '架空レート', url: 'https://example.invalid' } },
};

async function anotherTab(url = BASE, before = '') {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener('open', r));
  let n = 0; const pending = new Map();
  const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = pending.get(m.id); if (!w) return; pending.delete(m.id); if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result); });
  const evaluate = async (expression) => { const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await cmd('Page.enable'); await cmd('Runtime.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.fetch = (...args) => Promise.reject(new TypeError('Audit: external networking disabled')); ${before}` });
  await cmd('Page.navigate', { url });
  const end = Date.now() + 10000;
  while (Date.now() < end) { try { if (await evaluate(`document.documentElement.classList.contains('ready')`)) break; } catch {} await sleep(60); }
  assert(await evaluate(`document.documentElement.classList.contains('ready')`), '追加タブ起動');
  return { ev: evaluate, cmd, close: async () => { try { await cmd('Page.close'); } finally { socket.close(); } } };
}

async function uiImport(json) {
  await go('#/settings');
  await ev(`(() => { const d = new DataTransfer(); d.items.add(new File([${q(json)}], 'audit.json', { type: 'application/json' })); const input = document.querySelector('input[data-act=import]'); input.files = d.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`!!document.querySelector('.modal .btn-danger')`);
  await click('.modal .btn-danger');
}

const addRecord = (label) => `import('./js/actions.js').then(m => m.createSession({tripId:null,date:'2026-04-04',location:${q(label)},currency:'JPY',sb:1,bb:2,buyin:123.45,cashout:200.01,timeRake:1.23,minutes:73,condition:3,tags:[],note:''}))`;

test('AUDIT round trip: save/reload/download/import into pristine separate origin; all currency/amount/time fields identical', async () => {
  await fresh();
  await ev(`import('./js/store.js').then(m => m.commit(d => Object.assign(d, ${q(fixture)})))`.replace(q(fixture), JSON.stringify(fixture)));
  const before = await data();
  await reload();
  nodeAssert.deepEqual(await ev(`import('./js/store.js').then(m => m.getRealDb())`), before);
  const downloads = path.join(profile, 'audit-downloads'); fs.mkdirSync(downloads, { recursive: true });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await ev(`Object.defineProperty(navigator, 'canShare', {configurable:true,value:() => false})`);
  const result = await ev(`import('./js/backup.js').then(m => m.backupNow())`);
  assert(result.ok && result.method === 'download', 'download branch completed');
  let files = [];
  for (let i = 0; i < 80; i++) { files = fs.readdirSync(downloads).filter(n => n.endsWith('.json')); if (files.length) break; await sleep(50); }
  assert(files.length, 'actual backup file downloaded');
  const json = fs.readFileSync(path.join(downloads, files.sort().at(-1)), 'utf8');
  nodeAssert.deepEqual(JSON.parse(json).data, before);
  const isolated = http.createServer(server.listeners('request')[0]); await new Promise(r => isolated.listen(0, '127.0.0.1', r));
  const tab = await anotherTab(`http://127.0.0.1:${isolated.address().port}/`);
  try {
    assert(await tab.ev(`localStorage.getItem('${KEY}')`) === null, 'separate storage starts empty');
    const restored = await tab.ev(`import('./js/store.js').then(m => {m.importJson(${q(json)}); return m.getRealDb()})`);
    nodeAssert.deepEqual(canonical(restored), canonical(before));
    await tab.cmd('Page.reload'); await sleep(400);
    nodeAssert.deepEqual(canonical(await tab.ev(`import('./js/store.js').then(m => m.getRealDb())`)), canonical(before));
    if (process.env.AUDIT_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.AUDIT_EVIDENCE_DIR, {recursive:true});
      fs.writeFileSync(path.join(process.env.AUDIT_EVIDENCE_DIR, 'roundtrip-summary.json'), JSON.stringify({ currencies: before.sessions.map(s => s.currency), sessionCount: before.sessions.length, activeId: before.active.id, preservedAllDataExceptImportChangeMarker: true }, null, 2));
    }
  } finally { await tab.close(); isolated.close(); }
});

test('AUDIT malformed imports and quota failures preserve current data exactly', async () => {
  await fresh(); await ev(addRecord('架空既存記録'));
  const raw = await ev(`localStorage.getItem('${KEY}')`);
  const cases = ['{"data":', 'null', JSON.stringify({ trips: [], sessions: [null] }), JSON.stringify({ data: { ...fixture, sessions: [fixture.sessions[0], fixture.sessions[0]] } }), JSON.stringify({ data: { ...fixture, sessions: [{ ...fixture.sessions[0], buyin: -1 }] } })];
  for (const bad of cases) {
    assert(await ev(`import('./js/store.js').then(m => {try {m.importJson(${q(bad)}); return false} catch {return true}})`), 'reject corrupted file');
    assert(await ev(`localStorage.getItem('${KEY}')`) === raw, 'storage unchanged');
  }
  await ev(`window.__nativeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='${KEY}')throw new DOMException('quota','QuotaExceededError');return window.__nativeSet.call(this,k,v)}`);
  try {
    const saved = await ev(`import('./js/store.js').then(m => {const before=JSON.stringify(m.getRealDb());try {m.importJson(${q(JSON.stringify({ data: fixture }))});return false}catch(e){return e.name==='SaveError' && before===JSON.stringify(m.getRealDb())}})`);
    assert(saved, 'failed restore preserves memory'); assert(await ev(`localStorage.getItem('${KEY}')`) === raw, 'failed restore preserves storage');
  } finally { await ev(`Storage.prototype.setItem=window.__nativeSet`); }
});

test('AUDIT real tabs: one writer, second-tab save rejected without data loss; stale edits rejected', async () => {
  await fresh(); const tab = await anotherTab();
  try {
    const first = await ev(addRecord('架空 A'));
    const rejectedWrite = await tab.ev(`import('./js/actions.js').then(async m=>{try{await (${addRecord('架空 B')});return false}catch(e){return e.name==='ConflictError'}})`);
    assert(rejectedWrite, 'second writer rejected');
    assert((await data()).sessions.length === 1, 'first record preserved');
    includes(await tab.ev(`document.getElementById('banner').innerText`), 'ほかの画面を閉じて', 'readonly banner');
    await ev(`import('./js/actions.js').then(m => m.updateSession(${q(first.id)}, ${q({ ...first, note: 'A changed' })}, ${first.updatedAt}))`.replace(q({ ...first, note: 'A changed' }), JSON.stringify({ ...first, note: 'A changed' })));
    const rejected = await tab.ev(`import('./js/actions.js').then(m=>{try{m.updateSession(${q(first.id)},${JSON.stringify({ ...first, note: 'stale B' })},${first.updatedAt});return false}catch(e){return e.name==='ConflictError'}})`);
    assert(rejected, 'old edit rejected'); assert((await data()).sessions.find(s => s.id === first.id).note === 'A changed', 'new note preserved');
  } finally { await tab.close(); }
});

test('AUDIT restore rejects changes made after confirmation while file read is pending', async () => {
  await fresh(); await ev(addRecord('架空 Before'));
  const backup = await ev(`import('./js/store.js').then(m => m.exportJson())`);
  const tab = await anotherTab();
  try {
    await ev(`window.__nativeText=File.prototype.text;File.prototype.text=function(){return window.__nativeText.call(this).then(t=>new Promise(r=>{window.__releaseImport=()=>r(t)}))}`);
    await uiImport(backup);
    await waitFor(`typeof window.__releaseImport==='function'`);
    const added = await ev(addRecord('架空 Added During Restore'));
    const updatedRaw = await ev(`localStorage.getItem('${KEY}')`);
    await ev(`window.__releaseImport()`); await sleep(250);
    assert(await ev(`localStorage.getItem('${KEY}')`) === updatedRaw, `restoring must not silently remove record ${added.id} added after confirmation`);
    assert((await data()).sessions.length === 2, 'both records retained');
    includes(await text('.toast-error'), '別の画面', 'conflict reported');
  } finally { await ev(`File.prototype.text=window.__nativeText`); await tab.close(); }
});

test('AUDIT backup reads latest saved data when another-tab storage event has not reached the page', async () => {
  await fresh(); await ev(addRecord('架空 Before Backup'));
  const delayed = await anotherTab(BASE, `window.addEventListener('storage',e=>e.stopImmediatePropagation(),true);`);
  try {
    await ev(addRecord('架空 Newly Saved'));
    const exported = JSON.parse(await delayed.ev(`import('./js/store.js').then(m=>m.exportJson())`));
    assert(exported.data.sessions.length === 2, `backup omitted a saved record: expected 2 got ${exported.data.sessions.length}`);
  } finally { await delayed.close(); }
});

test('AUDIT simultaneous real tab writes: acknowledged records never disappear', async () => {
  await fresh(); const tab = await anotherTab();
  try {
    const bulk = label => `import('./js/actions.js').then(m=>{let saved=0,rejected=0;for(let i=0;i<80;i++){try{m.createSession({tripId:null,date:'2026-04-04',location:${q(label)}+i,currency:'JPY',sb:1,bb:2,buyin:100,cashout:110,timeRake:0,minutes:60,condition:null,tags:[],note:''});saved++}catch(e){if(e.name!=='ConflictError')throw e;rejected++;break}}return {saved,rejected}})`;
    const results = await Promise.all([ev(bulk('架空 A ')), tab.ev(bulk('架空 B '))]);
    const count = (await data()).sessions.length;
    const saved = results.reduce((a,b)=>a+b.saved,0);
    assert(count === saved, `acknowledged ${saved} writes but only ${count} records persisted`);
    assert(results.some(r=>r.rejected>0), 'competing writer explicitly rejected');
  } finally { await tab.close(); }
});

test('AUDIT writer ownership transfers after original tab closes; unsupported lock API fails safely', async () => {
  const isolated = http.createServer(server.listeners('request')[0]); await new Promise(r => isolated.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${isolated.address().port}/`;
  let a = await anotherTab(base); let b;
  try {
    await a.ev(addRecord('架空 owner A'));
    b = await anotherTab(base);
    assert(await b.ev(`import('./js/store.js').then(m=>!m.status.writerOk)`), 'B starts readonly');
    await a.close(); a = null;
    for (let i=0;i<60;i++) {if(await b.ev(`import('./js/store.js').then(m=>m.status.writerOk)`))break;await sleep(50)}
    assert(await b.ev(`import('./js/store.js').then(m=>m.status.writerOk)`), 'lock transferred to B');
    await b.ev(addRecord('架空 owner B'));
    assert(await b.ev(`JSON.parse(localStorage.getItem('${KEY}')).sessions.length`)===2, 'handoff retains prior data');
    await b.close(); b = null;
    const unsupported = await anotherTab(base, `Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});`);
    try {
      const before = await unsupported.ev(`localStorage.getItem('${KEY}')`);
      assert(await unsupported.ev(`import('./js/store.js').then(m=>{try{m.commit(d=>d.sessions=[]);return false}catch(e){return e.name==='ConflictError'}})`), 'unsupported browser cannot write');
      assert(await unsupported.ev(`localStorage.getItem('${KEY}')`)===before, 'data unchanged');
      assert(JSON.parse(await unsupported.ev(`import('./js/store.js').then(m=>m.exportJson())`)).data.sessions.length===2, 'export still available');
    } finally { await unsupported.close(); }
  } finally {if(a)await a.close();if(b)await b.close();isolated.close()}
});

test('AUDIT clock rollback still marks newly saved records as unbacked', async () => {
  await fresh(); await ev(addRecord('架空 Before Clock Change'));
  await ev(`import('./js/store.js').then(m=>m.commit(d=>{d.prefs.lastBackupAt=Date.now();d.prefs.backupVersion=d.lastChangeAt},{touch:false}))`);
  await ev(`window.__nativeNow=Date.now;const time=Date.now()-3600000;Date.now=()=>time`);
  try { await ev(addRecord('架空 After Clock Change')); assert(await ev(`import('./js/backup.js').then(m=>m.hasUnbackedChanges())`), 'new data must remain marked unbacked after clock rollback'); }
  finally { await ev(`Date.now=window.__nativeNow`); }
});

// 独立reviewerの再現: backup共有待機中のrestoreでも変更番号を巻き戻さない。
test('AUDIT held backup completion after restore under clock rollback keeps restored state unbacked', async () => {
  await fresh();
  const old = await ev(addRecord('架空 original'));
  const oldBackup = await ev(`import('./js/store.js').then(m=>m.exportJson())`);
  await ev(`import('./js/actions.js').then(m=>m.updateSession(${q(old.id)},${JSON.stringify({...old,note:'edited after backup'})},${old.updatedAt}))`);
  await ev(addRecord('架空 another'));
  const before = await data();
  await ev(`Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:({files})=>{window.__reviewSharedFile=files[0];return new Promise(r=>window.__reviewFinishShare=r)}}); window.__reviewBackup=import('./js/backup.js').then(m=>m.backupNow()); true`);
  await waitFor(`typeof window.__reviewFinishShare==='function'`);
  await ev(`window.__nativeNow=Date.now;Date.now=()=>${before.lastChangeAt-3600000}`);
  try {
    await ev(`import('./js/store.js').then(m=>m.importJson(${q(oldBackup)}))`);
    const restored = await data();
    const shared = JSON.parse(await ev(`window.__reviewSharedFile.text()`)).data;
    assert(restored.sessions[0].note!==shared.sessions[0].note, 'restored note differs from pending export');
    await ev(`window.__reviewFinishShare();window.__reviewBackup`);
    assert(await ev(`import('./js/backup.js').then(m=>m.hasUnbackedChanges())`), 'restored content absent from completed export stays unbacked');
  } finally {await ev(`Date.now=window.__nativeNow`)}
});

test('AUDIT held backup completion after synthetic reset under rollback keeps newly saved state unbacked', async () => {
  await fresh(); await ev(addRecord('架空 Before Reset'));
  const before = await data();
  await ev(`Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:({files})=>new Promise(r=>window.__finishResetShare=r)});window.__resetBackup=import('./js/backup.js').then(m=>m.backupNow());true`);
  await waitFor(`typeof window.__finishResetShare==='function'`);
  await ev(`window.__nativeNow=Date.now;Date.now=()=>${before.lastChangeAt-3600000}`);
  try {
    await ev(`import('./js/store.js').then(m=>m.wipeAll())`); // 専用profile内の架空記録のみ
    await ev(addRecord('架空 After Reset'));
    await ev(`window.__finishResetShare();window.__resetBackup`);
    assert(await ev(`import('./js/backup.js').then(m=>m.hasUnbackedChanges())`), 'new content after reset stays unbacked');
  } finally { await ev(`Date.now=window.__nativeNow`); }
});
/* ---------- 実行 ---------- */
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*frankfurter.dev*' }, { urlPattern: '*jsdelivr.net*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: BASE });
await waitFor(`document.documentElement.classList.contains('ready')`, 10000, '初回起動');

let failed = 0;
// 例：TEST_FILTER=退避 node tests/e2e.mjs（名前に含まれる文字で絞り込み）
const selected = process.env.TEST_FILTER ? tests.filter((t) => t.name.includes(process.env.TEST_FILTER)) : tests;
try {
for (const t of selected) {
  const errBefore = jsErrors.length;
  const harnessBefore = harnessErrors.length;
  try {
    await t.fn();
    if (jsErrors.length > errBefore) throw new Error(`画面でJSエラー: ${jsErrors.slice(errBefore).join(' / ')}`);
    if (harnessErrors.length > harnessBefore) throw new Error(`テスト基盤のエラー: ${harnessErrors.slice(harnessBefore).join(' / ')}`);
    console.log(`ok   - ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${t.name}\n       ${String(e.message).split('\n').join('\n       ')}`);
  }
}
console.log(`\n${selected.length - failed}/${selected.length} passed`);
} finally {
  try { ws.close(); } catch { /* noop */ }
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
process.exit(failed ? 1 : 0);
