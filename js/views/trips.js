// 遠征：一覧・詳細・作成/編集・削除
import { getDb } from '../store.js';
import * as A from '../actions.js';
import { tripResult, sortSessions, validateTrip } from '../calc.js';
import { esc, fmtYen, fmtDuration, fmtBBph, fmtHourly, fmtMoney, fmtDateRange, fmtInput, signClass, todayYMD } from '../util.js';
import { header, icons, toast, showError, busy, modal, numberDialog, emptyState } from '../ui.js';
import { readForm, showErrors, clearErrors, attachNumberFormatting } from './fields.js';
import { sessionRow } from './sessions.js';
import { tripSummaryCard } from './home.js';

export function renderTripList(el) {
  const db = getDb();
  const trips = [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const loose = db.sessions.filter((s) => !s.tripId).length;
  el.innerHTML = `
    ${header({ title: '遠征', right: `${trips.length > 1 ? `<a class="btn btn-small btn-ghost" href="#/trips/compare">${icons.chart}<span>比較</span></a>` : ''}<a class="btn btn-small btn-primary" href="#/trips/new">${icons.plus}<span>新規</span></a>` })}
    <div class="page">
      ${trips.length ? trips.map((t) => tripSummaryCard(db, t)).join('') : emptyState({
        icon: 'trip',
        title: 'まだ遠征がありません',
        text: '遠征ごとにプレイ記録と経費をまとめ、経費を引いた遠征全体の損益を確認できます。',
        actions: `<a class="btn btn-primary" href="#/trips/new">${icons.plus}<span>遠征を作成</span></a>`,
      })}
      ${loose ? `<p class="muted small center">遠征に属さない記録が${loose}件あります（成績タブの全期間集計には含まれます）</p>` : ''}
    </div>`;
}

export function renderTripDetail(el, { id }) {
  const db = getDb();
  const t = db.trips.find((x) => x.id === id);
  if (!t) {
    el.innerHTML = header({ title: '遠征', back: '#/trips' }) + `<div class="page">${emptyState({ icon: 'alert', title: 'この遠征は見つかりません', text: '削除された可能性があります。', actions: '<a class="btn btn-ghost" href="#/trips">遠征一覧へ</a>' })}</div>`;
    return;
  }
  const r = tripResult(t, db.sessions);
  const s = r.summary;
  const list = sortSessions(r.sessions, -1);
  const curs = Object.values(s.byCurrency);

  el.innerHTML = `
    ${header({ title: t.name, back: '#/trips', sub: esc(fmtDateRange(t.startDate, t.endDate)), right: `<a class="btn btn-small btn-ghost" href="#/trips/${esc(t.id)}/edit">${icons.edit}<span>編集</span></a>` })}
    <div class="page">
      <section class="card hero-card">
        <span class="eyebrow">遠征全体の損益（経費控除後）${r.provisional ? '<span class="badge badge-warn">暫定</span>' : ''}</span>
        <div class="hero-amount ${signClass(r.net)}">${esc(fmtYen(r.net))}</div>
        ${r.provisional ? `<p class="hero-note">${esc(r.reasons.join('・'))}のため暫定です。${r.expenses == null ? '経費を入力すると確定します。' : ''}${s.jpy.pending ? '円換算が済むと確定します。' : ''}</p>` : ''}
        <div class="calc-lines">
          <div class="kv"><span class="k">ポーカー収支（円換算）</span><span class="v num ${signClass(s.jpy.profit)}">${esc(fmtYen(s.jpy.profit))}${s.jpy.pending ? `<small>（換算待ち${s.jpy.pending}件を除く）</small>` : ''}</span></div>
          <div class="kv"><span class="k">経費合計</span><span class="v num">${r.expenses == null ? '<span class="badge badge-warn">未入力</span>' : '−' + esc(fmtYen(r.expenses, { sign: false }))}</span></div>
        </div>
        <button type="button" class="btn btn-ghost btn-block" data-act="expenses">${icons.coin}<span>${r.expenses == null ? '経費合計を入力' : '経費合計を更新'}</span></button>
      </section>

      <section class="card">
        <h3 class="card-title">ポーカー成績 <small class="muted">経費は含みません</small></h3>
        <div class="stat-grid">
          <div class="stat"><span class="stat-k">セッション</span><span class="stat-v">${s.count}件</span></div>
          <div class="stat"><span class="stat-k">実プレイ時間</span><span class="stat-v">${esc(fmtDuration(s.minutes))}</span></div>
          <div class="stat"><span class="stat-k">円時給${s.jpy.pending ? '<small>（換算済み分）</small>' : ''}</span><span class="stat-v ${signClass(s.jpy.hourly)}">${esc(fmtHourly(s.jpy.hourly, 'JPY'))}</span></div>
          <div class="stat"><span class="stat-k">bb/時間</span><span class="stat-v ${signClass(s.bbPerHour)}">${esc(fmtBBph(s.bbPerHour))}</span></div>
        </div>
        ${curs.length ? `
          <div class="cur-table">
            ${curs.map((c) => `
              <div class="cur-row">
                <span class="cur-code">${esc(c.currency)}</span>
                <span class="num ${signClass(c.profit)}">${esc(fmtMoney(c.profit, c.currency))}</span>
                <span class="muted num">${esc(fmtHourly(c.hourly, c.currency))}</span>
              </div>`).join('')}
          </div>` : ''}
        <a class="link small block-link" href="#/stats?trip=${esc(t.id)}">この遠征の詳しい成績を見る</a>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">プレイ記録</h2><a class="link" href="#/sessions/new?trip=${esc(t.id)}">＋ 追加</a></div>
        ${list.length ? `<div class="list card">${list.map((x) => sessionRow(x, db, { showTrip: false })).join('')}</div>` : '<p class="muted small">この遠征の記録はまだありません。</p>'}
      </section>

      ${t.note ? `<section class="card"><h3 class="card-title">メモ</h3><div class="note-box">${esc(t.note)}</div></section>` : ''}

      <button type="button" class="btn btn-text-danger btn-block" data-act="delete">${icons.trash}<span>この遠征を削除</span></button>
    </div>`;

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'expenses') {
      const res = await numberDialog({
        title: '経費合計（円）',
        message: '航空券・宿泊・飲食など、この遠征の経費の合計額を円で入力します。<br>空欄にすると「未入力」に戻ります（0円とは区別されます）。<br>チップから払ったタイムレーキやポットのレーキは含めないでください。',
        label: '経費合計',
        suffix: '円',
        initial: t.expenses != null ? fmtInput(t.expenses) : '',
        parse: { min: 0, allowEmpty: true, maxDecimals: 0 },
      });
      if (!res) return;
      try { A.updateTripExpenses(t.id, res.value); toast(res.value == null ? '経費を未入力に戻しました' : '経費を更新しました', { type: 'success' }); } catch (err) { showError(err); }
    } else if (btn.dataset.act === 'delete') {
      await deleteTripFlow(t, r.sessions.length);
    }
  });
}

