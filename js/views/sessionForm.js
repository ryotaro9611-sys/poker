// セッション入力フォーム（過去のプレイの手入力／編集／タイマー終了後の精算）
import { getDb, modeGeneration } from '../store.js';
import * as A from '../actions.js';
import { resolvePending } from '../rates.js';
import { validateSession, sessionProfit } from '../calc.js';
import {
  esc, todayYMD, fmtMoney, fmtBB, fmtHourly, fmtDuration, fmtInput, fmtTimeInTz, debounce, signClass, parseNumber, onLeave,
} from '../util.js';
import { header, toast, showError, busy, confirmDialog, icons } from '../ui.js';
import {
  tripField, currencyField, textField, amountField, stakeFields, durationField, chipsHtml,
  readForm, showErrors, clearErrors, attachNumberFormatting, unitOf, conditionField, tagsField, bindConditionClear, handleTripMissing,
} from './fields.js';

function splitMinutes(m) {
  if (m == null || !Number.isFinite(m)) return { hours: '', mins: '' };
  return { hours: String(Math.floor(m / 60)), mins: String(Math.round(m % 60)) };
}

function initialValues(db, mode, { session, active, presetTrip }) {
  if (mode === 'finish') {
    const a = active;
    const elapsedMin = Math.max(1, Math.round(A.liveElapsedMs(a, a.endedAt || Date.now()) / 60000));
    const auto = {
      tripId: a.tripId || '', date: a.date, location: a.location, currency: a.currency,
      sb: fmtInput(a.sb), bb: fmtInput(a.bb), ...splitMinutes(elapsedMin),
      buyin: fmtInput(A.liveBuyinTotal(a)), cashout: '', timeRake: '', note: '', condition: a.condition ?? '', tags: [],
    };
    if (a.draft) {
      const v = { ...auto, ...a.draft };
      if (!a.draft.durationEdited) Object.assign(v, splitMinutes(elapsedMin));
      if (!a.draft.buyinEdited) v.buyin = auto.buyin;
      return { values: v, restored: true };
    }
    return { values: auto, restored: false };
  }
  const key = mode === 'edit' ? `edit:${session.id}` : 'new-session';
  const draft = db.drafts[key];
  if (mode === 'edit') {
    const s = session;
    const base = {
      tripId: s.tripId || '', date: s.date, location: s.location, currency: s.currency,
      sb: fmtInput(s.sb), bb: fmtInput(s.bb), ...splitMinutes(s.minutes),
      buyin: fmtInput(s.buyin), cashout: fmtInput(s.cashout), timeRake: s.timeRake ? fmtInput(s.timeRake) : '', note: s.note || '', condition: s.condition ?? '', tags: s.tags || [],
    };
    return draft ? { values: { ...base, ...draft }, restored: true } : { values: base, restored: false };
  }
  if (draft) return { values: draft, restored: true };
  const cur = db.prefs.lastCurrency || 'USD';
  const st = (db.prefs.stakes || {})[cur];
  const date = todayYMD();
  return {
    values: {
      tripId: presetTrip && db.trips.some((t) => t.id === presetTrip) ? presetTrip : A.defaultTripId(db, date), date, location: db.prefs.lastLocation || '', currency: cur,
      sb: st ? fmtInput(st.sb) : '', bb: st ? fmtInput(st.bb) : '', hours: '', mins: '',
      buyin: '', cashout: '', timeRake: '', note: '', condition: '', tags: [],
    },
    restored: false,
  };
}

let formCleanup = null;
/**
 * ルーターに渡す後処理。画面を作り直しても（再試行・下書きの破棄）、常に「今表示している画面」の後処理を呼ぶ。
 * これで、画面を離れる直前の入力の確定が抜けない。
 */
function cleanupFormView() {
  if (formCleanup) { formCleanup(); formCleanup = null; }
}

