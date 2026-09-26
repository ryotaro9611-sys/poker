// 成績：累計収支と推移グラフ／時給／bb/時間／遠征損益／場所・レート・遠征別の比較
import { getDb, isDemo, enterDemo } from '../store.js';
import {
  summarize, tripResult, cumulativeSeries, groupSummaries, stakeKey, locationKey, extremes, maxDrawdown,
} from '../calc.js';
import {
  esc, fmtYen, fmtMoney, fmtDuration, fmtBB, fmtBBph, fmtHourly, fmtStake, fmtDate, fmtDateShort, signClass, todayYMD,
  CURRENCIES, CURRENCY_CODES,
} from '../util.js';
import { header, icons, emptyState, toast } from '../ui.js';
import { mountChart } from '../chart.js';

let chartCleanup = null;
const state = { scope: 'all', from: '', to: '', tripId: '', view: 'YEN', compare: 'location', chart: 'money', sort: 'time' };

const SORTS = [['time', '時間'], ['profit', '収支'], ['hourly', '時給'], ['bbph', 'bb/時']];

function scopeSessions(db) {
  if (state.scope === 'period') {
    return db.sessions.filter((s) => (!state.from || s.date >= state.from) && (!state.to || s.date <= state.to));
  }
  if (state.scope === 'trip') {
    return db.sessions.filter((s) => (state.tripId === 'none' ? !s.tripId : s.tripId === state.tripId));
  }
  return db.sessions;
}

function scopeLabel(db) {
  if (state.scope === 'period') return `${state.from ? fmtDate(state.from) : '最初'} 〜 ${state.to ? fmtDate(state.to) : '最新'}`;
  if (state.scope === 'trip') {
    if (state.tripId === 'none') return '遠征なしの記録';
    const t = db.trips.find((x) => x.id === state.tripId);
    return t ? `遠征：${t.name}` : '';
  }
  return '全期間';
}

function cumLabel() {
  return state.scope === 'all' ? '全期間の累計' : state.scope === 'trip' ? '遠征内累計' : '期間内累計';
}

