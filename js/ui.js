// 共通UI部品：アイコン、トースト、ダイアログ、二重操作防止
import { esc, parseNumber, $ } from './util.js';

const p = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  home: p('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>'),
  list: p('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  chart: p('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
  trip: p('<path d="M2.5 19h19"/><path d="m4 14.5 3.2 1.3L20 11a1.8 1.8 0 0 0-1.4-3.3L14 9.5 8 5.5l-2 .8 3.6 4.6-3.2 1.3L4.6 11 3 11.7Z"/>'),
  gear: p('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  plus: p('<path d="M12 5v14M5 12h14"/>'),
  back: p('<path d="m15 18-6-6 6-6"/>'),
  chevron: p('<path d="m9 18 6-6-6-6"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  refresh: p('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  edit: p('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  trash: p('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  check: p('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  alert: p('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>'),
  offline: p('<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.7M19 13a10 10 0 0 0-2-1.5M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5"/><circle cx="12" cy="20" r=".6" fill="currentColor"/>'),
  clock: p('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  coin: p('<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>'),
  download: p('<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16"/>'),
  upload: p('<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 19h16"/>'),
  eye: p('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  pin: p('<path d="M12 21s-7-6.1-7-11.5a7 7 0 1 1 14 0C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
};

/* ---------------- トースト ---------------- */

let toastTimer = null;
export function toast(message, { type = 'info', action = null, duration } = {}) {
  const root = $('#toast-root');
  if (!root) return;
  clearTimeout(toastTimer);
  root.innerHTML = `
    <div class="toast toast-${type}" role="${type === 'error' ? 'alert' : 'status'}">
      <span class="toast-msg">${esc(message)}</span>
      ${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}
      <button type="button" class="toast-close" aria-label="閉じる">×</button>
    </div>`;
  const el = root.firstElementChild;
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 200);
  };
  el.querySelector('.toast-close').onclick = close;
  if (action) {
    el.querySelector('.toast-action').onclick = async () => {
      close();
      try { await action.fn(); } catch (e) { showError(e); }
    };
  }
  toastTimer = setTimeout(close, duration ?? (type === 'error' ? 8000 : action ? 6000 : 2600));
}

export function showError(e, retry) {
  console.error(e);
  const msg = e && e.message ? e.message : String(e);
  toast(msg, { type: 'error', action: retry ? { label: '再試行', fn: retry } : null });
}

/* ---------------- ダイアログ ---------------- */

/**
 * モーダルを開く。actions: [{label, value, kind}]。閉じると選んだ value（キャンセルは null）で解決。
 * onAction(value, el) が false を返すと閉じない（入力検証用）。
 */
export function modal({ title, body = '', actions = [], onMount, onAction }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title" class="modal-title">${esc(title)}</h2>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${actions.map((a, i) => `<button type="button" class="btn ${a.kind ? 'btn-' + a.kind : 'btn-ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}
        </div>
      </div>`;
    root.appendChild(wrap);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => wrap.classList.add('show'));
    const done = (v) => {
      wrap.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        wrap.remove();
        if (!root.children.length) document.body.classList.remove('modal-open');
        if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* noop */ }
      }, 180);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
    wrap.querySelectorAll('.modal-actions button').forEach((b) => {
      b.addEventListener('click', async () => {
        const a = actions[Number(b.dataset.i)];
        if (onAction && a.value != null) {
          const r = await onAction(a.value, wrap);
          if (r === false) return;
          done(r === true || r === undefined ? a.value : r);
          return;
        }
        done(a.value ?? null);
      });
    });
    const form = wrap.querySelector('form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const primary = wrap.querySelector('.modal-actions .btn-primary');
        if (primary) primary.click();
      });
    }
    if (onMount) onMount(wrap);
    else {
      const first = wrap.querySelector('.modal-actions .btn-ghost') || wrap.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
  });
}

export async function confirmDialog({ title, message, confirmText = 'OK', cancelText = 'キャンセル', danger = false }) {
  const v = await modal({
    title,
    body: `<p>${message}</p>`,
    actions: [
      { label: cancelText, value: null, kind: 'ghost' },
      { label: confirmText, value: 'ok', kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === 'ok';
}

/** 数値を1つ入力させるダイアログ。validate は parseNumber の結果を受け取りエラー文字列を返す */
export function numberDialog({ title, message = '', label, suffix = '', initial = '', confirmText = '保存', parse = {}, validate, hint = '' }) {
  let result = null;
  return modal({
    title,
    body: `
      <form novalidate>
        ${message ? `<p class="modal-text">${message}</p>` : ''}
        <label class="field">
          <span class="field-label">${esc(label)}</span>
          <span class="input-wrap">
            <input class="input num" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(initial)}">
            ${suffix ? `<span class="input-suffix">${esc(suffix)}</span>` : ''}
          </span>
          ${hint ? `<span class="field-hint">${hint}</span>` : ''}
          <span class="field-error" aria-live="polite"></span>
        </label>
      </form>`,
    actions: [
      { label: 'キャンセル', value: null, kind: 'ghost' },
      { label: confirmText, value: 'ok', kind: 'primary' },
    ],
    onMount: (el) => {
      const input = el.querySelector('input');
      setTimeout(() => { input.focus(); input.select(); }, 60);
    },
    onAction: (value, el) => {
      const input = el.querySelector('input');
      const err = el.querySelector('.field-error');
      const r = parseNumber(input.value, parse);
      const msg = !r.ok ? r.error : validate ? validate(r) : null;
      if (msg) {
        err.textContent = msg;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return false;
      }
      result = r.value;
      return true;
    },
  }).then((v) => (v === 'ok' ? { value: result } : null));
}

/* ---------------- 二重操作防止 ---------------- */

export async function busy(btn, fn) {
  if (btn && btn.dataset.busy === '1') return undefined;
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.classList.add('is-busy');
  }
  try {
    return await fn();
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }
}

/* ---------------- 画面ヘッダー ---------------- */

export function header({ title, back = null, right = '', sub = '' }) {
  return `
    <header class="page-head ${back ? 'has-back' : ''}">
      ${back ? `<a class="head-back" href="${esc(back)}" aria-label="戻る">${icons.back}<span>戻る</span></a>` : ''}
      <div class="head-titles">
        <h1 class="page-title">${esc(title)}</h1>
        ${sub ? `<p class="page-sub">${sub}</p>` : ''}
      </div>
      ${right ? `<div class="head-right">${right}</div>` : ''}
    </header>`;
}

export function emptyState({ icon = 'list', title, text = '', actions = '' }) {
  return `
    <div class="empty">
      <div class="empty-icon">${icons[icon] || ''}</div>
      <p class="empty-title">${esc(title)}</p>
      ${text ? `<p class="empty-text">${text}</p>` : ''}
      ${actions ? `<div class="empty-actions">${actions}</div>` : ''}
    </div>`;
}