export function renderSessionForm(el, { mode, id, presetTrip }) {
  if (formCleanup) { formCleanup(); formCleanup = null; }
  const db = getDb();
  const session = mode === 'edit' ? db.sessions.find((s) => s.id === id) : null;
  const active = mode === 'finish' ? db.active : null;

  if (mode === 'edit' && !session) {
    el.innerHTML = header({ title: '記録の編集', back: '#/sessions' }) + `<div class="page"><div class="notice notice-warn">${icons.alert}<div>この記録は見つかりません。削除された可能性があります。</div></div></div>`;
    return;
  }
  if (mode === 'finish' && !active) {
    el.innerHTML = header({ title: '精算', back: '#/' }) + `<div class="page"><div class="notice">${icons.check}<div>進行中のセッションはありません。保存済みの記録は「記録」タブで確認できます。</div></div><a class="btn btn-ghost btn-block" href="#/sessions">記録を見る</a></div>`;
    return;
  }
  if (mode === 'finish' && active.status !== 'settling') {
    // 直接URLで来た場合でもタイマーを止めて精算状態にする。失敗したら繰り返さずに案内する
    try {
      A.settleLive();
    } catch (e) {
      el.innerHTML = header({ title: '精算', back: '#/' }) + `
        <div class="page">
          <div class="notice notice-error">${icons.alert}<div><b>精算画面を開けませんでした</b><span>${esc(e.message)}</span></div></div>
          <button type="button" class="btn btn-ghost btn-block" data-act="retry-settle">${icons.refresh}<span>もう一度試す</span></button>
          <a class="btn btn-ghost btn-block" href="#/">ホームに戻る（タイマーはそのまま）</a>
        </div>`;
      el.querySelector('[data-act="retry-settle"]').addEventListener('click', () => renderSessionForm(el, { mode, id, presetTrip }));
      return cleanupFormView;
    }
    if (getDb().active && getDb().active.status === 'settling') return renderSessionForm(el, { mode, id, presetTrip });
    return cleanupFormView;
  }

  const draftKey = mode === 'edit' ? `edit:${id}` : 'new-session';
  const { values: v, restored } = initialValues(db, mode, { session, active: mode === 'finish' ? getDb().active : null, presetTrip });
  let durationEdited = !!(active && active.draft && active.draft.durationEdited);
  let buyinEdited = !!(active && active.draft && active.draft.buyinEdited);
  const a = mode === 'finish' ? getDb().active : null;
  // この画面が扱う対象（別タブでの変更や、デモ⇔通常の切り替え後に誤って書き込まないため）
  const gen = modeGeneration();
  const activeId = a ? a.id : null;
  const activeRev = a ? a.rev || 0 : null;
  const baseUpdatedAt = session ? session.updatedAt : null;

  const title = mode === 'new' ? '過去のプレイを記録' : mode === 'edit' ? '記録の編集' : '精算して保存';
  const back = mode === 'new' ? '#/' : mode === 'edit' ? `#/sessions/${id}` : '#/';
  const trOpen = !!(v.timeRake && parseNumber(v.timeRake).value > 0);

  const repairs = a && Array.isArray(a.repairs) ? a.repairs : [];
  const repairHtml = repairs.length ? `
    <div class="notice notice-warn repair-notice" role="alert">
      ${icons.alert}
      <div>
        <b>このセッションの記録を修復しています</b>
        ${repairs.map((m) => `<span>・${esc(m)}</span>`).join('')}
      </div>
    </div>` : '';
  const timerInfo = a ? `
    <div class="timer-summary">
      <div><span class="k">開始</span><span class="v">${esc(fmtTimeInTz(a.startedAt, a.tz))}</span></div>
      <div><span class="k">終了</span><span class="v">${esc(fmtTimeInTz(a.endedAt || Date.now(), a.tz))}</span></div>
      <div><span class="k">休憩</span><span class="v">${esc(fmtDuration(Math.round(A.liveBreakMs(a, a.endedAt || Date.now()) / 60000)))}</span></div>
      <div><span class="k">タイマー</span><span class="v">${esc(fmtDuration(Math.round(A.liveElapsedMs(a, a.endedAt || Date.now()) / 60000)))}</span></div>
    </div>` : '';

  const reviewHtml = `
          <section class="card form-card">
            ${tagsField(v.tags)}
            ${conditionField(v.condition, { hint: mode === 'finish' && v.condition ? '開始時に入力した値です。' : '' })}
          </section>`;

  el.innerHTML = `
    ${header({ title, back })}
    <div class="page">
      ${restored && mode !== 'finish' ? `<div class="notice notice-info">${icons.check}<div>入力途中の内容を復元しました。<button type="button" class="link" data-act="discard-draft">破棄して最初から</button></div></div>` : ''}
      ${restored && mode === 'finish' ? `<div class="notice notice-info">${icons.check}<div>入力途中の内容を復元しました。</div></div>` : ''}
      ${timerInfo}
      ${repairHtml}
      <form class="form" novalidate autocomplete="off">
        <div class="form-summary" role="alert" hidden></div>

        ${mode === 'finish' ? `
          <section class="card form-card form-card-accent">
            ${amountField({ name: 'cashout', label: '合計キャッシュアウト', value: v.cashout, unit: unitOf(v.currency), big: true, hint: '最後に持ち帰ったチップの合計額（回収0なら0）' })}
            ${amountField({ name: 'buyin', label: '合計バイイン（リバイ・追加購入込み）', value: v.buyin, unit: unitOf(v.currency), hint: 'プレイ中に記録した額を自動入力しています' })}
            <div class="preview" data-preview></div>
          </section>
          ${reviewHtml}` : ''}

        <section class="card form-card">
          ${tripField(db, v.tripId)}
          <label class="field">
            <span class="field-label">プレイ日</span>
            <input class="input" type="date" name="date" value="${esc(v.date)}" required>
            ${mode === 'finish' ? '<span class="field-hint">開始した現地の日付です。必要なら修正してください。</span>' : ''}
            <span class="field-error" data-err="date"></span>
            <span class="field-note" data-rate-note hidden></span>
          </label>
          ${textField({ name: 'location', label: '場所・店舗名', value: v.location, placeholder: '例：Club A', list: 'loc-list' })}
          <datalist id="loc-list">${A.recentLocations(db, 20).map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
          <div class="chips" data-loc-chips>${chipsHtml(A.recentLocations(db, 5).map((l) => ({ label: l, data: { location: l } })))}</div>
          ${currencyField(v.currency)}
          ${stakeFields(v.sb, v.bb)}
          ${durationField(v.hours, v.mins, mode === 'finish' ? (a && A.liveElapsedMs(a, a.endedAt || Date.now()) > 12 * 3600e3 ? '<b class="warn-text">タイマーが12時間を超えています。止め忘れの場合は実際の実プレイ時間に直してください。</b>' : 'タイマーの計測値（休憩を除く）。補正する場合は書き換えてください。') : '')}
        </section>

        ${mode !== 'finish' ? `
          <section class="card form-card">
            ${amountField({ name: 'buyin', label: '合計バイイン（リバイ・追加購入込み）', value: v.buyin, unit: unitOf(v.currency) })}
            ${amountField({ name: 'cashout', label: '合計キャッシュアウト', value: v.cashout, unit: unitOf(v.currency), hint: '回収0の場合は0を入力' })}
            <div class="preview" data-preview></div>
          </section>
          ${reviewHtml}` : ''}

        <section class="card form-card">
          <details class="disclosure" ${trOpen ? 'open' : ''}>
            <summary>
              <span>タイムレーキ（別払い）</span>
              <span class="disclosure-value" data-tr-summary></span>
            </summary>
            ${amountField({ name: 'timeRake', label: '別払いしたタイムレーキの合計', value: v.timeRake, unit: unitOf(v.currency), hint: '手持ち現金など<b>チップ以外から別払いした分だけ</b>を入力します。チップから払った分（キャッシュアウトに反映済み）やポットから引かれたレーキは入力しないでください。' })}
          </details>
          <label class="field">
            <span class="field-label">メモ（任意）</span>
            <textarea class="input" name="note" rows="2" maxlength="500" placeholder="卓の様子など">${esc(v.note)}</textarea>
          </label>
        </section>

        ${repairs.length ? `
          <label class="check-field">
            <input type="checkbox" name="repairAck">
            <span>修復した内容（上のお知らせ）と、合計バイイン・実プレイ時間を確認しました</span>
          </label>
          <span class="field-error" data-err="repairAck"></span>` : ''}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block btn-lg" data-act="save">${icons.check}<span>${mode === 'edit' ? '変更を保存' : '保存する'}</span></button>
          ${mode === 'finish' ? `
            <button type="button" class="btn btn-ghost btn-block" data-act="back-to-play">${icons.play}<span>プレイに戻る（タイマー再開）</span></button>
            <button type="button" class="btn btn-text-danger btn-block" data-act="discard-live">このセッションを破棄</button>` : `
            <button type="button" class="btn btn-ghost btn-block" data-act="cancel">キャンセル</button>`}
          <p class="draft-status" data-draft-status aria-live="polite"></p>
        </div>
      </form>
    </div>`;

  const form = el.querySelector('form');
  attachNumberFormatting(form);
  bindConditionClear(form, () => saveDraft());
  const cur = () => form.querySelector('[name="currency"]:checked')?.value || 'USD';

  function refreshCurrency() {
    const c = cur();
    form.querySelectorAll('[data-unit]').forEach((u) => { u.textContent = unitOf(c); });
    const chips = form.querySelector('[data-stake-chips]');
    chips.innerHTML = chipsHtml(A.recentStakes(getDb(), c).map((s) => ({ label: `${s.sb}/${s.bb}`, data: { sb: s.sb, bb: s.bb } })));
  }

  function refreshPreview() {
    const raw = readForm(form);
    const r = validateSession({ ...raw, location: raw.location || 'x', date: raw.date || todayYMD() });
    const box = form.querySelector('[data-preview]');
    const trBox = form.querySelector('[data-tr-summary]');
    const tr = parseNumber(raw.timeRake, { allowEmpty: true });
    trBox.textContent = tr.ok && tr.value ? fmtMoney(-tr.value, raw.currency) : '0（初期値）';
    const need = ['buyin', 'cashout', 'bb', 'sb'];
    if (need.some((k) => r.errors[k]) || raw.cashout === '') {
      box.innerHTML = '<span class="muted">金額を入力すると収支を表示します</span>';
      return;
    }
    const p = sessionProfit(r.value);
    const bbw = p / r.value.bb;
    const hourly = r.value.minutes ? fmtHourly(p / (r.value.minutes / 60), raw.currency) : '—';
    box.innerHTML = `
      <div class="preview-main ${signClass(p)}">${esc(fmtMoney(p, raw.currency))}</div>
      <div class="preview-sub">${esc(fmtBB(bbw))}<span class="dot-sep">·</span>${esc(hourly)}${r.value.timeRake ? `<span class="dot-sep">·</span>別払いレーキ控除後` : ''}</div>`;
  }

  function refreshRateNote() {
    if (mode !== 'edit') return;
    const raw = readForm(form);
    const note = form.querySelector('[data-rate-note]');
    const changed = raw.date !== session.date || raw.currency !== session.currency;
    const hadRate = session.currency !== 'JPY' && session.rate;
    note.hidden = !(changed && (hadRate || raw.currency !== 'JPY'));
    note.textContent = session.rate && session.rate.manual
      ? 'プレイ日または通貨を変更したため、保存時に手入力レートを解除し、新しいプレイ日のレートを取り直します。'
      : 'プレイ日または通貨を変更したため、保存時に新しいプレイ日の円換算レートを取り直します。';
  }

  const status = form.querySelector('[data-draft-status]');
  const saveDraft = debounce(() => {
    const raw = readForm(form);
    delete raw.repairAck; // 確認欄は下書きに残さない（開き直したら改めて確認してもらう）
    try {
      const written = mode === 'finish'
        ? A.saveLiveDraft({ ...raw, durationEdited, buyinEdited }, { activeId, gen, rev: activeRev })
        : (A.setDraft(draftKey, raw, { gen }), true);
      if (written) {
        status.textContent = '入力途中の内容は自動で保存されています';
        status.classList.remove('warn');
      } else {
        status.textContent = '別の画面でこのセッションが変更されたため、この画面の入力は保存していません。画面を開き直してください。';
        status.classList.add('warn');
      }
    } catch (e) {
      status.textContent = '入力途中の内容を端末に保存できていません（画面を閉じると失われます）';
      status.classList.add('warn');
    }
  }, 350);

  let tripTouched = mode !== 'new' || restored;
  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (n === 'tripId') tripTouched = true;
    if (n === 'date' && !tripTouched) {
      const t = A.tripForDate(getDb(), e.target.value);
      if (t) form.tripId.value = t.id;
    }
    if (n === 'hours' || n === 'mins') durationEdited = true;
    if (n === 'buyin') buyinEdited = true;
    if (n === 'currency') refreshCurrency();
    if (e.target.getAttribute('aria-invalid')) {
      e.target.removeAttribute('aria-invalid');
      const errKey = n === 'hours' || n === 'mins' ? 'duration' : n;
      const err = form.querySelector(`[data-err="${errKey}"]`);
      if (err) err.textContent = '';
    }
    refreshPreview();
    refreshRateNote();
    saveDraft();
  });
  form.addEventListener('change', () => { refreshRateNote(); saveDraft(); });

  form.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const d = JSON.parse(chip.dataset.chip);
      if (d.location) form.location.value = d.location;
      if (d.bb != null) { form.sb.value = fmtInput(d.sb); form.bb.value = fmtInput(d.bb); }
      form.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'cancel') {
      e.preventDefault();
      saveDraft.cancel();
      A.clearDraft(draftKey);
      location.hash = back;
    } else if (act === 'back-to-play') {
      await busy(btn, async () => {
        saveDraft.flush();
        try { A.backToPlay(activeId); location.hash = '#/'; } catch (err) { showError(err); }
      });
    } else if (act === 'discard-live') {
      const ok = await confirmDialog({
        title: 'このセッションを破棄しますか？',
        message: 'タイマーと入力内容は保存されずに消えます。この操作は取り消せません。',
        confirmText: '破棄する', danger: true,
      });
      if (!ok) return;
      saveDraft.cancel();
      try { A.discardLive(activeId); toast('セッションを破棄しました'); location.hash = '#/'; } catch (err) { showError(err); }
    }
  });
  el.querySelector('[data-act="discard-draft"]')?.addEventListener('click', () => {
    saveDraft.cancel();
    A.clearDraft(draftKey);
    renderSessionForm(el, { mode, id });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-act="save"]');
    await busy(btn, async () => {
      const raw = readForm(form);
      const r = validateSession(raw);
      if (repairs.length && !form.querySelector('[name="repairAck"]')?.checked) r.errors.repairAck = '修復した内容を確認してから保存してください';
      if (Object.keys(r.errors).length) { showErrors(form, r.errors); return; }
      clearErrors(form);
      saveDraft.cancel();
      const doSave = async () => {
        if (mode === 'new') {
          const s = A.createSession(r.value);
          A.clearDraft(draftKey);
          toast('記録を保存しました', { type: 'success' });
          location.hash = `#/sessions/${s.id}`;
          resolvePending({ only: [s.id] });
        } else if (mode === 'edit') {
          const { rateReset } = A.updateSession(id, r.value, baseUpdatedAt);
          A.clearDraft(draftKey);
          toast('変更を保存しました', { type: 'success' });
          location.hash = `#/sessions/${id}`;
          if (rateReset) resolvePending({ only: [id] });
        } else {
          const s = A.finishLive(r.value, activeId, activeRev);
          toast('セッションを保存しました', { type: 'success' });
          location.hash = `#/sessions/${s.id}`;
          resolvePending({ only: [s.id] });
        }
      };
      try {
        await doSave();
      } catch (err) {
        saveDraft();
        if (err.code === A.TRIP_MISSING) handleTripMissing(form, getDb());
        showError(err, err.name === 'SaveError' ? () => form.requestSubmit() : null);
      }
    });
  });

  refreshCurrency();
  refreshPreview();
  refreshRateNote();
  if (mode === 'finish' && !v.cashout) setTimeout(() => form.cashout.focus({ preventScroll: true }), 50);

  // 画面を離れる・アプリが裏に回る・再読み込みの直前に、未保存の入力を確定する
  const offLeave = onLeave(() => saveDraft.flush());
  formCleanup = () => { saveDraft.flush(); offLeave(); };
  return cleanupFormView;
}