export function renderStats(el, { query } = {}) {
  if (chartCleanup) { chartCleanup(); chartCleanup = null; }
  const db = getDb();
  if (query && query.trip && db.trips.some((t) => t.id === query.trip)) {
    state.scope = 'trip';
    state.tripId = query.trip;
    history.replaceState(null, '', '#/stats');
  }
  if (state.scope === 'trip' && state.tripId !== 'none' && !db.trips.some((t) => t.id === state.tripId)) {
    state.tripId = db.trips.length ? [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0].id : 'none';
  }
  if (state.scope === 'period' && !state.from && !state.to) {
    const t = todayYMD();
    state.from = `${t.slice(0, 7)}-01`;
    state.to = t;
  }

  if (!db.sessions.length) {
    el.innerHTML = `${header({ title: '成績' })}<div class="page">${emptyState({
      icon: 'chart',
      title: 'まだ成績がありません',
      text: 'プレイを記録すると、累計収支・推移グラフ・時給・bb/時間・遠征損益・場所やレート別の比較がここに表示されます。',
      actions: `<a class="btn btn-primary" href="#/sessions/new">${icons.plus}<span>記録を追加</span></a>${isDemo() ? '' : `<button type="button" class="btn btn-ghost" data-act="demo">${icons.eye}<span>デモで見る</span></button>`}`,
    })}</div>`;
    el.querySelector('[data-act="demo"]')?.addEventListener('click', () => { enterDemo(); toast('デモを表示しています（実データには影響しません）'); });
    return;
  }

  const scoped = scopeSessions(db);
  const presentCurs = CURRENCY_CODES.filter((c) => db.sessions.some((s) => s.currency === c));
  if (state.view !== 'YEN' && !presentCurs.includes(state.view)) state.view = 'YEN';
  const isYen = state.view === 'YEN';
  const target = isYen ? scoped : scoped.filter((s) => s.currency === state.view);
  const sum = summarize(target);
  const mode = isYen ? 'JPY' : state.view;
  const bbChart = state.chart === 'bb';
  const series = cumulativeSeries(target, bbChart ? 'BB' : mode);
  const unit = isYen ? '円' : state.view;
  const fmtV = (v) => (isYen ? fmtYen(v) : fmtMoney(v, state.view));
  const ext = extremes(target, mode);
  const dd = maxDrawdown(target, mode);
  const total = isYen ? sum.jpy.profit : (sum.byCurrency[state.view]?.profit ?? 0);
  const hourly = isYen ? sum.jpy.hourly : sum.byCurrency[state.view]?.hourly;
  const trips = [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

  el.innerHTML = `
    ${header({ title: '成績' })}
    <div class="page">
      <section class="filters card">
        <div class="seg seg-3" role="tablist" aria-label="集計対象">
          ${[['all', '全期間'], ['period', '期間指定'], ['trip', '遠征']].map(([k, l]) => `
            <button type="button" role="tab" class="seg-btn ${state.scope === k ? 'on' : ''}" aria-selected="${state.scope === k}" data-scope="${k}">${l}</button>`).join('')}
        </div>
        ${state.scope === 'period' ? `
          <div class="date-pair">
            <label class="field field-compact"><span class="field-label">開始</span><input class="input input-compact" type="date" data-f="from" value="${esc(state.from)}"></label>
            <label class="field field-compact"><span class="field-label">終了</span><input class="input input-compact" type="date" data-f="to" value="${esc(state.to)}"></label>
          </div>
          <div class="chips">
            <button type="button" class="chip" data-preset="month">今月</button>
            <button type="button" class="chip" data-preset="30">過去30日</button>
            <button type="button" class="chip" data-preset="year">今年</button>
          </div>` : ''}
        ${state.scope === 'trip' ? `
          <label class="field field-compact">
            <span class="sr-only">遠征</span>
            <select class="input input-compact" data-f="trip">
              ${trips.map((t) => `<option value="${esc(t.id)}" ${state.tripId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              <option value="none" ${state.tripId === 'none' ? 'selected' : ''}>遠征なしの記録</option>
            </select>
          </label>` : ''}
        <label class="field field-compact field-inline">
          <span class="field-label">表示通貨</span>
          <select class="input input-compact" data-f="view">
            <option value="YEN" ${isYen ? 'selected' : ''}>円換算（全通貨）</option>
            ${presentCurs.map((c) => `<option value="${c}" ${state.view === c ? 'selected' : ''}>${c}建てのみ（${esc(CURRENCIES[c].label)}）</option>`).join('')}
          </select>
        </label>
      </section>

      ${!target.length ? emptyState({ icon: 'chart', title: 'この条件の記録はありません', text: isYen ? '集計対象を変更してください。' : `この対象に${state.view}建ての記録はありません。` }) : `
      <section class="card headline">
        <span class="eyebrow">${esc(cumLabel())}ポーカー収支${isYen ? '（円換算）' : `（${esc(state.view)}）`}</span>
        <div class="headline-amount ${signClass(total)}">${esc(fmtV(total))}</div>
        <p class="headline-sub">${esc(scopeLabel(db))}<span class="dot-sep">·</span>${sum.count}件<span class="dot-sep">·</span>${esc(fmtDuration(sum.minutes))}</p>
        ${isYen && sum.jpy.pending ? `<div class="notice notice-warn notice-inline">${icons.alert}<div><b>換算待ち${sum.jpy.pending}件（${esc(fmtDuration(sum.jpy.pendingMinutes))}）を除いた、換算済み${sum.jpy.count}件分の合計です。</b><span>円の合計・円時給・グラフは未確定です。bb/時間と現地通貨の成績は全件で計算しています。</span></div></div>` : ''}
        <p class="headline-foot">タイムレーキ（別払い）控除後。遠征経費は含みません。</p>
      </section>

      <section class="card">
        <div class="card-title-row">
          <h3 class="card-title">${bbChart ? '獲得bbの推移' : '収支の推移'}</h3>
          <div class="seg seg-2 seg-mini" role="tablist" aria-label="グラフの単位">
            <button type="button" role="tab" class="seg-btn ${!bbChart ? 'on' : ''}" aria-selected="${!bbChart}" data-chart-unit="money">${isYen ? '円' : esc(state.view)}</button>
            <button type="button" role="tab" class="seg-btn ${bbChart ? 'on' : ''}" aria-selected="${bbChart}" data-chart-unit="bb">bb</button>
          </div>
        </div>
        <p class="muted small chart-caption">${esc(cumLabel())}・開始を0として日ごとに累積${bbChart ? '。bbはレートの違いをならした単位で、' + (isYen ? '全通貨の記録（換算待ちも含む）' : `${esc(state.view)}建ての記録`) + 'をまとめています' : ''}</p>
        <div class="chart" data-chart></div>
        ${isYen && !bbChart && sum.jpy.pending ? `<p class="muted small">換算待ち${sum.jpy.pending}件はグラフに含まれていません。</p>` : ''}
      </section>

      <section class="card">
        <h3 class="card-title">主要指標</h3>
        <div class="stat-grid">
          <div class="stat stat-hl"><span class="stat-k">${isYen ? '円時給' : `時給（${esc(state.view)}）`}${isYen && sum.jpy.pending ? '<small>換算済み分</small>' : ''}</span><span class="stat-v ${signClass(hourly)}">${esc(fmtHourly(hourly, isYen ? 'JPY' : state.view))}</span></div>
          <div class="stat stat-hl"><span class="stat-k">bb/時間</span><span class="stat-v ${signClass(sum.bbPerHour)}">${esc(fmtBBph(sum.bbPerHour))}</span></div>
          <div class="stat"><span class="stat-k">獲得bb合計</span><span class="stat-v ${signClass(sum.bb)}">${esc(fmtBB(sum.bb))}</span></div>
          <div class="stat"><span class="stat-k">実プレイ時間</span><span class="stat-v">${esc(fmtDuration(sum.minutes))}</span></div>
          <div class="stat"><span class="stat-k">セッション数</span><span class="stat-v">${sum.count}件</span></div>
          <div class="stat"><span class="stat-k">勝ち / 負け</span><span class="stat-v">${sum.wins}勝 ${sum.losses}敗${sum.count - sum.wins - sum.losses ? ` ${sum.count - sum.wins - sum.losses}分` : ''}</span></div>
        </div>
        <p class="muted small">時給・bb/時間は、各セッションの値の平均ではなく「合計 ÷ 合計時間」で計算しています。</p>
      </section>

      <section class="card">
        <h3 class="card-title">記録の振れ幅${isYen && sum.jpy.pending ? ' <small class="muted">換算待ちを除く</small>' : ''}</h3>
        <div class="stat-grid">
          ${extremeStat('最大の勝ち', ext.best, fmtV)}
          ${extremeStat('最大の負け', ext.worst, fmtV)}
          <div class="stat stat-wide2"><span class="stat-k">最大ドローダウン</span><span class="stat-v ${dd ? 'neg' : 'zero'}">${dd ? esc(fmtV(-dd.amount)) : '下げなし'}</span>${dd ? `<span class="stat-sub">${dd.fromDate ? `${esc(fmtDateShort(dd.fromDate))}の山` : '期間の開始'}から ${esc(fmtDateShort(dd.toDate))} まで</span>` : ''}</div>
          <div class="stat"><span class="stat-k">平均プレイ時間</span><span class="stat-v">${esc(fmtDuration(sum.minutes / sum.count))}</span><span class="stat-sub">1セッションあたり</span></div>
        </div>
        <p class="muted small">最大ドローダウンは、累計収支がそれまでの最高値からどれだけ下がったかの最大値です（セッション単位）。</p>
      </section>

      ${isYen && Object.keys(sum.byCurrency).length ? `
        <section class="card">
          <h3 class="card-title">現地通貨の成績</h3>
          <div class="cmp-list">
            ${Object.values(sum.byCurrency).map((c) => `
              <div class="cmp-row">
                <div class="cmp-main"><span class="cmp-name">${esc(c.currency)}<small>${esc(CURRENCIES[c.currency].label)}</small></span><span class="cmp-amt ${signClass(c.profit)}">${esc(fmtMoney(c.profit, c.currency))}</span></div>
                <div class="cmp-meta">${c.count}件<span class="dot-sep">·</span>${esc(fmtDuration(c.minutes))}<span class="dot-sep">·</span>${esc(fmtHourly(c.hourly, c.currency))}<span class="dot-sep">·</span>${esc(fmtBBph(c.bbPerHour))}</div>
              </div>`).join('')}
          </div>
        </section>` : ''}

      ${tripSection(db, target, isYen)}

      <section class="card">
        <h3 class="card-title">比較</h3>
        <div class="seg seg-3" role="tablist" aria-label="比較の切り替え">
          ${[['location', '場所別'], ['stake', 'レート別'], ['trip', '遠征別']].map(([k, l]) => `
            <button type="button" role="tab" class="seg-btn ${state.compare === k ? 'on' : ''}" aria-selected="${state.compare === k}" data-compare="${k}">${l}</button>`).join('')}
        </div>
        <div class="sort-row" role="group" aria-label="並び順">
          <span class="muted small">並び順</span>
          ${SORTS.map(([k, l]) => `<button type="button" class="chip ${state.sort === k ? 'chip-on' : ''}" aria-pressed="${state.sort === k}" data-sort="${k}">${l}</button>`).join('')}
        </div>
        ${compareList(db, target, isYen)}
      </section>
      `}
    </div>`;

  const chartEl = el.querySelector('[data-chart]');
  if (chartEl) chartCleanup = mountChart(chartEl, series, bbChart ? { unit: 'bb', format: fmtBB, cumLabel: cumLabel() } : { unit, format: fmtV, cumLabel: cumLabel() });

  const rerender = () => renderStats(el);
  el.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { state.scope = b.dataset.scope; rerender(); }));
  el.querySelectorAll('[data-chart-unit]').forEach((b) => b.addEventListener('click', () => { state.chart = b.dataset.chartUnit; rerender(); }));
  el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { state.sort = b.dataset.sort; rerender(); }));
  el.querySelectorAll('[data-compare]').forEach((b) => b.addEventListener('click', () => { state.compare = b.dataset.compare; rerender(); }));
  el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('change', () => {
    const f = i.dataset.f;
    if (f === 'from') state.from = i.value;
    if (f === 'to') state.to = i.value;
    if (f === 'trip') state.tripId = i.value;
    if (f === 'view') state.view = i.value;
    rerender();
  }));
  el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const t = todayYMD();
    const p = b.dataset.preset;
    state.to = t;
    if (p === 'month') state.from = `${t.slice(0, 7)}-01`;
    if (p === 'year') state.from = `${t.slice(0, 4)}-01-01`;
    if (p === '30') { const d = new Date(); d.setDate(d.getDate() - 29); state.from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    rerender();
  }));
  return () => { if (chartCleanup) { chartCleanup(); chartCleanup = null; } };
}

function tripSection(db, target, isYen) {
  if (state.scope === 'period') {
    return `<section class="card"><h3 class="card-title">遠征全体の損益</h3><p class="muted small">期間指定では、日別の明細がない遠征経費を特定の日に割り当てないため表示していません。「全期間」または「遠征」で確認できます。</p></section>`;
  }
  if (!isYen) {
    return `<section class="card"><h3 class="card-title">遠征全体の損益</h3><p class="muted small">遠征損益は円で計算します。表示通貨を「円換算（全通貨）」にすると表示されます。</p></section>`;
  }
  let trips;
  if (state.scope === 'trip') trips = db.trips.filter((t) => t.id === state.tripId);
  else trips = [...db.trips].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  if (!trips.length) {
    return state.scope === 'trip' ? '' : `<section class="card"><h3 class="card-title">遠征全体の損益</h3><p class="muted small">遠征を作成すると、経費を引いた遠征全体の損益がここに表示されます。</p></section>`;
  }
  const results = trips.map((t) => ({ t, r: tripResult(t, target) }));
  const totalNet = results.reduce((a, x) => a + x.r.net, 0);
  const anyProv = results.some((x) => x.r.provisional);
  return `
    <section class="card">
      <h3 class="card-title">遠征全体の損益 <small class="muted">経費控除後・円</small></h3>
      <div class="cmp-list">
        ${results.map(({ t, r }) => `
          <a class="cmp-row cmp-link" href="#/trips/${esc(t.id)}">
            <div class="cmp-main"><span class="cmp-name">${esc(t.name)}${r.provisional ? '<span class="badge badge-warn">暫定</span>' : ''}</span><span class="cmp-amt ${signClass(r.net)}">${esc(fmtYen(r.net))}</span></div>
            <div class="cmp-meta">ポーカー ${esc(fmtYen(r.summary.jpy.profit))}<span class="dot-sep">·</span>経費 ${r.expenses == null ? '未入力' : esc(fmtYen(-r.expenses))}${r.reasons.length ? `<span class="dot-sep">·</span>${esc(r.reasons.join('・'))}` : ''}</div>
          </a>`).join('')}
      </div>
      ${results.length > 1 ? `<div class="kv kv-total"><span class="k">遠征損益の合計${anyProv ? '<span class="badge badge-warn">暫定</span>' : ''}</span><span class="v num ${signClass(totalNet)}">${esc(fmtYen(totalNet))}</span></div>
      <a class="link small block-link" href="#/trips/compare">遠征を並べて比較する</a>` : ''}
    </section>`;
}

function compareList(db, target, isYen) {
  let groups;
  if (state.compare === 'location') {
    groups = groupSummaries(target, locationKey, (s) => s.location.trim());
  } else if (state.compare === 'stake') {
    groups = groupSummaries(target, stakeKey, (s) => fmtStake(s.currency, s.sb, s.bb));
    groups.forEach((g) => { g.currency = g.sessions[0].currency; });
  } else {
    groups = groupSummaries(target, (s) => s.tripId || 'none', (s) => {
      const t = s.tripId && db.trips.find((x) => x.id === s.tripId);
      return t ? t.name : '遠征なし';
    });
  }
  if (!groups.length) return '<p class="muted small">記録がありません。</p>';
  const val = (g) => (isYen ? g.summary.jpy.profit : (g.summary.byCurrency[state.view]?.profit ?? 0));
  const hourlyOf = (g) => (isYen ? g.summary.jpy.hourly : g.summary.byCurrency[state.view]?.hourly);
  const key = {
    time: (g) => g.summary.minutes,
    profit: val,
    hourly: hourlyOf,
    bbph: (g) => g.summary.bbPerHour,
  }[state.sort] || ((g) => g.summary.minutes);
  // 値がないもの（換算待ちのみ等）は最後に
  groups.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x == null && y == null) return b.summary.minutes - a.summary.minutes;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || b.summary.minutes - a.summary.minutes;
  });
  const maxAbs = Math.max(1, ...groups.map((g) => Math.abs(val(g))));
  return `
    <div class="cmp-list">
      ${groups.map((g) => {
        const s = g.summary;
        const v = val(g);
        const hr = hourlyOf(g);
        const local = state.compare === 'stake' && isYen && g.currency !== 'JPY' ? s.byCurrency[g.currency] : null;
        const w = Math.round((Math.abs(v) / maxAbs) * 100);
        return `
          <div class="cmp-row">
            <div class="cmp-main">
              <span class="cmp-name">${esc(g.label)}</span>
              <span class="cmp-amt ${signClass(v)}">${esc(isYen ? fmtYen(v) : fmtMoney(v, state.view))}</span>
            </div>
            <div class="cmp-bar"><span class="${signClass(v)}" style="width:${w}%"></span></div>
            <div class="cmp-meta">
              ${s.count}件<span class="dot-sep">·</span>${esc(fmtDuration(s.minutes))}<span class="dot-sep">·</span>${esc(fmtHourly(hr, isYen ? 'JPY' : state.view))}<span class="dot-sep">·</span>${esc(fmtBBph(s.bbPerHour))}
              ${local ? `<span class="dot-sep">·</span>${esc(fmtMoney(local.profit, g.currency))}` : ''}
              ${isYen && s.jpy.pending ? `<span class="badge badge-warn">換算待ち${s.jpy.pending}件を除く</span>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
    <p class="muted small">${state.compare === 'stake' ? '同じブラインド額でも通貨が違えば別のレートとして集計します。' : ''}${{ time: '実プレイ時間の長い順', profit: '収支の多い順', hourly: '時給の高い順', bbph: 'bb/時間の高い順' }[state.sort]}に表示しています。</p>`;
}


function extremeStat(label, x, fmtV) {
  if (!x) return `<div class="stat"><span class="stat-k">${label}</span><span class="stat-v zero">該当なし</span></div>`;
  return `
    <div class="stat">
      <span class="stat-k">${label}</span>
      <span class="stat-v ${signClass(x.value)}">${esc(fmtV(x.value))}</span>
      <a class="stat-sub" href="#/sessions/${esc(x.session.id)}">${esc(fmtDateShort(x.session.date))} ${esc(x.session.location)}</a>
    </div>`;
}
