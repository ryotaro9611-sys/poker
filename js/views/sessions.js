// セッション一覧・詳細
import { getDb, isDemo } from '../store.js';
import * as A from '../actions.js';
import { resolvePending, rateState, isFutureDate } from '../rates.js';
import { sessionProfit, sessionProfitJPY, sessionBB, sessionRate, sortSessions, perHour, summarize } from '../calc.js';
import {
  esc, fmtDate, fmtDateShort, fmtMoney, fmtYen, fmtAmount, fmtBB, fmtBBph, fmtHourly, fmtDuration, fmtStake,
  fmtRate, fmtTimeInTz, signClass,
} from '../util.js';
import { header, icons, toast, showError, busy, confirmDialog, numberDialog, emptyState } from '../ui.js';
import { unitOf } from './fields.js';
import { conditionLabel, tagLabel } from '../tags.js';

export function yenLine(s) {
  if (s.currency === 'JPY') return '';
  const pj = sessionProfitJPY(s);
  if (pj == null) return `<span class="badge badge-warn">換算待ち</span>`;
  return `<span class="${signClass(pj)}">${esc(fmtYen(pj))}</span>${s.rate && s.rate.manual ? '<span class="badge badge-muted">手入力</span>' : ''}`;
}

export function sessionRow(s, db, { showTrip = true } = {}) {
  const p = sessionProfit(s);
  const trip = showTrip && s.tripId ? db.trips.find((t) => t.id === s.tripId) : null;
  return `
    <a class="row" href="#/sessions/${esc(s.id)}">
      <div class="row-main">
        <div class="row-title"><span class="row-name">${esc(s.location)}</span><span class="tag">${esc(fmtStake(s.currency, s.sb, s.bb))}</span></div>
        <div class="row-sub">${esc(fmtDateShort(s.date))}<span class="dot-sep">·</span>${esc(fmtDuration(s.minutes))}${trip ? `<span class="dot-sep">·</span>${esc(trip.name)}` : ''}</div>
      </div>
      <div class="row-side">
        <div class="amt ${signClass(p)}">${esc(fmtMoney(p, s.currency))}</div>
        <div class="amt-sub">${yenLine(s)}</div>
      </div>
    </a>`;
}

/* ---------------- 一覧 ---------------- */

let listFilter = 'all';

