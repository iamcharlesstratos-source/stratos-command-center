// ui.js — shared UI primitives reused by every module.
// Pure DOM helpers (no store import) so there are no module cycles.

import { escapeHtml } from './util.js';

// ---------------------------------------------------------------------------
// el() — terse hyperscript-style DOM builder
//   el('div', { class:'card', onClick, dataset:{id}, html:'<b>x</b>' }, child1, child2)
// props keys: class/className, text, html, onClick (or on:{event}), attrs, dataset,
// style (object), value, checked, disabled, type, placeholder, href, etc.
// ---------------------------------------------------------------------------
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'attrs') for (const [ak, av] of Object.entries(v)) node.setAttribute(ak, av);
    else if (k === 'on' && typeof v === 'object') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'onClick') node.addEventListener('click', v);
    else if (k === 'onInput') node.addEventListener('input', v);
    else if (k === 'onChange') node.addEventListener('change', v);
    else if (k === 'onSubmit') node.addEventListener('submit', v);
    else if (k in node) {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Remove all children of a node. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---------------------------------------------------------------------------
// Status pills — semantic colour mapping shared across modules
// ---------------------------------------------------------------------------
const STATUS_TONE = {
  // product
  Pending: 'warn', Ready: 'good', Failed: 'bad', Scaling: 'good',
  // creative workflow
  'To Do': 'neutral', 'In Progress': 'warn', 'For Review': 'warn',
  Approved: 'good', Launched: 'good', Winner: 'good', Loser: 'bad',
  // daily label
  Scale: 'good', Observe: 'warn', Kill: 'bad',
  // page
  Active: 'good', Testing: 'warn', 'Low Stock': 'warn', Disabled: 'bad',
  // competitor
  'Not Started': 'neutral', Copied: 'warn', Improved: 'good',
  // approval
  pending: 'warn', approved: 'good', rejected: 'bad',
  // profit (margin-aware)
  Profitable: 'good', Breakeven: 'warn', Bleeding: 'bad',
};

export function toneFor(status) {
  return STATUS_TONE[status] || 'neutral';
}

/** A coloured status pill. */
export function pill(status, { tone } = {}) {
  const t = tone || toneFor(status);
  return el('span', { class: `pill pill--${t}`, text: status ?? '—' });
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export function button(label, { variant = 'ghost', onClick, type = 'button', icon, disabled, title, full } = {}) {
  const b = el('button', {
    class: `btn btn--${variant}${full ? ' btn--full' : ''}`,
    type, disabled, title: title || null,
    onClick: onClick || null,
  });
  if (icon) b.appendChild(el('span', { class: 'btn__icon', html: icon }));
  b.appendChild(el('span', { text: label }));
  return b;
}

// ---------------------------------------------------------------------------
// Form field helpers
// ---------------------------------------------------------------------------
export function field(label, control, { hint, full } = {}) {
  const wrap = el('label', { class: `field${full ? ' field--full' : ''}` });
  if (label) wrap.appendChild(el('span', { class: 'field__label', text: label }));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el('span', { class: 'field__hint', text: hint }));
  return wrap;
}

export function input(props = {}) {
  return el('input', { class: 'input', type: 'text', ...props });
}
export function textarea(props = {}) {
  return el('textarea', { class: 'input textarea', rows: 3, ...props });
}
export function select(options, { value, onChange, ...rest } = {}) {
  const sel = el('select', { class: 'input select', onChange: onChange || null, ...rest });
  for (const opt of options) {
    const o = typeof opt === 'object' ? opt : { value: opt, label: opt };
    const optionEl = el('option', { value: o.value, text: o.label });
    if (o.value === value) optionEl.selected = true;
    sel.appendChild(optionEl);
  }
  if (value !== undefined) sel.value = value;
  return sel;
}

/** A labelled 1–5 slider that reports its value live. */
export function slider({ value = 3, min = 1, max = 5, step = 1, onInput } = {}) {
  const wrap = el('div', { class: 'slider' });
  const range = el('input', { class: 'slider__range', type: 'range', min, max, step, value });
  const out = el('span', { class: 'slider__val', text: String(value) });
  range.addEventListener('input', () => {
    out.textContent = range.value;
    if (onInput) onInput(Number(range.value));
  });
  wrap.appendChild(range);
  wrap.appendChild(out);
  return wrap;
}

// ---------------------------------------------------------------------------
// Sortable table
//   columns: [{ key, label, align, sortable=true, render(row)->Node|string,
//               sortValue(row)->comparable }]
//   opts: { sort:{key,dir}, empty:'message', rowClass(row), onRowClick(row) }
// ---------------------------------------------------------------------------
export function sortableTable(columns, rows, opts = {}) {
  const state = { key: opts.sort?.key || null, dir: opts.sort?.dir || 'asc' };
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', { class: 'data-table' });
  const thead = el('thead');
  const headRow = el('tr');

  columns.forEach((col) => {
    const sortable = col.sortable !== false && !!(col.sortValue || col.key);
    const th = el('th', {
      class: `${col.align ? 'align-' + col.align : ''}${sortable ? ' th--sortable' : ''}`,
    });
    th.appendChild(el('span', { text: col.label }));
    if (sortable) {
      const caret = el('span', { class: 'th__caret', text: '' });
      th.appendChild(caret);
      th.addEventListener('click', () => {
        if (state.key === col.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.key = col.key; state.dir = 'asc'; }
        renderBody();
        updateCarets();
      });
    }
    th._col = col;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  table.appendChild(tbody);

  function valueFor(col, row) {
    if (col.sortValue) return col.sortValue(row);
    return row[col.key];
  }

  function renderBody() {
    clear(tbody);
    let data = [...rows];
    if (state.key) {
      const col = columns.find((c) => c.key === state.key);
      if (col) {
        data.sort((a, b) => {
          const va = valueFor(col, a); const vb = valueFor(col, b);
          let cmp;
          if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
          else cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
          return state.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    if (!data.length) {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'table-empty', attrs: { colspan: String(columns.length) }, text: opts.empty || 'No data yet.' }));
      tbody.appendChild(tr);
      return;
    }
    data.forEach((row) => {
      const tr = el('tr', { class: opts.rowClass ? opts.rowClass(row) : '' });
      if (opts.onRowClick) {
        tr.classList.add('row--click');
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select, .no-rowclick')) return;
          opts.onRowClick(row);
        });
      }
      columns.forEach((col) => {
        const td = el('td', { class: col.align ? 'align-' + col.align : '' });
        const content = col.render ? col.render(row) : row[col.key];
        if (content instanceof Node) td.appendChild(content);
        else td.textContent = content ?? '—';
        if (col.cellBg) { const bg = col.cellBg(row); if (bg) td.style.background = bg; }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function updateCarets() {
    headRow.querySelectorAll('th').forEach((th) => {
      const caret = th.querySelector('.th__caret');
      if (!caret) return;
      caret.textContent = th._col.key === state.key ? (state.dir === 'asc' ? '▲' : '▼') : '';
    });
  }

  renderBody();
  updateCarets();
  wrap.appendChild(table);
  wrap.refresh = (newRows) => { if (newRows) { rows = newRows; } renderBody(); };
  return wrap;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function openModal({ title, body, actions = [], width = 560, onClose } = {}) {
  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: 'modal', style: { maxWidth: width + 'px' } });

  const header = el('div', { class: 'modal__head' },
    el('h3', { class: 'modal__title', text: title || '' }),
    el('button', { class: 'modal__close', text: '✕', title: 'Close', onClick: () => close() }),
  );
  const content = el('div', { class: 'modal__body' });
  if (typeof body === 'string') content.innerHTML = body;
  else if (body instanceof Node) content.appendChild(body);

  const footer = el('div', { class: 'modal__foot' });
  actions.forEach((a) => {
    footer.appendChild(button(a.label, {
      variant: a.variant || 'ghost',
      onClick: () => a.onClick && a.onClick(close),
    }));
  });

  modal.appendChild(header);
  modal.appendChild(content);
  if (actions.length) modal.appendChild(footer);
  overlay.appendChild(modal);

  function close() {
    overlay.classList.add('modal-overlay--closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 120);
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  return { close, overlay, content };
}

/** Promise-based confirm dialog. Resolves true/false. */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      width: 460,
      body: el('p', { class: 'modal__msg', text: message }),
      actions: [
        { label: cancelText, variant: 'ghost', onClick: (close) => { close(); resolve(false); } },
        { label: confirmText, variant: danger ? 'danger' : 'primary', onClick: (close) => { close(); resolve(true); } },
      ],
      onClose: () => resolve(false),
    });
    return m;
  });
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
let toastHost = null;
export function toast(message, type = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: `toast toast--${type}`, text: message });
  toastHost.appendChild(t);
  // force reflow then animate in
  requestAnimationFrame(() => t.classList.add('toast--in'));
  setTimeout(() => {
    t.classList.remove('toast--in');
    setTimeout(() => t.remove(), 200);
  }, ms);
}

// ---------------------------------------------------------------------------
// Layout helpers used by module views
// ---------------------------------------------------------------------------
export function pageHeader(title, subtitle, actions = []) {
  const head = el('div', { class: 'page-head' });
  const left = el('div', {}, el('h2', { class: 'page-title', text: title }));
  if (subtitle) left.appendChild(el('p', { class: 'page-sub', text: subtitle }));
  head.appendChild(left);
  if (actions.length) {
    const right = el('div', { class: 'page-head__actions' });
    actions.forEach((a) => right.appendChild(a));
    head.appendChild(right);
  }
  return head;
}

export function card(title, ...children) {
  const c = el('section', { class: 'card' });
  if (title) c.appendChild(el('h3', { class: 'card__title', text: title }));
  appendChildren(c, children);
  return c;
}

export function emptyState(message, actionNode) {
  const e = el('div', { class: 'empty-state' });
  e.appendChild(orbitalMark(40, { opacity: 0.85 }));
  e.appendChild(el('p', { text: message, style: { marginTop: '12px' } }));
  if (actionNode) e.appendChild(actionNode);
  return e;
}

/** The STRATOS orbital-S brand mark as an inline SVG element (the identity motif). */
export function orbitalMark(size = 48, { opacity = 1, spin = false } = {}) {
  const span = el('span', { class: 'orbital-mark' + (spin ? ' orbital-mark--spin' : ''), style: { display: 'inline-flex', width: size + 'px', height: size + 'px', opacity } });
  span.innerHTML = `<svg viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs><linearGradient id="om-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#4F7BFF"/><stop offset="0.5" stop-color="#8B5CF6"/><stop offset="1" stop-color="#EC4899"/></linearGradient></defs>
    <g class="orbital-mark__rings">
      <ellipse cx="24" cy="24" rx="21" ry="9" stroke="url(#om-grad)" stroke-width="1.5" opacity="0.55" transform="rotate(-28 24 24)"/>
      <ellipse cx="24" cy="24" rx="21" ry="9" stroke="url(#om-grad)" stroke-width="1.5" opacity="0.35" transform="rotate(38 24 24)"/>
    </g>
    <path d="M31 16.5c-1.8-1.7-4.4-2.7-7-2.7-3.9 0-6.8 2.1-6.8 5.2 0 3 2.4 4.3 6.6 5.1 4.4.8 7.4 2.2 7.4 5.6 0 3.4-3.2 5.7-7.6 5.7-3 0-5.8-1.1-7.6-3" stroke="url(#om-grad)" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    <circle cx="24" cy="24" r="2.4" fill="#EC4899"/>
  </svg>`;
  return span;
}

/** The product logo: a hub-and-spoke mark. Colors come from theme vars (bm-* classes). */
export function brandMark(size = 40) {
  const nodes = [[24, 8], [37.86, 16], [37.86, 32], [24, 40], [10.14, 32], [10.14, 16]];
  const spokes = nodes.map(([x, y]) => `<line x1="24" y1="24" x2="${x}" y2="${y}"/>`).join('');
  const dots = nodes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.6"/>`).join('');
  const span = el('span', { class: 'brand-mark', style: { width: size + 'px', height: size + 'px' } });
  span.innerHTML = `<svg viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g class="bm-stroke" stroke-width="2.4" stroke-linecap="round">${spokes}</g>
    <g class="bm-fill bm-stroke" stroke-width="2.2">${dots}</g>
    <circle cx="24" cy="24" r="6.6" class="bm-center" stroke-width="2.4"/>
    <circle cx="24" cy="24" r="3.4" class="bm-fill"/>
  </svg>`;
  return span;
}

/** Shimmer skeleton placeholder (reduced-motion handled in CSS). */
export function skeleton(lines = 3) {
  const w = el('div', { class: 'stack', style: { gap: '10px' } });
  for (let i = 0; i < lines; i++) w.appendChild(el('div', { class: 'skeleton', style: { height: '14px', width: (95 - i * 12) + '%' } }));
  return w;
}

/** Animate a number from 0 → `to` into a node. Respects reduced-motion. */
export function countUp(node, to, { duration = 650, fmt = (v) => Math.round(v).toLocaleString('en-PH'), prefix = '', suffix = '' } = {}) {
  if (!node) return;
  const finalText = prefix + fmt(to) + suffix;
  // Skip the animation (just show the value) when reduced-motion, the value isn't
  // finite, or the tab is hidden (rAF is paused for background tabs).
  if (!Number.isFinite(to) || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = finalText; return; }
  let done = false;
  const finish = () => { if (done) return; done = true; node.textContent = finalText; };
  const start = performance.now();
  (function tick(now) {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    node.textContent = prefix + fmt(to * (1 - Math.pow(1 - t, 3))) + suffix;
    if (t < 1) requestAnimationFrame(tick); else finish();
  })(start);
  // Safety: even if rAF stalls (background tab), guarantee the final value.
  setTimeout(finish, duration + 120);
}

/** Small stat tile (label + big value + optional sub). */
export function statTile(label, value, { sub, tone } = {}) {
  return el('div', { class: `stat-tile${tone ? ' stat-tile--' + tone : ''}` },
    el('div', { class: 'stat-tile__value', text: value }),
    el('div', { class: 'stat-tile__label', text: label }),
    sub ? el('div', { class: 'stat-tile__sub', text: sub }) : null,
  );
}

/**
 * Tiny inline SVG sparkline from a list of numbers (nulls are skipped/ignored).
 * opts: { width, height, color, fill }. Returns an <svg> element.
 */
export function sparkline(values, { width = 84, height = 24, color = '#8B5CF6', fill = true } = {}) {
  const nums = values.map((v) => (Number.isFinite(v) ? v : null));
  const present = nums.filter((v) => v !== null);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.display = 'block';
  if (present.length < 2) {
    // not enough points — show a flat baseline
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', 0); line.setAttribute('y1', height - 2); line.setAttribute('x2', width); line.setAttribute('y2', height - 2);
    line.setAttribute('stroke', 'var(--border)'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    return svg;
  }
  const min = Math.min(...present), max = Math.max(...present);
  const range = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (nums.length - 1);
  const pts = nums.map((v, i) => {
    const x = pad + i * stepX;
    const y = v === null ? null : (height - pad) - ((v - min) / range) * (height - pad * 2);
    return { x, y };
  }).filter((p) => p.y !== null);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  if (fill) {
    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', `${d} L${pts[pts.length - 1].x.toFixed(1)},${height} L${pts[0].x.toFixed(1)},${height} Z`);
    area.setAttribute('fill', color); area.setAttribute('opacity', '0.12');
    svg.appendChild(area);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  // last-point dot
  const last = pts[pts.length - 1];
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', last.x.toFixed(1)); dot.setAttribute('cy', last.y.toFixed(1)); dot.setAttribute('r', '2'); dot.setAttribute('fill', color);
  svg.appendChild(dot);
  return svg;
}

// ---------------------------------------------------------------------------
// Popover menu (anchored dropdown) — used to condense the toolbar
// ---------------------------------------------------------------------------
export function popoverMenu(anchor, items) {
  const r = anchor.getBoundingClientRect();
  const menu = el('div', { class: 'popover-menu', style: { position: 'fixed', top: (r.bottom + 6) + 'px', right: Math.max(8, window.innerWidth - r.right) + 'px' } });
  const close = () => { menu.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onOut, true); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onOut = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  items.forEach((it) => {
    if (it.divider) { menu.appendChild(el('div', { class: 'popover-menu__divider' })); return; }
    const row = el('button', { type: 'button', class: 'popover-menu__item' },
      el('span', { text: it.label }),
      it.hint ? el('span', { class: 'popover-menu__hint', text: it.hint }) : null);
    row.addEventListener('click', () => { close(); if (it.onClick) it.onClick(); });
    menu.appendChild(row);
  });
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', onOut, true), 0);
  document.body.appendChild(menu);
  return { close };
}

// ---------------------------------------------------------------------------
// Charts (pure SVG, no dependency)
// ---------------------------------------------------------------------------
function svgEl(tag, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * Multi-series line chart. datasets: [{ name, color, values:[number|null] }].
 * opts: { width, height, labels:[xLabels], fmt:(v)=>string }. Returns a wrapper node.
 */
export function lineChart(datasets, { width = 560, height = 170, labels = [], fmt = (v) => v } = {}) {
  const pad = 26;
  const all = datasets.flatMap((d) => d.values).filter((v) => Number.isFinite(v));
  const min = Math.min(0, ...(all.length ? all : [0]));
  const max = Math.max(1, ...(all.length ? all : [1]));
  const range = max - min || 1;
  const n = Math.max(1, ...datasets.map((d) => d.values.length));
  const innerW = width - pad * 2, innerH = height - pad * 2;
  const X = (i) => pad + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const Y = (v) => pad + innerH - ((v - min) / range) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height });
  svg.style.display = 'block'; svg.style.maxWidth = '100%';
  for (let g = 0; g <= 3; g++) {
    const gy = pad + (g / 3) * innerH;
    svg.appendChild(svgEl('line', { x1: pad, y1: gy, x2: width - pad, y2: gy, stroke: 'var(--border)', 'stroke-width': 1, opacity: 0.45 }));
    svg.appendChild(svgEl('text', { x: 4, y: gy + 3, fill: 'var(--text-dim)', 'font-size': 9 })).textContent = fmt(max - (g / 3) * range);
  }
  datasets.forEach((d) => {
    const pts = d.values.map((v, i) => (Number.isFinite(v) ? { x: X(i), y: Y(v) } : null)).filter(Boolean);
    if (!pts.length) return;
    const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    svg.appendChild(svgEl('path', { d: dPath, fill: 'none', stroke: d.color || 'var(--accent)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = pts[pts.length - 1];
    svg.appendChild(svgEl('circle', { cx: last.x, cy: last.y, r: 3, fill: d.color || 'var(--accent)' }));
  });
  // x-axis end labels
  if (labels.length) {
    const lbl = (i, anchor, x) => { const t = svgEl('text', { x, y: height - 6, fill: 'var(--text-dim)', 'font-size': 9, 'text-anchor': anchor }); t.textContent = labels[i]; svg.appendChild(t); };
    lbl(0, 'start', pad); lbl(labels.length - 1, 'end', width - pad);
  }
  const wrap = el('div', { class: 'chart-rise' });
  if (datasets.some((d) => d.name)) {
    const legend = el('div', { class: 'row', style: { gap: '14px', marginBottom: '6px', flexWrap: 'wrap' } });
    datasets.forEach((d) => legend.appendChild(el('span', { class: 'muted', style: { fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px' } },
      el('span', { style: { width: '10px', height: '10px', borderRadius: '2px', background: d.color || 'var(--accent)', display: 'inline-block' } }), d.name)));
    wrap.appendChild(legend);
  }
  wrap.appendChild(svg);
  return wrap;
}

/** Horizontal bar chart. items: [{ label, value, color, sub }]. Diverges around 0. */
export function barChart(items, { fmt = (v) => v } = {}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(Number(i.value) || 0)));
  const wrap = el('div', { class: 'stack', style: { gap: '8px' } });
  items.forEach((it) => {
    const v = Number(it.value) || 0;
    const pct = Math.round((Math.abs(v) / max) * 100);
    const row = el('div', { style: { display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: '8px', alignItems: 'center' } },
      el('span', { class: 'mono', style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: it.label }),
      el('div', { style: { height: '14px', background: 'var(--surface-2)', borderRadius: '7px', overflow: 'hidden' } },
        el('div', { style: { height: '100%', width: pct + '%', background: it.color || (v < 0 ? 'var(--bad)' : 'var(--good)'), borderRadius: '7px' } })),
      el('span', { class: 'mono', style: { fontSize: '12px', color: v < 0 ? 'var(--bad)' : 'var(--text)' }, text: fmt(v) }),
    );
    wrap.appendChild(row);
  });
  return wrap;
}

export { escapeHtml };
