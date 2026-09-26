// 累積収支の推移グラフ（外部ライブラリなしのSVG。オフラインでも表示できる）
import { esc, fmtDate, fmtDateShort, signClass } from './util.js';

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

function compact(v, unit) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  let body;
  if (unit === '円') {
    if (a >= 1e8) body = +(a / 1e8).toFixed(1) + '億';
    else if (a >= 1e4) body = +(a / 1e4).toFixed(a >= 1e5 ? 0 : 1) + '万';
    else body = Math.round(a).toLocaleString('ja-JP');
  } else if (a >= 1e6) body = +(a / 1e6).toFixed(1) + 'M';
  else if (a >= 1e4) body = +(a / 1e3).toFixed(0) + 'k';
  else body = +a.toFixed(2) + '';
  return sign + body;
}

/**
 * series: [{date, day, count, cum}]（期間内の日付順、cum は期間開始からの累計）
 * opts: { unit: '円' | 'USD' ..., format: (v)=>string }
 */
export function mountChart(container, series, { unit, format, cumLabel = '期間内累計' }) {
  const pts = [{ date: null, day: 0, cum: 0, count: 0 }, ...series];
  let sel = pts.length - 1;
  container.innerHTML = `
    <div class="chart-readout" aria-live="polite"></div>
    <div class="chart-box"><svg class="chart-svg" role="img" tabindex="0" aria-label="期間内累計収支の推移グラフ。左右キーで日付を移動できます"></svg></div>`;
  const readout = container.querySelector('.chart-readout');
  const box = container.querySelector('.chart-box');
  const svg = container.querySelector('svg');
  let geom = null;

  function updateReadout() {
    const pt = pts[sel];
    if (!pt.date) {
      readout.innerHTML = `<span class="ro-date">期間の開始</span><span class="ro-cum zero">${esc(cumLabel)} ${esc(format(0))}</span>`;
      return;
    }
    readout.innerHTML = `
      <span class="ro-date">${esc(fmtDate(pt.date))}${pt.count > 1 ? ` <small>${pt.count}件</small>` : ''}</span>
      <span class="ro-day ${signClass(pt.day)}">当日 ${esc(format(pt.day))}</span>
      <span class="ro-cum ${signClass(pt.cum)}">${esc(cumLabel)} ${esc(format(pt.cum))}</span>`;
  }

  function draw() {
    const W = Math.max(260, Math.round(box.clientWidth || 320));
    const H = 196;
    const padT = 14, padB = 26, padR = 14;
    let min = Math.min(0, ...pts.map((d) => d.cum));
    let max = Math.max(0, ...pts.map((d) => d.cum));
    if (min === max) { max = max + 1; min = min - 1; }
    const step = niceStep(max - min, 4);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    const labels = ticks.map((t) => compact(t, unit));
    const padL = Math.max(34, Math.max(...labels.map((l) => l.length)) * 7 + 12);
    const iw = W - padL - padR;
    const ih = H - padT - padB;
    const x = (i) => padL + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ih;
    const y0 = y(0);
    geom = { x, W, padL, iw };

    const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.cum).toFixed(1)}`).join('');
    const area = `${line}L${x(pts.length - 1).toFixed(1)},${y0.toFixed(1)}L${x(0).toFixed(1)},${y0.toFixed(1)}Z`;
    const grid = ticks.map((t, i) => `
      <line class="${t === 0 ? 'axis-zero' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>
      <text class="tick" x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${esc(labels[i])}</text>`).join('');
    const showDots = pts.length <= 45;
    const dots = showDots ? pts.slice(1).map((d, i) => `<circle class="dot ${signClass(d.day)}" cx="${x(i + 1).toFixed(1)}" cy="${y(d.cum).toFixed(1)}" r="3"/>`).join('') : '';
    const first = pts[1];
    const last = pts[pts.length - 1];
    const xl = [];
    if (first) xl.push(`<text class="tick" x="${x(1).toFixed(1)}" y="${H - 6}" text-anchor="${pts.length > 2 ? 'start' : 'middle'}">${esc(fmtDateShort(first.date))}</text>`);
    if (last && last !== first) xl.push(`<text class="tick" x="${x(pts.length - 1).toFixed(1)}" y="${H - 6}" text-anchor="end">${esc(fmtDateShort(last.date))}</text>`);
    const uid = Math.random().toString(36).slice(2, 7);

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.innerHTML = `
      <defs>
        <clipPath id="up-${uid}"><rect x="0" y="0" width="${W}" height="${y0.toFixed(1)}"/></clipPath>
        <clipPath id="dn-${uid}"><rect x="0" y="${y0.toFixed(1)}" width="${W}" height="${(H - y0).toFixed(1)}"/></clipPath>
      </defs>
      ${grid}
      <path class="area-pos" d="${area}" clip-path="url(#up-${uid})"/>
      <path class="area-neg" d="${area}" clip-path="url(#dn-${uid})"/>
      <path class="line" d="${line}"/>
      ${dots}
      ${xl.join('')}
      <g class="cursor">
        <line class="cursor-line" y1="${padT}" y2="${padT + ih}"/>
        <circle class="cursor-dot" r="5.5"/>
      </g>`;
    geom.y = y;
    placeCursor();
  }

  function placeCursor() {
    if (!geom) return;
    const g = svg.querySelector('.cursor');
    const cx = geom.x(sel);
    const cy = geom.y(pts[sel].cum);
    g.querySelector('.cursor-line').setAttribute('x1', cx);
    g.querySelector('.cursor-line').setAttribute('x2', cx);
    const dot = g.querySelector('.cursor-dot');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('class', `cursor-dot ${signClass(pts[sel].cum)}`);
    updateReadout();
  }

  function pick(clientX) {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * geom.W;
    const t = pts.length === 1 ? 0 : (px - geom.padL) / geom.iw;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(t * (pts.length - 1))));
    if (i !== sel) { sel = i; placeCursor(); }
  }

  let dragging = false;
  svg.addEventListener('pointerdown', (e) => { dragging = true; pick(e.clientX); });
  svg.addEventListener('pointermove', (e) => { if (dragging || e.pointerType === 'mouse') pick(e.clientX); });
  const onUp = () => { dragging = false; };
  window.addEventListener('pointerup', onUp, { passive: true });
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { sel = Math.max(0, sel - 1); placeCursor(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { sel = Math.min(pts.length - 1, sel + 1); placeCursor(); e.preventDefault(); }
  });

  draw();
  let lastW = box.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(box.clientWidth - lastW) > 2) { lastW = box.clientWidth; draw(); }
  });
  ro.observe(box);
  return () => { ro.disconnect(); window.removeEventListener('pointerup', onUp); };
}
