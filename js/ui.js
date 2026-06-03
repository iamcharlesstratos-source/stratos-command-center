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
  const e = el('div', { class: 'empty-state' }, el('p', { text: message }));
  if (actionNode) e.appendChild(actionNode);
  return e;
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

export { escapeHtml };
