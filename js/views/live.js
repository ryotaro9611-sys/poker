// タイマー：開始画面と進行中カード
import { getDb } from '../store.js';
import * as A from '../actions.js';
import { parseNumber, esc, fmtElapsed, fmtAmount, fmtStake, fmtTimeInTz, fmtDuration, fmtInput, CURRENCY_CODES } from '../util.js';
import { header, icons, toast, showError, busy, confirmDialog, numberDialog } from '../ui.js';
import {
  tripField, currencyField, textField, amountField, stakeFields, chipsHtml, readForm, showErrors, clearErrors,
  attachNumberFormatting, unitOf,
} from './fields.js';

/* ---------------- 開始画面 ---------------- */

export function renderLiveStart(el) {
  const db = getDb();
  if (db.active) { location.replace('#/'); return; }
  const cur = db.prefs.lastCurrency || 'USD';
  const st = (db.prefs.stakes || {})[cur];
  const bi = (db.prefs.buyins || {})[cur];
  el.innerHTML = `
    ${header({ title: 'プレイ開始', back: '#/' })}
    <div class="page">
      <form class="form" novalidate autocomplete="off">
        <div class="form-summary" role="alert" hidden></div>
        <section class="card form-card">
          ${textField({ name: 'location', label: '場所・店舗名', value: db.prefs.lastLocation || '', placeholder: '例：Club A', list: 'loc-list' })}
          <datalist id="loc-list">${A.recentLocations(db, 20).map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
          <div class="chips">${chipsHtml(A.recentLocations(db, 5).map((l) => ({ label: l, data: { location: l } })))}</div>
          ${currencyField(cur)}
          ${stakeFields(st ? fmtInput(st.sb) : '', st ? fmtInput(st.bb) : '')}
          ${amountField({ name: 'buyin', label: '最初のバイイン', value: bi != null ? fmtInput(bi) : '', unit: unitOf(cur), hint: 'リバイ・追加購入はプレイ中に追加できます' })}
          ${tripField(db, A.defaultTripId(db))}
        </section>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block btn-xl" data-act="start">${icons.play}<span>タイマーを開始</span></button>
          <a class="btn btn-ghost btn-block" href="#/">キャンセル</a>
        </div>
      </form>
    </div>`;

  const form = el.querySelector('form');
  attachNumberFormatting(form);
  const refresh = () => {
    const c = form.querySelector('[name="currency"]:checked').value;
    form.querySelectorAll('[data-unit]').forEach((u) => { u.textContent = unitOf(c); });
    form.querySelector('[data-stake-chips]').innerHTML = chipsHtml(A.recentStakes(getDb(), c).map((s) => ({ label: `${s.sb}/${s.bb}`, data: { sb: s.sb, bb: s.bb } })));
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'currency') {
      const c = e.target.value;
      const p = getDb().prefs;
      const s = (p.stakes || {})[c];
      form.sb.value = s ? fmtInput(s.sb) : '';
      form.bb.value = s ? fmtInput(s.bb) : '';
      const b = (p.buyins || {})[c];
      form.buyin.value = b != null ? fmtInput(b) : '';
      refresh();
    }
  });
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    const d = JSON.parse(chip.dataset.chip);
    if (d.location) form.location.value = d.location;
    if (d.bb != null) { form.sb.value = fmtInput(d.sb); form.bb.value = fmtInput(d.bb); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-act="start"]');
    busy(btn, async () => {
      const raw = readForm(form);
      const v = validateStart(raw);
      if (!v.ok) { showErrors(form, v.errors); return; }
      clearErrors(form);
      try {
        A.startLive(v.value);
        toast('タイマーを開始しました', { type: 'success' });
        location.hash = '#/';
      } catch (err) {
        if (err.name === 'UserError' && getDb().active) { location.hash = '#/'; return; }
        showError(err, err.name === 'SaveError' ? () => form.requestSubmit() : null);
      }
    });
  });
  refresh();
}

function validateStart(raw) {
  const errors = {};
  const value = { tripId: raw.tripId || null };
  const loc = (raw.location || '').trim();
  if (!loc) errors.location = '場所・店舗名を入力してください';
  else value.location = loc.slice(0, 60);
  if (!CURRENCY_CODES.includes(raw.currency)) errors.currency = '通貨を選択してください';
  else value.currency = raw.currency;
  const sb = parseNumber(raw.sb);
  const bb = parseNumber(raw.bb);
  if (!sb.ok) errors.sb = 'SB：' + sb.error; else value.sb = sb.value;
  if (!bb.ok) errors.bb = 'BB：' + bb.error; else if (bb.value <= 0) errors.bb = 'BBは0より大きい値にしてください'; else value.bb = bb.value;
  if (value.sb != null && value.bb != null && value.sb > value.bb) errors.sb = 'SBはBB以下にしてください';
  const bi = parseNumber(raw.buyin, { allowEmpty: true });
  if (!bi.ok) errors.buyin = bi.error; else value.buyin = bi.value || 0;
  return { ok: !Object.keys(errors).length, errors, value };
}

/** 前回と同じ設定でワンタップ開始 */
export function quickStartInfo(db) {
  const p = db.prefs;
  const cur = p.lastCurrency;
  const st = cur && (p.stakes || {})[cur];
  if (!p.lastLocation || !st) return null;
  const buyin = (p.buyins || {})[cur] ?? 0;
  return { location: p.lastLocation, currency: cur, sb: st.sb, bb: st.bb, buyin, tripId: A.defaultTripId(db) || null };
}

