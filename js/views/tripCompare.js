// 遠征の比較：遠征ごとの損益・時給・経費を並べて見る
import { getDb } from '../store.js';
import { tripMetrics } from '../calc.js';
import { esc, fmtYen, fmtDuration, fmtBBph, fmtHourly, fmtDateRange, fmtNum, signClass, todayYMD } from '../util.js';
import { header, icons, emptyState } from '../ui.js';

let sort = 'date';
const SORTS = [['date', '新しい順'], ['net', '損益順'], ['hourly', '円時給順']];

export function renderTripCompare(el) {
  const db = getDb();
  const today = todayYMD();
  const rows = db.trips.map((t) => ({ t, m: tripMetrics(t, db.sessions, today) }));
  const key = {
    date: (x) => x.t.startDate,
    net: (x) => x.m.net,
    hourly: (x) => x.m.summary.jpy.hourly,
  }[sort];
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x < y ? 1 : x > y ? -1 : 0;
  });
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.m.net)));
  const totalNet = rows.reduce((a, r) => a + r.m.net, 0);
  const anyProv = rows.some((r) => r.m.provisional);

  el.innerHTML = `
    ${header({ title: '遠征の比較', back: '#/trips' })}
    <div class="page">
      ${!rows.length ? emptyState({ icon: 'trip', title: '遠征がありません', text: '遠征を作成すると、ここで損益・時給・経費を比べられます。', actions: `<a class="btn btn-primary" href="#/trips/new">${icons.plus}<span>遠征を作成</span></a>` }) : `
        <section class="card">
          <div class="card-title-row"><h3 class="card-title">遠征全体の損益（経費控除後）</h3></div>
          <div class="div-bars">
            ${rows.map(({ t, m }) => {
              const w = Math.round((Math.abs(m.net) / maxAbs) * 100);
              return `
                <a class="div-row" href="#/trips/${esc(t.id)}">
                  <span class="div-name">${esc(t.name)}${m.provisional ? '<span class="badge badge-warn">暫定</span>' : ''}</span>
                  <span class="div-track" aria-hidden="true">
                    <span class="div-half div-neg">${m.net < 0 ? `<span class="neg" style="width:${w}%"></span>` : ''}</span>
                    <span class="div-half div-pos">${m.net > 0 ? `<span class="pos" style="width:${w}%"></span>` : ''}</span>
                  </span>
                  <span class="div-val num ${signClass(m.net)}">${esc(fmtYen(m.net))}</span>
                </a>`;
            }).join('')}
          </div>
          ${rows.length > 1 ? `<div class="kv kv-total"><span class="k">合計${anyProv ? '<span class="badge badge-warn">暫定</span>' : ''}</span><span class="v num ${signClass(totalNet)}">${esc(fmtYen(totalNet))}</span></div>` : ''}
        </section>

        <div class="sort-row" role="group" aria-label="並び順">
          <span class="muted small">並び順</span>
          ${SORTS.map(([k, l]) => `<button type="button" class="chip ${sort === k ? 'chip-on' : ''}" aria-pressed="${sort === k}" data-sort="${k}">${l}</button>`).join('')}
        </div>

        ${rows.map(({ t, m }) => tripCard(t, m)).join('')}

        <p class="muted small">「経費をまかなう時給」は 経費合計 ÷ 実プレイ時間 です。円時給がこれを上回っていれば、ポーカーの勝ちで経費を上回っています。</p>
      `}
    </div>`;

  el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { sort = b.dataset.sort; renderTripCompare(el); }));
}

function tripCard(t, m) {
  const s = m.summary;
  const hourly = s.jpy.hourly;
  const be = m.breakEvenHourly;
  const covered = hourly != null && be != null ? hourly >= be : null;
  return `
    <a class="card trip-cmp" href="#/trips/${esc(t.id)}">
      <div class="trip-card-head">
        <div>
          <h3 class="trip-name">${esc(t.name)}</h3>
          <p class="trip-dates">${esc(fmtDateRange(t.startDate, t.endDate))}<span class="dot-sep">·</span>${m.days}日間${m.ongoing ? '（継続中）' : ''}</p>
        </div>
        <div class="trip-cmp-net">
          <span class="eyebrow">遠征損益${m.provisional ? '<span class="badge badge-warn">暫定</span>' : ''}</span>
          <span class="num ${signClass(m.net)}">${s.count || m.expenses != null ? esc(fmtYen(m.net)) : '—'}</span>
        </div>
      </div>
      <div class="stat-grid stat-grid-3col">
        <div class="stat"><span class="stat-k">ポーカー収支</span><span class="stat-v ${signClass(s.jpy.profit)}">${s.count ? esc(fmtYen(s.jpy.profit)) : '—'}</span></div>
        <div class="stat"><span class="stat-k">経費</span><span class="stat-v">${m.expenses == null ? '<span class="muted">未入力</span>' : esc(fmtYen(m.expenses, { sign: false }))}</span></div>
        <div class="stat"><span class="stat-k">セッション</span><span class="stat-v">${s.count}件</span></div>
        <div class="stat"><span class="stat-k">円時給${s.jpy.pending ? '<small>換算済み分</small>' : ''}</span><span class="stat-v ${signClass(hourly)}">${esc(fmtHourly(hourly, 'JPY'))}</span></div>
        <div class="stat"><span class="stat-k">bb/時間</span><span class="stat-v ${signClass(s.bbPerHour)}">${esc(fmtBBph(s.bbPerHour))}</span></div>
        <div class="stat"><span class="stat-k">実プレイ時間</span><span class="stat-v">${esc(fmtDuration(s.minutes))}</span><span class="stat-sub">1日平均 ${m.hoursPerDay != null ? fmtNum(m.hoursPerDay, { maxFrac: 1 }) : '—'}時間</span></div>
      </div>
      ${be != null ? `
        <div class="be-line ${covered ? 'ok' : covered === false ? 'ng' : ''}">
          <span>経費をまかなう時給</span>
          <b class="num">${esc(fmtHourly(be, 'JPY').replace(/^\+/, ''))}</b>
          ${covered != null ? `<span class="be-tag">${covered ? '上回った' : '届かず'}</span>` : ''}
        </div>` : ''}
      ${m.reasons.length ? `<p class="trip-note">${esc(m.reasons.join('・'))}のため暫定</p>` : ''}
    </a>`;
}
