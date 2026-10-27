// フォーム部品の共通化
import { CURRENCIES, CURRENCY_CODES, esc, fmtDateRange, fmtNum, fmtInput, parseNumber, $$ } from '../util.js';
import { FIXED_TABLES, defaultFee, fixedAmounts } from '../calc.js';
import { CONDITIONS, TAGS } from '../tags.js';

export function tripOptions(db, selected) {
  const trips = [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return `<option value="">遠征なし</option>` + trips
    .map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}（${esc(fmtDateRange(t.startDate, t.endDate).replace(/\(.\)/g, ''))}）</option>`)
    .join('');
}

export function tripField(db, selected, { hint = '' } = {}) {
  return `
    <label class="field">
      <span class="field-label">遠征</span>
      <select class="input" name="tripId">${tripOptions(db, selected)}</select>
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
      <span class="field-error" data-err="tripId"></span>
    </label>`;
}

/** 選んでいた遠征が削除されていた場合：選択肢を最新にして、遠征欄にエラーを出す */
export function handleTripMissing(form, db) {
  const sel = form.querySelector('[name="tripId"]');
  if (sel) sel.innerHTML = tripOptions(db, '');
  showErrors(form, { tripId: '選んでいた遠征は削除されました。選び直してください（「遠征なし」も選べます）。' });
}

export function currencyField(selected) {
  return `
    <fieldset class="field">
      <legend class="field-label">通貨</legend>
      <div class="seg seg-5" role="radiogroup">
        ${CURRENCY_CODES.map((c) => `
          <label class="seg-item">
            <input type="radio" name="currency" value="${c}" ${c === selected ? 'checked' : ''}>
            <span><b>${c}</b><small>${esc(CURRENCIES[c].label)}</small></span>
          </label>`).join('')}
      </div>
      <span class="field-error" data-err="currency"></span>
    </fieldset>`;
}

export function textField({ name, label, value = '', placeholder = '', hint = '', list = '', maxlength = 60, autocomplete = 'off' }) {
  return `
    <label class="field">
      <span class="field-label">${esc(label)}</span>
      <input class="input" type="text" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${maxlength}" autocomplete="${autocomplete}" enterkeyhint="next" ${list ? `list="${list}"` : ''}>
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
      <span class="field-error" data-err="${name}"></span>
    </label>`;
}

export function amountField({ name, label, value = '', unit = '', hint = '', placeholder = '0', big = false }) {
  return `
    <label class="field ${big ? 'field-big' : ''}">
      <span class="field-label">${esc(label)}</span>
      <span class="input-wrap">
        <input class="input num" type="text" inputmode="decimal" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="next">
        <span class="input-suffix" data-unit>${esc(unit)}</span>
      </span>
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
      <span class="field-error" data-err="${name}"></span>
    </label>`;
}

export function stakeFields(sb, bb) {
  return `
    <div class="field">
      <span class="field-label">レート（SB / BB）</span>
      <div class="stake-row">
        <span class="input-wrap"><span class="input-prefix">SB</span><input class="input num" type="text" inputmode="decimal" name="sb" value="${esc(sb)}" placeholder="2" autocomplete="off" aria-label="スモールブラインド" enterkeyhint="next"></span>
        <span class="stake-slash">/</span>
        <span class="input-wrap"><span class="input-prefix">BB</span><input class="input num" type="text" inputmode="decimal" name="bb" value="${esc(bb)}" placeholder="5" autocomplete="off" aria-label="ビッグブラインド" enterkeyhint="next"></span>
      </div>
      <div class="chips" data-stake-chips></div>
      <span class="field-error" data-err="sb"></span>
      <span class="field-error" data-err="bb"></span>
    </div>`;
}

export function durationField(hours, mins, hint = '') {
  return `
    <div class="field">
      <span class="field-label">実プレイ時間</span>
      <div class="dur-row">
        <span class="input-wrap"><input class="input num" type="text" inputmode="numeric" name="hours" value="${esc(hours)}" placeholder="0" autocomplete="off" aria-label="時間" enterkeyhint="next"><span class="input-suffix">時間</span></span>
        <span class="input-wrap"><input class="input num" type="text" inputmode="numeric" name="mins" value="${esc(mins)}" placeholder="0" autocomplete="off" aria-label="分" enterkeyhint="next"><span class="input-suffix">分</span></span>
      </div>
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
      <span class="field-error" data-err="duration"></span>
    </div>`;
}

export function chipsHtml(items) {
  return items.map((it) => `<button type="button" class="chip" data-chip='${esc(JSON.stringify(it.data))}'>${esc(it.label)}</button>`).join('');
}

export function readForm(form) {
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : '';
  if (form.querySelector('[name="tags"]')) o.tags = fd.getAll('tags').map(String);
  if (form.querySelector('[name="condition"]')) o.condition = String(fd.get('condition') || '');
  return o;
}

/** 今日の冴え（5段階・任意） */
export function conditionField(value, { hint = '' } = {}) {
  const v = value == null ? '' : String(value);
  return `
    <fieldset class="field">
      <legend class="field-label">今日の冴え <small class="muted">座る前の自己評価・任意</small></legend>
      <div class="seg seg-5 cond-seg" role="radiogroup">
        ${CONDITIONS.map((c) => `
          <label class="seg-item">
            <input type="radio" name="condition" value="${c.value}" ${v === String(c.value) ? 'checked' : ''}>
            <span><b>${c.value}</b><small>${esc(c.label)}</small></span>
          </label>`).join('')}
      </div>
      <button type="button" class="link small cond-clear" data-cond-clear ${v ? '' : 'hidden'}>未入力に戻す</button>
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
    </fieldset>`;
}

/** タグ（選択式・複数可） */
export function tagsField(selected = []) {
  const set = new Set(Array.isArray(selected) ? selected : []);
  return `
    <fieldset class="field">
      <legend class="field-label">タグ <small class="muted">当てはまるものだけ・任意</small></legend>
      <div class="tag-chips">
        ${TAGS.map((t) => `
          <label class="tag-chip" title="${esc(t.hint)}">
            <input type="checkbox" name="tags" value="${t.id}" ${set.has(t.id) ? 'checked' : ''}>
            <span>${esc(t.label)}</span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

/** 冴えの「未入力に戻す」 */
export function bindConditionClear(form, onChange) {
  const btn = form.querySelector('[data-cond-clear]');
  if (!btn) return;
  form.addEventListener('change', (e) => { if (e.target.name === 'condition') btn.hidden = false; });
  btn.addEventListener('click', () => {
    form.querySelectorAll('[name="condition"]').forEach((r) => { r.checked = false; });
    btn.hidden = true;
    if (onChange) onChange();
  });
}

export function clearErrors(form) {
  $$('.field-error', form).forEach((e) => { e.textContent = ''; });
  $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  const sum = form.querySelector('.form-summary');
  if (sum) { sum.hidden = true; sum.textContent = ''; }
}

export function showErrors(form, errors) {
  clearErrors(form);
  let first = null;
  for (const [k, msg] of Object.entries(errors)) {
    const cands = $$(`[data-err="${k}"]`, form);
    const el = cands.find((e) => !e.closest('fieldset[disabled]')) || cands[0];
    if (el) el.textContent = msg;
    const inputs = k === 'duration' ? $$('[name="hours"],[name="mins"]', form) : $$(`[name="${k}"]`, form);
    inputs.forEach((i) => i.setAttribute('aria-invalid', 'true'));
    if (!first) first = (el && el.closest('.field')) || inputs[0];
  }
  const sum = form.querySelector('.form-summary');
  if (sum) {
    sum.hidden = false;
    sum.textContent = `入力内容を確認してください（${Object.keys(errors).length}か所）`;
  }
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** 数値欄のフォーカスが外れたら 1,234 形式に整える */
export function attachNumberFormatting(form) {
  form.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains('num') || t.inputMode !== 'decimal') return;
    const s = t.value.replace(/[,\s，]/g, '').replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (s && /^\d+(\.\d+)?$/.test(s)) t.value = fmtNum(Number(s), { maxFrac: 2 }).replace(/−/g, '-');
  });
}

export function unitOf(cur) {
  return cur === 'JPY' ? '円' : cur;
}

/* ---------------- 記録の方式：ブラインド制／定額卓（台湾式） ---------------- */

export function formatField(selected) {
  const fixed = selected === 'fixed';
  return `
    <fieldset class="field">
      <legend class="field-label">記録の方式</legend>
      <div class="seg seg-2 format-seg" role="radiogroup">
        <label class="seg-item"><input type="radio" name="format" value="blind" ${fixed ? '' : 'checked'}><span><b>ブラインド制</b><small>SB/BB のテーブル</small></span></label>
        <label class="seg-item"><input type="radio" name="format" value="fixed" ${fixed ? 'checked' : ''}><span><b>定額卓</b><small>台湾式（6,600卓など）</small></span></label>
      </div>
    </fieldset>`;
}

/** 方式ごとの入力欄を包む。使わない方は隠して無効にする（値が送信されない） */
export function modeBox(mode, inner) {
  return `<fieldset class="mode-box" data-mode="${mode}">${inner}</fieldset>`;
}

/** 料金の欄の表示値：初期値（1/11）と同じなら空欄（＝自動） */
export function feeInputValue(table, fee) {
  if (fee == null || table == null) return '';
  return fee === defaultFee(table) ? '' : fmtInput(fee);
}

/** 定額卓の入力欄：テーブル額（ボタン5つ＋直接入力）・1回あたりの料金・（記録では）バイイン回数 */
export function fixedFields({ table = '', fee = '', count = '1', unit = 'TWD', withCount = true }) {
  return `
    <div class="field">
      <span class="field-label">テーブル（1回に払う額）</span>
      <div class="chips table-chips" role="group" aria-label="テーブル">
        ${FIXED_TABLES.map((t) => `<button type="button" class="chip" data-table="${t}" aria-pressed="false">${fmtNum(t)}</button>`).join('')}
      </div>
      <span class="input-wrap"><input class="input num" type="text" inputmode="decimal" name="table" value="${esc(table)}" placeholder="6,600" autocomplete="off" aria-label="テーブルの額"><span class="input-suffix" data-unit>${esc(unit)}</span></span>
      <span class="field-error" data-err="table"></span>
    </div>
    <label class="field">
      <span class="field-label">料金（1回あたり）</span>
      <span class="input-wrap"><input class="input num" type="text" inputmode="decimal" name="feePerBuyin" value="${esc(fee)}" placeholder="自動" autocomplete="off" data-fee-input><span class="input-suffix" data-unit>${esc(unit)}</span></span>
      <span class="field-hint">空欄ならテーブル額の 1/11（チップの10%）。違うときだけ入れてください。</span>
      <span class="field-error" data-err="feePerBuyin"></span>
    </label>
    ${withCount ? `
      <div class="field">
        <span class="field-label">バイイン回数（買い足しも1回）</span>
        <div class="stepper">
          <button type="button" class="btn btn-ghost stepper-btn" data-count-step="-1" aria-label="1回減らす">−</button>
          <input class="input num stepper-input" type="text" inputmode="numeric" name="buyinCount" value="${esc(count)}" autocomplete="off" aria-label="バイイン回数">
          <button type="button" class="btn btn-ghost stepper-btn" data-count-step="1" aria-label="1回増やす">＋</button>
        </div>
        <span class="field-error" data-err="buyinCount"></span>
      </div>` : ''}
    <p class="fixed-summary" data-fixed-summary aria-live="polite"></p>`;
}

/** 定額卓の内訳（チップ代・料金）を表示する */
export function updateFixedSummary(form) {
  const box = form.querySelector('[data-fixed-summary]');
  if (!box) return;
  const tableIn = form.querySelector('[name="table"]');
  const t = parseNumber(tableIn ? tableIn.value : '');
  form.querySelectorAll('[data-table]').forEach((b) => {
    const on = t.ok && Number(b.dataset.table) === t.value;
    b.classList.toggle('chip-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const feeIn = form.querySelector('[name="feePerBuyin"]');
  if (!t.ok || !(t.value > 0)) { box.textContent = 'テーブルを選ぶと、チップ代と料金の内訳を表示します'; return; }
  if (feeIn) feeIn.placeholder = `自動（${fmtNum(defaultFee(t.value))}）`;
  const f = parseNumber(feeIn ? feeIn.value : '', { allowEmpty: true });
  const fee = f.ok ? (f.value ?? defaultFee(t.value)) : null;
  const countIn = form.querySelector('[name="buyinCount"]');
  const c = countIn ? parseNumber(countIn.value, { integer: true }) : { ok: true, value: 1 };
  if (fee == null || fee >= t.value || !c.ok || !(c.value >= 1)) { box.textContent = ''; return; }
  const cur = form.querySelector('[name="currency"]:checked')?.value || '';
  const one = fixedAmounts(t.value, fee, 1);
  const all = fixedAmounts(t.value, fee, c.value);
  box.innerHTML = c.value > 1
    ? `<b>${c.value}回で ${esc(fmtNum(t.value * c.value))} ${esc(cur)}</b>　チップ ${esc(fmtNum(all.buyin))} ＋ 料金 ${esc(fmtNum(all.timeRake))}`
    : `<b>1回あたり</b>　チップ ${esc(fmtNum(one.buyin))} ＋ 料金 ${esc(fmtNum(one.timeRake))}`;
}

/**
 * 方式の切り替えと、定額卓のボタン操作をまとめて扱う。
 * onChange(fixed) は方式が切り替わったときに呼ばれる。
 */
export function bindFormatMode(form, onChange) {
  const apply = (fromUser) => {
    const fixed = form.querySelector('[name="format"]:checked')?.value === 'fixed';
    form.querySelectorAll('[data-mode]').forEach((box) => {
      const on = box.dataset.mode === (fixed ? 'fixed' : 'blind');
      box.hidden = !on;
      box.disabled = !on;
    });
    updateFixedSummary(form);
    if (onChange) onChange(fixed, fromUser);
  };
  form.addEventListener('change', (e) => { if (e.target.name === 'format') apply(true); });
  form.addEventListener('input', (e) => {
    if (['table', 'feePerBuyin', 'buyinCount', 'currency'].includes(e.target.name)) updateFixedSummary(form);
  });
  form.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-table]');
    if (tb) {
      form.querySelector('[name="table"]').value = fmtInput(Number(tb.dataset.table));
      form.querySelector('[name="table"]').dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const st = e.target.closest('[data-count-step]');
    if (st) {
      const input = form.querySelector('[name="buyinCount"]');
      const cur = parseNumber(input.value, { integer: true });
      const next = Math.min(999, Math.max(1, (cur.ok && cur.value ? cur.value : 1) + Number(st.dataset.countStep)));
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  apply(false);
}

/** レーキバック（受け取った分）の折りたたみ欄 */
export function rakebackField(value, unit) {
  const open = !!(value && parseNumber(value).value > 0);
  return `
    <details class="disclosure" ${open ? 'open' : ''}>
      <summary><span>レーキバック（受け取った分）</span><span class="disclosure-value" data-rb-summary>${open ? '' : 'なし'}</span></summary>
      <label class="field">
        <span class="field-label">受け取ったレーキバック（現金）</span>
        <span class="input-wrap"><input class="input num" type="text" inputmode="decimal" name="rakeback" value="${esc(value)}" placeholder="0" autocomplete="off"><span class="input-suffix" data-unit>${esc(unit)}</span></span>
        <span class="field-hint">払った料金から戻ってきた分。<b>チップで受け取った分はキャッシュアウトに含まれるので入れません。</b>後でまとめて受け取ったときは、受け取った日の記録に入れてください。</span>
        <span class="field-error" data-err="rakeback"></span>
      </label>
    </details>`;
}

/** 定額卓の任意のブラインド（入れると bb/時間も出す）。ブラインド制の欄と取り違えないよう、名前を分ける（fixedSb・fixedBb） */
export function optionalBlindsField(sb, bb) {
  const has = !!(sb || bb);
  return `
    <details class="disclosure" ${has ? 'open' : ''}>
      <summary><span>ブラインド（任意）</span><span class="disclosure-value">${has ? esc(`${sb}/${bb}`) : 'なし'}</span></summary>
      <div class="field">
        <div class="stake-row">
          <span class="input-wrap"><span class="input-prefix">SB</span><input class="input num" type="text" inputmode="decimal" name="fixedSb" value="${esc(sb)}" autocomplete="off" aria-label="スモールブラインド（任意）"></span>
          <span class="stake-slash">/</span>
          <span class="input-wrap"><span class="input-prefix">BB</span><input class="input num" type="text" inputmode="decimal" name="fixedBb" value="${esc(bb)}" autocomplete="off" aria-label="ビッグブラインド（任意）"></span>
        </div>
        <span class="field-hint">入れると、この記録も bb/時間の集計に含めます。不要なら空欄のまま。</span>
        <span class="field-error" data-err="sb"></span>
        <span class="field-error" data-err="bb"></span>
      </div>
    </details>`;
}

/** フォームの値を記録の入力に整える：定額卓では任意のブラインド欄（fixedSb・fixedBb）を sb・bb として扱う */
export function sessionInput(raw) {
  const out = { ...raw };
  if (out.format === 'fixed') {
    out.sb = out.fixedSb ?? '';
    out.bb = out.fixedBb ?? '';
  }
  delete out.fixedSb;
  delete out.fixedBb;
  return out;
}