/* ---------------- 進行中カード ---------------- */

export function liveCardHtml(db) {
  const a = db.active;
  if (!a) return '';
  const trip = a.tripId ? db.trips.find((t) => t.id === a.tripId) : null;
  const total = A.liveBuyinTotal(a);
  const statusLabel = a.status === 'playing' ? 'プレイ中' : a.status === 'break' ? '休憩中' : '精算入力中';
  return `
    <section class="live-card status-${a.status}" aria-label="進行中のセッション">
      <div class="live-top">
        <span class="live-status"><span class="pulse"></span>${statusLabel}</span>
        <span class="live-started">開始 ${esc(fmtTimeInTz(a.startedAt, a.tz))}</span>
      </div>
      <div class="live-elapsed" data-tick="elapsed">${fmtElapsed(A.liveElapsedMs(a))}</div>
      <div class="live-elapsed-label">実プレイ時間（休憩を除く）${a.status === 'break' ? `<span class="live-break">休憩 <b data-tick="break">${fmtElapsed(A.liveBreakMs(a))}</b></span>` : A.liveBreakMs(a) > 0 ? `<span class="live-break">休憩計 ${esc(fmtDuration(Math.round(A.liveBreakMs(a) / 60000)))}</span>` : ''}</div>
      <div class="live-info">
        <div class="live-info-item"><span class="k">場所</span><span class="v">${esc(a.location)}</span></div>
        <div class="live-info-item"><span class="k">レート</span><span class="v">${esc(fmtStake(a.currency, a.sb, a.bb))}</span></div>
        <div class="live-info-item"><span class="k">遠征</span><span class="v">${trip ? esc(trip.name) : '遠征なし'}</span></div>
      </div>
      <div class="live-buyin">
        <div>
          <span class="k">合計バイイン</span>
          <span class="v num">${esc(fmtAmount(total, a.currency))}</span>
          ${a.buyins.length > 1 ? `<span class="live-buyin-detail">${a.buyins.map((b) => esc(fmtAmount(b.amount, a.currency).replace(/ \w+$|円$/, ''))).join(' + ')}</span>` : ''}
        </div>
        ${a.status !== 'settling' ? `<button type="button" class="btn btn-small btn-ghost" data-live="add-buyin">${icons.plus}<span>追加バイイン</span></button>` : ''}
      </div>
      ${a.status !== 'settling' && a.buyins.length ? `<button type="button" class="link live-undo" data-live="undo-buyin">直前のバイイン（${esc(fmtAmount(a.buyins[a.buyins.length - 1].amount, a.currency))}）を取り消す</button>` : ''}
      <div class="live-actions">
        ${a.status === 'settling'
    ? `<a class="btn btn-primary btn-lg btn-block" href="#/live/finish">${icons.check}<span>精算入力を続ける</span></a>`
    : `
          ${a.status === 'playing'
    ? `<button type="button" class="btn btn-ghost btn-lg" data-live="pause">${icons.pause}<span>休憩</span></button>`
    : `<button type="button" class="btn btn-accent-soft btn-lg" data-live="resume">${icons.play}<span>再開</span></button>`}
          <button type="button" class="btn btn-primary btn-lg" data-live="finish">${icons.stop}<span>終了して精算</span></button>`}
      </div>
    </section>`;
}

export function tickLive(root) {
  const a = getDb().active;
  if (!a) return;
  const el = fmtElapsed(A.liveElapsedMs(a));
  root.querySelectorAll('[data-tick="elapsed"]').forEach((n) => { if (n.textContent !== el) n.textContent = el; });
  const br = fmtElapsed(A.liveBreakMs(a));
  root.querySelectorAll('[data-tick="break"]').forEach((n) => { n.textContent = br; });
}

export function bindLiveCard(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-live]');
    if (!btn) return;
    const act = btn.dataset.live;
    const a = getDb().active;
    if (!a) return;
    try {
      if (act === 'pause') await busy(btn, async () => { A.pauseLive(); });
      else if (act === 'resume') await busy(btn, async () => { A.resumeLive(); });
      else if (act === 'finish') {
        await busy(btn, async () => { A.settleLive(); location.hash = '#/live/finish'; });
      } else if (act === 'add-buyin') {
        const last = a.buyins.length ? a.buyins[a.buyins.length - 1].amount : '';
        const res = await numberDialog({
          title: '追加バイイン',
          message: `リバイ・追加購入した額を入力します（${esc(a.currency)}）。`,
          label: '追加額',
          suffix: unitOf(a.currency),
          initial: last ? fmtInput(last) : '',
          confirmText: '追加',
          validate: (r) => (r.value > 0 ? null : '0より大きい額を入力してください'),
        });
        if (!res) return;
        A.addBuyin(res.value);
        toast(`${fmtAmount(res.value, a.currency)} を追加しました`, { type: 'success' });
      } else if (act === 'undo-buyin') {
        const lastB = a.buyins[a.buyins.length - 1];
        const ok = await confirmDialog({ title: 'バイインを取り消しますか？', message: `直前に記録した ${esc(fmtAmount(lastB.amount, a.currency))} を合計バイインから除きます。`, confirmText: '取り消す', danger: true });
        if (!ok) return;
        A.removeLastBuyin();
      }
    } catch (err) {
      showError(err);
    }
  });
}
