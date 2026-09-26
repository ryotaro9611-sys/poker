// ホーム：プレイ開始ボタン／進行中セッションを最優先で表示
import { getDb, getRealDb, isDemo, enterDemo } from '../store.js';
import * as A from '../actions.js';
import { summarize, tripResult, sortSessions, sessionRate } from '../calc.js';
import { esc, fmtYen, fmtDuration, fmtBBph, fmtDateRange, fmtStake, fmtAmount, signClass, todayYMD, fmtDate } from '../util.js';
import { icons, toast, showError, busy, emptyState } from '../ui.js';
import { liveCardHtml, bindLiveCard, quickStartInfo } from './live.js';
import { backupReminder, snoozeBackupReminder } from '../backup.js';
import { runBackup } from './settings.js';
import { sessionRow, pendingNotice, bindPendingNotice } from './sessions.js';

function currentTrip(db) {
  const today = todayYMD();
  const t = A.tripForDate(db, today);
  if (t) return { trip: t, current: true };
  const latest = [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  return latest ? { trip: latest, current: false } : null;
}

export function tripSummaryCard(db, trip, { label = '' } = {}) {
  const r = tripResult(trip, db.sessions);
  return `
    <a class="card trip-card" href="#/trips/${esc(trip.id)}">
      <div class="trip-card-head">
        <div>
          ${label ? `<span class="eyebrow">${esc(label)}</span>` : ''}
          <h3 class="trip-name">${esc(trip.name)}</h3>
          <p class="trip-dates">${esc(fmtDateRange(trip.startDate, trip.endDate))}</p>
        </div>
        <span class="chev">${icons.chevron}</span>
      </div>
      <div class="trip-figures">
        <div class="fig"><span class="k">ポーカー収支</span><span class="v ${signClass(r.summary.jpy.profit)}">${r.summary.count ? esc(fmtYen(r.summary.jpy.profit)) : '—'}</span></div>
        <div class="fig"><span class="k">経費</span><span class="v">${r.expenses == null ? '<span class="muted">未入力</span>' : esc(fmtYen(r.expenses, { sign: false }))}</span></div>
        <div class="fig fig-strong"><span class="k">遠征損益${r.provisional ? '<span class="badge badge-warn">暫定</span>' : ''}</span><span class="v ${signClass(r.net)}">${r.summary.count || r.expenses != null ? esc(fmtYen(r.net)) : '—'}</span></div>
      </div>
      ${r.provisional && (r.summary.count || r.expenses != null) ? `<p class="trip-note">${esc(r.reasons.join('・'))}のため暫定</p>` : ''}
    </a>`;
}

export function renderHome(el) {
  const db = getDb();
  const a = db.active;
  const qs = !a ? quickStartInfo(db) : null;
  const draft = db.drafts['new-session'];
  const pending = db.sessions.filter((s) => sessionRate(s) == null).length;
  const ct = currentTrip(db);
  const all = summarize(db.sessions);
  const recent = sortSessions(db.sessions, -1).slice(0, 3);
  const firstRun = !db.sessions.length && !db.trips.length && !a;
  const realActive = isDemo() && getRealDb() && getRealDb().active;
  const reminder = backupReminder(db);

  el.innerHTML = `
    <header class="home-head">
      <div>
        <p class="brand">TRIP LEDGER</p>
        <p class="home-date">${esc(fmtDate(todayYMD()))}</p>
      </div>
      ${navigator.onLine === false ? `<span class="pill pill-offline">${icons.offline}<span>オフライン</span></span>` : ''}
    </header>
    <div class="page page-home">
      ${realActive ? `<div class="notice notice-info">${icons.clock}<div>通常モードで進行中のセッションがあります。計測はそのまま続いています。</div></div>` : ''}
      ${a ? liveCardHtml(db) : `
        <section class="start-hero">
          <a class="btn-start" href="#/live/start">
            <span class="btn-start-icon">${icons.play}</span>
            <span class="btn-start-text"><b>プレイ開始</b><small>タイマーで記録する</small></span>
          </a>
          ${qs ? `
            <button type="button" class="quick-start" data-act="quick-start">
              <span class="qs-label">前回と同じ設定で開始</span>
              <span class="qs-detail">${esc(qs.location)} · ${esc(fmtStake(qs.currency, qs.sb, qs.bb))}${qs.buyin ? ` · ${esc(fmtAmount(qs.buyin, qs.currency))}` : ''}</span>
            </button>` : ''}
          <a class="btn btn-ghost btn-block" href="#/sessions/new">${icons.plus}<span>終わったプレイを記録</span></a>
        </section>`}

      ${draft ? `<a class="notice notice-info notice-link" href="#/sessions/new">${icons.edit}<div><b>入力途中の記録があります</b><span>タップして続きを入力</span></div><span class="chev">${icons.chevron}</span></a>` : ''}
      ${pending ? pendingNotice(pending) : ''}
      ${reminder ? `
        <div class="notice notice-info notice-backup">
          ${icons.download}
          <div>
            <b>バックアップのおすすめ</b>
            <span>${esc(reminder.reason)}記録はこのiPhoneの中にしかありません。</span>
            <div class="btn-row">
              <button type="button" class="btn btn-small btn-primary" data-act="backup">${icons.download}<span>今すぐバックアップ</span></button>
              <button type="button" class="btn btn-small btn-ghost" data-act="snooze-backup">あとで</button>
            </div>
          </div>
        </div>` : ''}

      ${firstRun ? emptyState({
        icon: 'trip',
        title: 'ようこそ',
        text: '遠征を作成すると、プレイ記録と経費をまとめて遠征全体の損益を確認できます。遠征を作らずにプレイを始めることもできます。',
        actions: `<a class="btn btn-ghost" href="#/trips/new">${icons.trip}<span>遠征を作成</span></a>${isDemo() ? '' : `<button type="button" class="btn btn-ghost" data-act="demo">${icons.eye}<span>デモを見る</span></button>`}`,
      }) : ''}

      ${ct ? tripSummaryCard(db, ct.trip, { label: ct.current ? '開催中の遠征' : '直近の遠征' }) : ''}

      ${db.sessions.length ? `
        <a class="card summary-card" href="#/stats">
          <div class="summary-head"><span class="eyebrow">全期間のポーカー収支（円換算）</span><span class="chev">${icons.chevron}</span></div>
          <div class="summary-amount ${signClass(all.jpy.profit)}">${esc(fmtYen(all.jpy.profit))}</div>
          ${all.jpy.pending ? `<p class="summary-note"><span class="badge badge-warn">換算待ち${all.jpy.pending}件</span> 換算済み${all.jpy.count}件分の合計</p>` : ''}
          <div class="summary-meta">
            <span>${all.count}セッション</span><span>${esc(fmtDuration(all.minutes))}</span><span class="${signClass(all.bbPerHour)}">${esc(fmtBBph(all.bbPerHour))}</span>
          </div>
        </a>
        <section>
          <div class="section-head"><h2 class="section-title">最近の記録</h2><a class="link" href="#/sessions">すべて見る</a></div>
          <div class="list card">${recent.map((s) => sessionRow(s, db)).join('')}</div>
        </section>` : ''}
    </div>`;

  bindLiveCard(el);
  bindPendingNotice(el);
  el.querySelector('[data-act="quick-start"]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    busy(btn, async () => {
      try {
        A.startLive(quickStartInfo(getDb()));
        toast('タイマーを開始しました', { type: 'success' });
      } catch (err) { showError(err); }
    });
  });
  el.querySelector('[data-act="backup"]')?.addEventListener('click', (e) => runBackup(e.currentTarget));
  el.querySelector('[data-act="snooze-backup"]')?.addEventListener('click', () => {
    try { snoozeBackupReminder(); } catch { /* 保存できなくても表示を消すだけ */ }
    el.querySelector('.notice-backup')?.remove();
    toast('3日後にもう一度お知らせします');
  });
  el.querySelector('[data-act="demo"]')?.addEventListener('click', () => { enterDemo(); toast('デモを表示しています（実データには影響しません）'); });
}