async function deleteTripFlow(t, count) {
  let choice;
  if (count === 0) {
    choice = await modal({
      title: 'この遠征を削除しますか？',
      body: `<p>「${esc(t.name)}」を削除します。プレイ記録はありません。</p>`,
      actions: [{ label: 'キャンセル', value: null }, { label: '削除する', value: 'detach', kind: 'danger' }],
    });
  } else {
    choice = await modal({
      title: 'この遠征を削除しますか？',
      body: `<p>「${esc(t.name)}」には<b>${count}件のプレイ記録</b>があります。記録をどうするか選んでください。</p>`,
      actions: [
        { label: 'キャンセル', value: null },
        { label: `記録は残す（遠征なしに移動）`, value: 'detach', kind: 'primary' },
        { label: `記録${count}件も削除する`, value: 'cascade', kind: 'danger' },
      ],
    });
  }
  if (!choice) return;
  try {
    const res = A.deleteTrip(t.id, choice);
    location.hash = '#/trips';
    toast(choice === 'cascade' ? `遠征と記録${res.count}件を削除しました` : res.count ? `遠征を削除しました（記録${res.count}件は「遠征なし」に残っています）` : '遠征を削除しました', { type: 'success', duration: 5000 });
  } catch (err) { showError(err); }
}

export function renderTripForm(el, { id }) {
  const db = getDb();
  const editing = id ? db.trips.find((x) => x.id === id) : null;
  if (id && !editing) {
    el.innerHTML = header({ title: '遠征の編集', back: '#/trips' }) + `<div class="page">${emptyState({ icon: 'alert', title: 'この遠征は見つかりません' })}</div>`;
    return;
  }
  const draftKey = editing ? `trip:${id}` : 'trip-new';
  const draft = db.drafts[draftKey];
  const v = draft || (editing
    ? { name: editing.name, startDate: editing.startDate, endDate: editing.endDate || '', expenses: editing.expenses != null ? fmtInput(editing.expenses) : '', note: editing.note || '' }
    : { name: '', startDate: todayYMD(), endDate: '', expenses: '', note: '' });
  const back = editing ? `#/trips/${id}` : '#/trips';

  el.innerHTML = `
    ${header({ title: editing ? '遠征の編集' : '新しい遠征', back })}
    <div class="page">
      ${draft ? `<div class="notice notice-info">${icons.check}<div>入力途中の内容を復元しました。</div></div>` : ''}
      <form class="form" novalidate autocomplete="off">
        <div class="form-summary" role="alert" hidden></div>
        <section class="card form-card">
          <label class="field">
            <span class="field-label">遠征名</span>
            <input class="input" type="text" name="name" value="${esc(v.name)}" placeholder="例：2026年5月 マニラ" maxlength="40" enterkeyhint="next">
            <span class="field-error" data-err="name"></span>
          </label>
          <div class="date-pair">
            <label class="field">
              <span class="field-label">開始日</span>
              <input class="input" type="date" name="startDate" value="${esc(v.startDate)}">
              <span class="field-error" data-err="startDate"></span>
            </label>
            <label class="field">
              <span class="field-label">終了日 <small class="muted">未定なら空欄</small></span>
              <input class="input" type="date" name="endDate" value="${esc(v.endDate)}">
              <span class="field-error" data-err="endDate"></span>
            </label>
          </div>
          <button type="button" class="link small" data-act="clear-end">終了日を未定にする</button>
          <label class="field">
            <span class="field-label">経費合計（円）<small class="muted">後から更新できます</small></span>
            <span class="input-wrap">
              <input class="input num" type="text" inputmode="decimal" name="expenses" value="${esc(v.expenses)}" placeholder="未入力" autocomplete="off">
              <span class="input-suffix">円</span>
            </span>
            <span class="field-hint">航空券・宿泊・飲食などの合計。空欄は「未入力」（損益は暫定表示）、0円と区別されます。複数日の会費もここに含めてください。</span>
            <span class="field-error" data-err="expenses"></span>
          </label>
          <label class="field">
            <span class="field-label">メモ（任意）</span>
            <textarea class="input" name="note" rows="2" maxlength="500">${esc(v.note)}</textarea>
          </label>
        </section>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block btn-lg" data-act="save">${icons.check}<span>${editing ? '変更を保存' : '遠征を作成'}</span></button>
          <button type="button" class="btn btn-ghost btn-block" data-act="cancel">キャンセル</button>
        </div>
      </form>
    </div>`;

  const form = el.querySelector('form');
  attachNumberFormatting(form);
  let timer;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { A.setDraft(draftKey, readForm(form)); } catch { /* 下書き保存の失敗は致命的でない */ } }, 400);
  });
  form.querySelector('[data-act="clear-end"]').addEventListener('click', () => { form.endDate.value = ''; form.dispatchEvent(new Event('input')); });
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    clearTimeout(timer);
    A.clearDraft(draftKey);
    location.hash = back;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('[data-act="save"]');
    busy(btn, async () => {
      const r = validateTrip(readForm(form));
      if (!r.ok) { showErrors(form, r.errors); return; }
      clearErrors(form);
      clearTimeout(timer);
      try {
        if (editing) {
          A.updateTrip(id, r.value);
          A.clearDraft(draftKey);
          toast('遠征を更新しました', { type: 'success' });
          location.hash = `#/trips/${id}`;
        } else {
          const t = A.createTrip(r.value);
          A.clearDraft(draftKey);
          toast('遠征を作成しました', { type: 'success' });
          location.hash = `#/trips/${t.id}`;
        }
      } catch (err) {
        showError(err, err.name === 'SaveError' ? () => form.requestSubmit() : null);
      }
    });
  });
}
