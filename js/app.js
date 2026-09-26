// アプリ本体：画面の切り替え、共通バナー、タブバー、タイマー表示の更新、オフライン対応
import * as store from './store.js';
import { autoResolve, onRateState } from './rates.js';
import { esc, fmtElapsed, fmtStake } from './util.js';
import { icons, toast } from './ui.js';
import * as A from './actions.js';
import { renderHome } from './views/home.js';
import { renderLiveStart, renderLiveEdit, tickLive } from './views/live.js';
import { renderSessionForm } from './views/sessionForm.js';
import { renderSessionList, renderSessionDetail } from './views/sessions.js';
import { renderStats } from './views/stats.js';
import { renderTripList, renderTripDetail, renderTripForm } from './views/trips.js';
import { renderTripCompare } from './views/tripCompare.js';
import { renderSettings } from './views/settings.js';

const routes = [
  { re: /^\/$/, tab: 'home', live: true, render: (el) => renderHome(el) },
  { re: /^\/live\/start$/, tab: 'home', form: true, render: (el) => renderLiveStart(el) },
  { re: /^\/live\/edit$/, tab: 'home', form: true, render: (el) => renderLiveEdit(el) },
  { re: /^\/live\/finish$/, tab: 'home', form: true, render: (el) => renderSessionForm(el, { mode: 'finish' }) },
  { re: /^\/sessions$/, tab: 'sessions', live: true, render: (el) => renderSessionList(el) },
  { re: /^\/sessions\/new$/, tab: 'sessions', form: true, render: (el, m, q) => renderSessionForm(el, { mode: 'new', presetTrip: q.trip }) },
  { re: /^\/sessions\/([^/]+)\/edit$/, tab: 'sessions', form: true, render: (el, m) => renderSessionForm(el, { mode: 'edit', id: m[1] }) },
  { re: /^\/sessions\/([^/]+)$/, tab: 'sessions', live: true, render: (el, m) => renderSessionDetail(el, { id: m[1] }) },
  { re: /^\/stats$/, tab: 'stats', live: true, render: (el, m, q) => renderStats(el, { query: q }) },
  { re: /^\/trips$/, tab: 'trips', live: true, render: (el) => renderTripList(el) },
  { re: /^\/trips\/compare$/, tab: 'trips', live: true, render: (el) => renderTripCompare(el) },
  { re: /^\/trips\/new$/, tab: 'trips', form: true, render: (el) => renderTripForm(el, {}) },
  { re: /^\/trips\/([^/]+)\/edit$/, tab: 'trips', form: true, render: (el, m) => renderTripForm(el, { id: m[1] }) },
  { re: /^\/trips\/([^/]+)$/, tab: 'trips', live: true, render: (el, m) => renderTripDetail(el, { id: m[1] }) },
  { re: /^\/settings$/, tab: 'settings', live: true, render: (el) => renderSettings(el) },
];

const TABS = [
  ['home', '#/', 'ホーム', 'home'],
  ['sessions', '#/sessions', '記録', 'list'],
  ['stats', '#/stats', '成績', 'chart'],
  ['trips', '#/trips', '遠征', 'trip'],
  ['settings', '#/settings', '設定', 'gear'],
];

let current = null;
let cleanup = null;
let lastPath = null;

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  const [path, qs] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path: path || '/', query };
}

function render({ keepScroll = false } = {}) {
  const { path, query } = parseHash();
  let route = null;
  let m = null;
  for (const r of routes) {
    m = path.match(r.re);
    if (m) { route = r; break; }
  }
  if (!route) { location.replace('#/'); return; }
  current = route;
  if (cleanup) { try { cleanup(); } catch { /* noop */ } cleanup = null; }

  const view = document.getElementById('view');
  const el = document.createElement('div');
  el.className = 'view';
  const y = window.scrollY;
  view.replaceChildren(el);
  try {
    const c = route.render(el, m, query);
    if (typeof c === 'function') cleanup = c;
  } catch (e) {
    console.error(e);
    el.innerHTML = `
      <div class="page">
        <div class="notice notice-error">${icons.alert}<div><b>画面を表示できませんでした</b><span>${esc(e.message || e)}</span></div></div>
        <button type="button" class="btn btn-ghost btn-block" onclick="location.hash='#/';location.reload()">ホームに戻って再読み込み</button>
      </div>`;
  }
  const samePath = lastPath === path;
  lastPath = path;
  if (keepScroll || samePath) window.scrollTo(0, y);
  else window.scrollTo(0, 0);

  document.body.classList.toggle('is-form', !!route.form);
  renderChrome(route);
}

