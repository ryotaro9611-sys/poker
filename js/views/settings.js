// 設定：デモ、バックアップ、為替、データ管理、使い方
import { getDb, isDemo, enterDemo, exitDemo, exportJson, importJson, wipeAll, requestPersist, status } from '../store.js';
import { sessionRate } from '../calc.js';
import { rateState } from '../rates.js';
import { esc, todayYMD } from '../util.js';
import { header, icons, toast, showError, confirmDialog, modal } from '../ui.js';
import { pendingNotice, bindPendingNotice } from './sessions.js';

export const APP_VERSION = '1.0.0';

export function renderSettings(el) {
  const db = getDb();
  const pending = db.sessions.filter((s) => sessionRate(s) == null).length;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  el.innerHTML = `
    ${header({ title: '設定' })}
    <div class="page">
      <section class="card">
        <h3 class="card-title">デモ</h3>
        ${isDemo() ? `
          <p class="small">現在<b>デモを表示中</b>です。デモの操作はこの画面を閉じると消え、実データや進行中のセッションには影響しません。</p>
          <button type="button" class="btn btn-primary btn-block" data-act="exit-demo">通常利用に戻る</button>` : `
          <p class="small muted">架空の遠征2件・セッション8件で、画面と成績表示を確認できます。実データとは完全に分かれています。</p>
          <button type="button" class="btn btn-ghost btn-block" data-act="demo">${icons.eye}<span>デモを開く</span></button>`}
      </section>

      <section class="card">
        <h3 class="card-title">円換算レート</h3>
        <p class="small muted">各セッションのプレイ日時点の参考レート（プレイ日以前で最新のもの）を自動取得します。主な取得元は Frankfurter API（各国中央銀行の参考レート）、取得できない場合は currency-api（jsDelivr 配信）を使います。いずれも無料・登録不要で、送信するのは通貨とプレイ日だけです。収支データは外部に送りません。</p>
        ${pending ? pendingNotice(pending) : `<p class="small">${icons.check} 換算待ちの記録はありません。</p>`}
        ${rateState.lastRunAt ? `<p class="muted small">最終取得確認：${esc(new Date(rateState.lastRunAt).toLocaleString('ja-JP'))}</p>` : ''}
      </section>

      <section class="card">
        <h3 class="card-title">データの保存とバックアップ</h3>
        <p class="small muted">記録はこの端末のブラウザ内だけに保存されます。iPhoneでは<b>「ホーム画面に追加」して使う</b>と、データが消されにくくオフラインでも起動できます。機種変更や万一に備えて、ときどきバックアップを書き出してください。</p>
        <div class="kv"><span class="k">ホーム画面から起動</span><span class="v">${standalone ? 'はい' : 'いいえ（ブラウザで表示中）'}</span></div>
        <div class="kv"><span class="k">永続保存</span><span class="v" data-persist>確認中…</span></div>
        <div class="kv"><span class="k">保存件数</span><span class="v">遠征 ${getDb().trips.length}件 / 記録 ${getDb().sessions.length}件</span></div>
        ${status.notice ? `<div class="notice notice-warn">${icons.alert}<div>${esc(status.notice)}</div></div>` : ''}
        <div class="btn-col">
          <button type="button" class="btn btn-ghost btn-block" data-act="export" ${isDemo() ? 'disabled' : ''}>${icons.download}<span>バックアップを書き出す（JSON）</span></button>
          <label class="btn btn-ghost btn-block ${isDemo() ? 'is-disabled' : ''}">${icons.upload}<span>バックアップから復元</span><input type="file" accept="application/json,.json" data-act="import" hidden ${isDemo() ? 'disabled' : ''}></label>
        </div>
        ${isDemo() ? '<p class="muted small">デモ中はバックアップ操作はできません。</p>' : ''}
      </section>

      <section class="card">
        <h3 class="card-title">使い方</h3>
        <ol class="howto">
          <li><b>遠征を作成</b>（遠征タブ）…名前と開始日。終了日・経費は後から入力できます。</li>
          <li><b>プレイ開始</b>（ホーム）…場所・通貨・レート・最初のバイインを入れてタイマー開始。休憩・再開、追加バイインもホームから。</li>
          <li><b>終了して精算</b> …キャッシュアウト額を入力して保存。実プレイ時間・プレイ日は保存前に補正できます。</li>
          <li><b>過去のプレイ</b>は「終わったプレイを記録」または記録タブの「追加」から。</li>
          <li><b>タイムレーキ（別払い）</b>は、チップ以外から別に払った分だけ入力します。</li>
          <li><b>成績</b>タブで全期間・期間指定・遠征を切り替え、円換算または各通貨で確認します。</li>
        </ol>
      </section>

      ${!isDemo() ? `
        <section class="card card-danger">
          <h3 class="card-title">すべてのデータを削除</h3>
          <p class="small muted">この端末の遠征・記録・進行中のセッションをすべて削除します。元に戻せないため、先にバックアップを書き出してください。</p>
          <button type="button" class="btn btn-text-danger btn-block" data-act="wipe">${icons.trash}<span>すべてのデータを削除</span></button>
        </section>` : ''}

      <p class="muted small center">TRIP LEDGER v${APP_VERSION}</p>
    </div>`;

  bindPendingNotice(el);
  (async () => {
    const out = el.querySelector('[data-persist]');
    let txt = '未対応のブラウザ';
    try {
      if (navigator.storage && navigator.storage.persisted) {
        let ok = await navigator.storage.persisted();
        if (!ok && db.sessions.length) ok = await requestPersist();
        txt = ok ? '有効' : standalone ? '自動（ホーム画面アプリ）' : '未許可（ホーム画面への追加を推奨）';
      }
    } catch { /* noop */ }
    if (out) out.textContent = txt;
  })();

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'demo') {
      enterDemo();
      toast('デモを表示しています（実データには影響しません）');
      location.hash = '#/';
    } else if (act === 'exit-demo') {
      exitDemo();
      toast('通常利用に戻りました');
      location.hash = '#/';
    } else if (act === 'export') {
      try {
        const blob = new Blob([exportJson()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trip-ledger-backup-${todayYMD()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('バックアップを書き出しました', { type: 'success' });
      } catch (err) { showError(err); }
    } else if (act === 'wipe') {
      const ok = await confirmDialog({ title: 'すべてのデータを削除しますか？', message: `遠征${db.trips.length}件・記録${db.sessions.length}件${db.active ? '・進行中のセッション' : ''}を削除します。元に戻せません。`, confirmText: '次へ', danger: true });
      if (!ok) return;
      const v = await modal({ title: '最終確認', body: '<p>本当に削除します。よろしいですか？</p>', actions: [{ label: 'やめる', value: null }, { label: 'すべて削除', value: 'ok', kind: 'danger' }] });
      if (v !== 'ok') return;
      try { wipeAll(); toast('すべてのデータを削除しました'); location.hash = '#/'; } catch (err) { showError(err); }
    }
  });

  el.querySelector('input[data-act="import"]')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ok = await confirmDialog({
      title: 'バックアップから復元しますか？',
      message: `「${esc(file.name)}」の内容で、この端末の現在のデータ（遠征${db.trips.length}件・記録${db.sessions.length}件）を<b>置き換えます</b>。`,
      confirmText: '復元する', danger: true,
    });
    if (!ok) return;
    try {
      const text = await file.text();
      const r = importJson(text);
      toast(`復元しました（遠征${r.trips}件・記録${r.sessions}件）`, { type: 'success' });
    } catch (err) { showError(err); }
  });
}
