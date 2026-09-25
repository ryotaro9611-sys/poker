// フォーム部品の共通化
import { CURRENCIES, CURRENCY_CODES, esc, fmtDateRange, fmtNum, $$ } from '../util.js';

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
    </label>`;
}

export function currencyField(selected) {
  return `
    <fieldset class="field">
      <legend class="field-label">通貨</legend>
      <div class="seg seg-4" role="radiogroup">
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
  return o;
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
    const el = form.querySelector(`[data-err="${k}"]`);
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