export function renderSessionList(el) {
  const db = getDb();
  if (listFilter !== 'all' && listFilter !== 'none' && !db.trips.some((t) => t.id === listFilter)) listFilter = 'all';
  const all = sortSessions(db.sessions, -1);
  const list = all.filter((s) => listFilter === 'all' || (listFilter === 'none' ? !s.tripId : s.tripId === listFilter));
  const trips = [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const pending = db.sessions.filter((s) => sessionRate(s) == null).length;

  const groups = new Map();
  for (const s of list) {
    const k = s.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  el.innerHTML = `
    ${header({ title: '記録', right: `<a class="btn btn-small btn-primary" href="#/sessions/new">${icons.plus}<span>追加</span></a>` })}
    <div class="page">
      ${db.sessions.length ? `
        <div class="toolbar">
          <label class="select-wrap">
            <span class="sr-only">遠征で絞り込み</span>
            <select class="input input-compact" data-filter>
              <option value="all" ${listFilter === 'all' ? 'selected' : ''}>すべての記録（${db.sessions.length}件）</option>
              ${trips.map((t) => `<option value="${esc(t.id)}" ${listFilter === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              <option value="none" ${listFilter === 'none' ? 'selected' : ''}>遠征なし</option>
            </select>
          </label>
        </div>
        ${pending ? pendingNotice(pending) : ''}
        ${list.length ? [...groups.entries()].map(([ym, ss]) => {
          const sum = summarize(ss);
          const [y, m] = ym.split('-');
          return `
            <section class="group">
              <h2 class="group-head"><span>${Number(y)}年${Number(m)}月</span><span class="group-meta">${ss.length}件 · ${esc(fmtDuration(sum.minutes))}${sum.jpy.count ? ` · <span class="${signClass(sum.jpy.profit)}">${esc(fmtYen(sum.jpy.profit))}</span>${sum.jpy.pending ? '<small>（換算済み分）</small>' : ''}` : ''}</span></h2>
              <div class="list card">${ss.map((s) => sessionRow(s, db)).join('')}</div>
            </section>`;
        }).join('') : emptyState({ title: 'この条件の記録はありません', icon: 'list' })}
      ` : emptyState({
        title: 'まだ記録がありません',
        text: 'ホームの「プレイ開始」でタイマー記録するか、終わったプレイをここから追加できます。',
        actions: `<a class="btn btn-primary" href="#/sessions/new">${icons.plus}<span>過去のプレイを記録</span></a>`,
      })}
    </div>`;

  el.querySelector('[data-filter]')?.addEventListener('change', (e) => {
    listFilter = e.target.value;
    renderSessionList(el);
  });
  bindPendingNotice(el);
}

export function pendingNotice(count) {
  if (isDemo()) return '';
  const offline = navigator.onLine === false;
  return `
    <div class="notice notice-warn" data-pending-notice>
      ${offline ? icons.offline : icons.alert}
      <div>
        <b>換算待ち ${count}件</b>
        <span>${offline ? 'オフラインのため円換算レートを取得できません。接続が戻ると自動で再取得します。' : rateState.running ? 'レートを取得しています…' : rateState.lastError ? esc(rateState.lastError) : '円の合計には含めていません。'}</span>
      </div>
      <button type="button" class="btn btn-small btn-ghost" data-act="retry-rates" ${rateState.running ? 'disabled' : ''}>${icons.refresh}<span>再取得</span></button>
    </div>`;
}

export function bindPendingNotice(el) {
  el.querySelectorAll('[data-act="retry-rates"]').forEach((btn) => {
    btn.addEventListener('click', () => busy(btn, async () => {
      if (navigator.onLine === false) { toast('オフラインです。通信できる場所で再試行してください', { type: 'error' }); return; }
      const r = await resolvePending();
      if (r && r.failed) toast(`${r.failed}件のレートを取得できませんでした。時間をおいて再試行するか、手入力してください`, { type: 'error' });
      else if (r && r.fetched) toast(`${r.fetched}件の円換算レートを取得しました`, { type: 'success' });
      else if (r && r.offline) toast('オフラインのため取得できませんでした', { type: 'error' });
      else toast('取得できるレートはありません（未来のプレイ日は当日以降に取得します）');
    }));
  });
}

/* ---------------- 詳細 ---------------- */

function rateBlock(s) {
  if (s.currency === 'JPY') {
    return `<div class="kv"><span class="k">円換算</span><span class="v">日本円のため換算不要（1円 = 1円）</span></div>`;
  }
  const r = s.rate;
  if (!r) {
    const future = isFutureDate(s);
    const err = rateState.errors.get(s.id);
    const reason = isDemo() ? 'デモでは自動取得しません。'
      : future ? 'プレイ日が未来の日付のため、当日以降に取得します。'
        : navigator.onLine === false ? 'オフラインのため取得できません。接続が戻ると自動で再取得します。'
          : rateState.running ? 'レートを取得しています…'
            : err ? `取得に失敗しました（${esc(err)}）。再試行するか、手入力してください。` : '取得待ちです。';
    return `
      <div class="rate-box rate-pending">
        <div class="rate-head"><span class="badge badge-warn">換算待ち</span><span class="muted">円の合計・時給には含めていません</span></div>
        <p class="rate-reason">${reason}</p>
        <div class="btn-row">
          ${!future && !isDemo() ? `<button type="button" class="btn btn-small btn-ghost" data-act="refetch">${icons.refresh}<span>再取得</span></button>` : ''}
          <button type="button" class="btn btn-small btn-ghost" data-act="manual-rate">${icons.edit}<span>手入力</span></button>
        </div>
      </div>`;
  }
  const fallback = r.date !== s.date && !r.manual;
  return `
    <div class="rate-box">
      <div class="rate-head">
        <span class="rate-value">1 ${esc(s.currency)} = ${esc(fmtRate(r.value))}円</span>
        ${r.manual ? '<span class="badge badge-accent">手入力</span>' : r.demo ? '<span class="badge badge-muted">デモ固定値</span>' : '<span class="badge badge-muted">自動取得</span>'}
      </div>
      <div class="kv"><span class="k">対象プレイ日</span><span class="v">${esc(fmtDate(s.date))}</span></div>
      <div class="kv"><span class="k">採用レートの日付</span><span class="v">${esc(fmtDate(r.date))}${fallback ? '<small class="muted">（プレイ日以前の直近）</small>' : ''}</span></div>
      <div class="kv"><span class="k">取得元</span><span class="v">${esc(r.source)}</span></div>
      ${r.fetchedAt ? `<div class="kv"><span class="k">取得日時</span><span class="v">${esc(new Date(r.fetchedAt).toLocaleString('ja-JP'))}</span></div>` : ''}
      ${r.setAt ? `<div class="kv"><span class="k">入力日時</span><span class="v">${esc(new Date(r.setAt).toLocaleString('ja-JP'))}</span></div>` : ''}
      <div class="btn-row">
        <button type="button" class="btn btn-small btn-ghost" data-act="manual-rate">${icons.edit}<span>${r.manual ? '値を変更' : '手入力で補正'}</span></button>
        ${r.manual && !isDemo() ? `<button type="button" class="btn btn-small btn-ghost" data-act="auto-rate">${icons.refresh}<span>自動取得に戻す</span></button>` : ''}
      </div>
    </div>`;
}

export function renderSessionDetail(el, { id }) {
  const db = getDb();
  const s = db.sessions.find((x) => x.id === id);
  if (!s) {
    el.innerHTML = header({ title: '記録の詳細', back: '#/sessions' }) + `<div class="page">${emptyState({ icon: 'alert', title: 'この記録は見つかりません', text: '削除された可能性があります。', actions: '<a class="btn btn-ghost" href="#/sessions">記録一覧へ</a>' })}</div>`;
    return;
  }
  const p = sessionProfit(s);
  const pj = sessionProfitJPY(s);
  const bb = sessionBB(s);
  const trip = s.tripId ? db.trips.find((t) => t.id === s.tripId) : null;
  const u = unitOf(s.currency);

  el.innerHTML = `
    ${header({ title: '記録の詳細', back: '#/sessions', right: `<a class="btn btn-small btn-ghost" href="#/sessions/${esc(s.id)}/edit">${icons.edit}<span>編集</span></a>` })}
    <div class="page">
      <section class="card hero-card">
        <div class="hero-meta">${esc(fmtDate(s.date))}<span class="dot-sep">·</span>${esc(fmtStake(s.currency, s.sb, s.bb))}</div>
        <h2 class="hero-title">${esc(s.location)}</h2>
        <div class="hero-amount ${signClass(p)}">${esc(fmtMoney(p, s.currency))}</div>
        <div class="hero-sub">${s.currency === 'JPY' ? 'ポーカー収支' : pj == null ? '<span class="badge badge-warn">換算待ち</span> 円換算は未確定' : `円換算 <b class="${signClass(pj)}">${esc(fmtYen(pj))}</b>`}</div>
        <div class="stat-grid stat-grid-3">
          <div class="stat"><span class="stat-k">実プレイ時間</span><span class="stat-v">${esc(fmtDuration(s.minutes))}</span></div>
          <div class="stat"><span class="stat-k">獲得bb</span><span class="stat-v ${signClass(bb)}">${esc(fmtBB(bb))}</span></div>
          <div class="stat"><span class="stat-k">bb/時間</span><span class="stat-v ${signClass(bb)}">${esc(fmtBBph(perHour(bb, s.minutes)))}</span></div>
          <div class="stat stat-wide"><span class="stat-k">時給（${esc(s.currency)}）</span><span class="stat-v ${signClass(p)}">${esc(fmtHourly(perHour(p, s.minutes), s.currency))}</span></div>
          ${s.currency !== 'JPY' ? `<div class="stat"><span class="stat-k">時給（円）</span><span class="stat-v ${signClass(pj)}">${pj == null ? '換算待ち' : esc(fmtHourly(perHour(pj, s.minutes), 'JPY'))}</span></div>` : ''}
        </div>
      </section>

      <section class="card">
        <h3 class="card-title">金額の内訳</h3>
        <div class="kv"><span class="k">合計キャッシュアウト</span><span class="v num">${esc(fmtAmount(s.cashout, s.currency))}</span></div>
        <div class="kv"><span class="k">合計バイイン</span><span class="v num">−${esc(fmtAmount(s.buyin, s.currency))}</span></div>
        <div class="kv"><span class="k">タイムレーキ（別払い）</span><span class="v num">${s.timeRake ? '−' + esc(fmtAmount(s.timeRake, s.currency)) : '0 ' + esc(u)}</span></div>
        <div class="kv kv-total"><span class="k">ポーカー収支</span><span class="v num ${signClass(p)}">${esc(fmtMoney(p, s.currency))}</span></div>
      </section>

      <section class="card">
        <h3 class="card-title">円換算</h3>
        ${rateBlock(s)}
      </section>

      <section class="card">
        <h3 class="card-title">その他</h3>
        <div class="kv"><span class="k">遠征</span><span class="v">${trip ? `<a href="#/trips/${esc(trip.id)}">${esc(trip.name)}</a>` : '遠征なし'}</span></div>
        <div class="kv"><span class="k">今日の冴え</span><span class="v">${s.condition ? `<span class="cond-badge c${esc(s.condition)}">${esc(conditionLabel(s.condition))}</span>` : '<span class="muted">未入力</span>'}</span></div>
        <div class="kv"><span class="k">タグ</span><span class="v">${s.tags && s.tags.length ? s.tags.map((t) => `<span class="tag">${esc(tagLabel(t))}</span>`).join(' ') : '<span class="muted">なし</span>'}</span></div>
        ${s.startedAt ? `
          <div class="kv"><span class="k">開始</span><span class="v">${esc(fmtTimeInTz(s.startedAt, s.tz))}</span></div>
          <div class="kv"><span class="k">終了</span><span class="v">${esc(fmtTimeInTz(s.endedAt, s.tz))}</span></div>
          <div class="kv"><span class="k">休憩</span><span class="v">${esc(fmtDuration(s.breakMinutes || 0))}</span></div>
          ${s.timerMinutes != null && s.timerMinutes !== s.minutes ? `<div class="kv"><span class="k">タイマー計測</span><span class="v">${esc(fmtDuration(s.timerMinutes))}（補正済み）</span></div>` : ''}
          ${s.tz ? `<div class="kv"><span class="k">記録時のタイムゾーン</span><span class="v">${esc(s.tz)}</span></div>` : ''}` : '<div class="kv"><span class="k">記録方法</span><span class="v">手入力</span></div>'}
        ${s.note ? `<div class="note-box">${esc(s.note)}</div>` : ''}
      </section>

      <button type="button" class="btn btn-text-danger btn-block" data-act="delete">${icons.trash}<span>この記録を削除</span></button>
    </div>`;

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'refetch') {
      await busy(btn, async () => {
        if (navigator.onLine === false) { toast('オフラインです。接続後に再試行してください', { type: 'error' }); return; }
        const r = await resolvePending({ only: [s.id] });
        if (r && r.failed) toast('レートを取得できませんでした。時間をおいて再試行するか、手入力してください', { type: 'error' });
        else if (r && r.fetched) toast('円換算レートを取得しました', { type: 'success' });
      });
    } else if (act === 'manual-rate') {
      const res = await numberDialog({
        title: '円換算レートを手入力',
        message: `${esc(fmtDate(s.date))} のプレイに使う「1 ${esc(s.currency)} = 何円」を入力します。手入力した値は自動取得で上書きされません。`,
        label: `1 ${s.currency} あたり`,
        suffix: '円',
        initial: s.rate ? String(s.rate.value) : '',
        parse: { min: 0, maxDecimals: 6 },
        validate: (r) => (r.value > 0 ? null : '0より大きい値を入力してください'),
        onSave: (value) => A.setManualRate(s.id, value),
      });
      if (!res) return;
      toast('手入力レートを保存しました', { type: 'success' });
    } else if (act === 'auto-rate') {
      const ok = await confirmDialog({ title: '自動取得に戻しますか？', message: '手入力したレートを解除し、プレイ日のレートを自動取得します。取得できるまでは換算待ちになります。', confirmText: '自動取得に戻す' });
      if (!ok) return;
      try { A.clearRate(s.id); resolvePending({ only: [s.id] }); } catch (err) { showError(err); }
    } else if (act === 'delete') {
      const ok = await confirmDialog({
        title: 'この記録を削除しますか？',
        message: `${esc(fmtDate(s.date))} ${esc(s.location)}（${esc(fmtMoney(p, s.currency))}）を削除します。成績とグラフからも除かれます。`,
        confirmText: '削除する', danger: true,
      });
      if (!ok) return;
      try {
        const removed = A.deleteSession(s.id);
        location.hash = '#/sessions';
        toast('記録を削除しました', { action: { label: '元に戻す', fn: () => { A.restoreSession(removed); toast('記録を元に戻しました', { type: 'success' }); } }, duration: 8000 });
      } catch (err) { showError(err); }
    }
  });
}