function renderChrome(route) {
  const db = store.getDb();
  // デモ・保存エラーのバナー
  const banner = document.getElementById('banner');
  const notices = [];
  if (store.isDemo()) {
    notices.push(`<div class="banner banner-demo"><span><b>デモ表示中</b>・架空データです（実データには影響しません）</span><button type="button" class="banner-btn" data-banner="exit-demo">通常に戻る</button></div>`);
  }
  if (!store.status.storageOk || store.status.blocked) {
    notices.push(`<div class="banner banner-error"><span>${esc(store.status.notice || '保存領域を利用できません')}</span></div>`);
  } else if (store.status.repaired) {
    notices.push(`<div class="banner banner-warn"><span>${esc(store.status.repaired)}</span><button type="button" class="banner-btn" data-banner="dismiss-repaired">閉じる</button></div>`);
  }
  banner.innerHTML = notices.join('');

  // タブバー
  const tabbar = document.getElementById('tabbar');
  tabbar.innerHTML = TABS.map(([k, href, label, icon]) => `
    <a class="tab ${route.tab === k ? 'on' : ''}" href="${href}" ${route.tab === k ? 'aria-current="page"' : ''}>${icons[icon]}<span>${label}</span></a>`).join('');

  // ホーム以外でも進行中セッションが分かるミニバー
  const mini = document.getElementById('livebar');
  const a = db.active;
  const onHome = /^\/$|^\/live\//.test(parseHash().path);
  if (a && !onHome) {
    const label = a.status === 'playing' ? 'プレイ中' : a.status === 'break' ? '休憩中' : '精算入力中';
    mini.hidden = false;
    mini.innerHTML = `
      <a class="livebar status-${esc(a.status)}" href="${a.status === 'settling' ? '#/live/finish' : '#/'}">
        <span class="live-status"><span class="pulse"></span>${label}</span>
        <span class="livebar-time" data-tick="elapsed">${fmtElapsed(A.liveElapsedMs(a))}</span>
        <span class="livebar-info">${esc(a.location)} · ${esc(fmtStake(a.currency, a.sb, a.bb))}</span>
        <span class="chev">${icons.chevron}</span>
      </a>`;
  } else {
    mini.hidden = true;
    mini.innerHTML = '';
  }
  document.body.classList.toggle('has-livebar', !mini.hidden);
}

function rerenderIfLive() {
  if (current && current.live) render({ keepScroll: true });
  else if (current) renderChrome(current);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const promptUpdate = (w) => {
      toast('新しいバージョンがあります', { action: { label: '更新', fn: () => w.postMessage('SKIP_WAITING') }, duration: 15000 });
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW登録に失敗', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function boot() {
  store.init();
  store.subscribe((info) => {
    if (info && info.mode) { render(); return; }
    rerenderIfLive();
  });
  onRateState(() => rerenderIfLive());

  document.getElementById('banner').addEventListener('click', (e) => {
    const b = e.target.closest('[data-banner="exit-demo"]');
    if (b) { store.exitDemo(); toast('通常利用に戻りました'); location.hash = '#/'; }
    if (e.target.closest('[data-banner="dismiss-repaired"]')) { store.dismissRepaired(); if (current) renderChrome(current); }
  });

  window.addEventListener('hashchange', () => render());
  window.addEventListener('online', () => { toast('オンラインに戻りました'); rerenderIfLive(); autoResolve(true); });
  window.addEventListener('offline', () => { toast('オフラインです。記録・タイマー・閲覧はそのまま使えます'); rerenderIfLive(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tickLive(document);
      // 画面復帰時に止め忘れの警告などを最新にする
      if (store.getDb().active) rerenderIfLive();
      autoResolve();
    }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) render({ keepScroll: true }); });
  setInterval(() => { if (document.visibilityState === 'visible') tickLive(document); }, 1000);

  render();
  document.getElementById('boot')?.remove();
  document.documentElement.classList.add('ready');
  autoResolve(true);
  if (store.getRealDb().sessions.length) store.requestPersist();
  registerSW();
}

try {
  boot();
} catch (e) {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = `<p>起動に失敗しました：${esc(e.message)}</p><button type="button" onclick="location.reload()">再読み込み</button>`;
}
