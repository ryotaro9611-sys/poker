// バックアップ：iPhone の共有シートから「ファイル」（iCloud Drive など）へ保存する。非対応ならダウンロード。
import { commit, exportJson, getDb, isDemo, UserError } from './store.js';
import { todayYMD, ymdFromDate } from './util.js';

const SNOOZE_DAYS = 3;
const REMIND_DAYS = 7;

/** version: 書き出した時点の lastChangeAt（共有中に変更があれば、その変更は未バックアップのまま扱う） */
function markBackedUp(method, version) {
  const now = Date.now();
  try {
    commit((db) => {
      db.prefs.lastBackupAt = now;
      db.prefs.backupVersion = version;
      db.prefs.lastBackupMethod = method;
      db.prefs.backupSnoozeUntil = null;
    }, { touch: false });
  } catch {
    // ファイルの書き出し自体は済んでいる。日時を記録できないだけなので失敗扱いにしない
  }
}

/**
 * バックアップを書き出す。ボタンのクリック処理から直接呼ぶこと（共有シートの起動にユーザー操作が必要）。
 * 戻り値: { ok, method } / { cancelled: true }
 */
export async function backupNow() {
  if (isDemo()) throw new UserError('デモ中はバックアップできません。通常モードに戻ってから操作してください');
  const version = getDb().lastChangeAt ?? 0;
  const json = exportJson();
  const name = `trip-ledger-backup-${todayYMD()}.json`;
  let file = null;
  try { file = new File([json], name, { type: 'application/json' }); } catch { /* 古いブラウザ */ }
  if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'TRIP LEDGER バックアップ' });
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true };
      throw new Error('共有シートを開けませんでした。もう一度お試しください');
    }
    markBackedUp('share', version);
    return { ok: true, method: 'share' };
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  markBackedUp('download', version);
  return { ok: true, method: 'download' };
}

export function snoozeBackupReminder() {
  commit((db) => { db.prefs.backupSnoozeUntil = Date.now() + SNOOZE_DAYS * 86400000; }, { silent: true, touch: false });
}

/** 最終バックアップ以降に記録の変更があるか */
export function hasUnbackedChanges(db = getDb()) {
  if (!db.sessions.length && !db.trips.length) return false;
  if (!db.prefs.lastBackupAt) return true;
  const exported = db.prefs.backupVersion ?? db.prefs.lastBackupAt;
  return (db.lastChangeAt ?? 0) > exported;
}

/** ホームに出すバックアップのお知らせ。不要なら null */
export function backupReminder(db = getDb(), now = Date.now()) {
  if (isDemo() || !db.sessions.length || !hasUnbackedChanges(db)) return null;
  if (db.prefs.backupSnoozeUntil && db.prefs.backupSnoozeUntil > now) return null;
  const last = db.prefs.lastBackupAt;
  if (!last) return { reason: 'まだ一度もバックアップしていません。' };
  const today = ymdFromDate(new Date(now));
  const lastYmd = ymdFromDate(new Date(last));
  const ended = db.trips
    .filter((t) => t.endDate && t.endDate < today && t.endDate >= lastYmd && db.sessions.some((s) => s.tripId === t.id))
    .sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
  if (ended) return { reason: `遠征「${ended.name}」が終わりました。記録を保存しておきましょう。` };
  const days = Math.floor((now - last) / 86400000);
  if (days >= REMIND_DAYS) return { reason: `前回のバックアップから${days}日たっています。` };
  return null;
}
