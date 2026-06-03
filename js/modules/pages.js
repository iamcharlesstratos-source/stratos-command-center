// pages.js — Module 4: Page Status Manager.
//
// Tracks performance per Facebook Page. Product codes are auto-detected from
// page names against the known-code registry (the product list). Unmapped pages
// are flagged "Needs mapping" with a dropdown to assign manually. Pages are
// grouped (collapsibly) by product code. Per-page ROAS reuses Module 3's
// per-product metrics (single source of truth).

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import {
  el, clear, button, pill, field, input, select, sortableTable, pageHeader, card,
  statTile, toast, emptyState, openModal,
} from '../ui.js';
import { toNum } from '../util.js';

const PAGE_STATUSES = ['Active', 'Testing', 'Scaling', 'Low Stock', 'Disabled'];
let onlyUnmapped = false;

/**
 * Detect a known product code inside a page name (case-insensitive, word-bounded;
 * longest code wins so SCAR-021 doesn't match SCAR-02). Returns '' if none.
 */
export function detectProductCode(name, codes) {
  if (!name) return '';
  const sorted = [...codes].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (!c) continue;
    const re = new RegExp('(^|[^A-Za-z0-9])' + escapeRe(c) + '($|[^A-Za-z0-9])', 'i');
    if (re.test(name)) return c;
  }
  return '';
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function render(view) {
  const codes = store.getProductCodes();

  // Auto-detect & persist codes for any page whose productCode is empty but
  // whose name contains a known code (so it becomes "mapped" automatically).
  let autoMapped = 0;
  store.getPages().forEach((pg) => {
    if (!pg.productCode) {
      const detected = detectProductCode(pg.name, codes);
      if (detected) { store.upsertPage({ ...pg, productCode: detected }); autoMapped++; }
    }
  });

  const pages = store.getPages();
  const mapped = pages.filter((p) => p.productCode);
  const unmapped = pages.filter((p) => !p.productCode);

  view.appendChild(pageHeader(
    'Page Status Manager',
    'Per-Facebook-Page status & performance. Codes auto-detect from the page name.',
    [
      button(onlyUnmapped ? 'Show all' : `Needs mapping (${unmapped.length})`, { variant: onlyUnmapped ? 'primary' : 'ghost', onClick: () => { onlyUnmapped = !onlyUnmapped; rerender(view); } }),
      button('+ Add page', { variant: 'primary', onClick: () => openPageModal(view) }),
    ],
  ));

  if (!pages.length) {
    view.appendChild(emptyState('No pages yet. Add a Facebook Page to start tracking it.',
      button('+ Add page', { variant: 'primary', onClick: () => openPageModal(view) })));
    return;
  }

  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Pages', String(pages.length)),
    statTile('Mapped', String(mapped.length), { tone: 'good' }),
    statTile('Needs mapping', String(unmapped.length), { tone: unmapped.length ? 'warn' : undefined }),
    statTile('Yest. spend', metrics.fmt(pages.reduce((s, p) => s + toNum(p.yesterdaySpend), 0), 'peso')),
  ));

  // ---- unmapped group (always shown first if any) ----
  if (unmapped.length) {
    view.appendChild(unmappedCard(view, unmapped, codes));
  }

  if (onlyUnmapped) return;

  // ---- grouped-by-product collapsible groups ----
  const groups = {};
  mapped.forEach((p) => { (groups[p.productCode] = groups[p.productCode] || []).push(p); });
  const codeOrder = Object.keys(groups).sort();
  if (!codeOrder.length && !unmapped.length) {
    view.appendChild(emptyState('No mapped pages.'));
  }
  codeOrder.forEach((code) => view.appendChild(groupCard(view, code, groups[code])));
}

function rerender(view) { clear(view); render(view); }

// ---------------------------------------------------------------------------
// Unmapped pages card (with assign dropdowns)
// ---------------------------------------------------------------------------
function unmappedCard(view, unmapped, codes) {
  const c = el('section', { class: 'card', style: { borderTop: '2px solid var(--warn)' } });
  c.appendChild(el('div', { class: 'spread' },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: `Needs mapping (${unmapped.length})` }),
    pill('Needs mapping', { tone: 'warn' })));
  c.appendChild(el('p', { class: 'field__hint', text: 'No product code detected in the page name. Assign one, or rename the page to include a code.' }));

  const columns = [
    { key: 'name', label: 'Page', render: (pg) => pg.name },
    { key: 'assign', label: 'Assign product', sortable: false, render: (pg) => {
      const sel = select(['— unmapped —', ...codes], { value: '— unmapped —' });
      sel.classList.add('no-rowclick');
      sel.addEventListener('change', () => {
        const code = sel.value === '— unmapped —' ? '' : sel.value;
        store.upsertPage({ ...pg, productCode: code });
        if (code) { toast(`${pg.name} → ${code}`, 'success'); rerender(view); }
      });
      return sel;
    } },
    { key: 'yesterdaySpend', label: 'Yest. spend', align: 'right', render: (pg) => metrics.fmt(toNum(pg.yesterdaySpend), 'peso') },
    { key: 'status', label: 'Status', sortable: false, render: (pg) => statusSelect(pg, view) },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (pg) => rowActions(pg, view) },
  ];
  c.appendChild(sortableTable(columns, unmapped, { empty: 'None.' }));
  return c;
}

// ---------------------------------------------------------------------------
// Collapsible group per product code
// ---------------------------------------------------------------------------
function groupCard(view, code, pages) {
  const product = store.getProduct(code);
  const groupRoas = metrics.currentRoas(code);
  const open = { v: true };

  const body = el('div', {});
  const header = el('button', { class: 'btn btn--ghost', style: { width: '100%', justifyContent: 'space-between', marginBottom: '0' } });
  const caret = el('span', { text: '▾' });
  header.appendChild(el('span', { class: 'row', style: { gap: '10px', alignItems: 'center' } },
    caret, el('span', { class: 'code-badge', text: code }),
    el('span', { text: product ? product.name : '(unknown product)', class: product ? '' : 'muted' }),
    el('span', { class: 'nav__num', text: String(pages.length) })));
  header.appendChild(el('span', { class: 'mono', text: 'ROAS ' + metrics.fmt(groupRoas, 'roas') }));
  header.addEventListener('click', () => { open.v = !open.v; body.style.display = open.v ? '' : 'none'; caret.textContent = open.v ? '▾' : '▸'; });

  const columns = [
    { key: 'name', label: 'Page', render: (pg) => pg.name },
    { key: 'pendingOrders', label: 'Pend. orders', align: 'right', sortValue: (pg) => toNum(pg.pendingOrders), render: (pg) => String(toNum(pg.pendingOrders)) },
    { key: 'pendingItems', label: 'Pend. items', align: 'right', sortValue: (pg) => toNum(pg.pendingItems), render: (pg) => String(toNum(pg.pendingItems)) },
    { key: 'roas', label: 'ROAS', align: 'right', render: () => metrics.fmt(groupRoas, 'roas') },
    { key: 'yesterdaySpend', label: 'Yest. spend', align: 'right', sortValue: (pg) => toNum(pg.yesterdaySpend), render: (pg) => metrics.fmt(toNum(pg.yesterdaySpend), 'peso') },
    { key: 'status', label: 'Status', sortable: false, render: (pg) => statusSelect(pg, view) },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (pg) => rowActions(pg, view) },
  ];
  body.appendChild(sortableTable(columns, pages, { empty: 'No pages.' }));

  const c = el('section', { class: 'card' }, header, el('div', { style: { height: '12px' } }), body);
  return c;
}

// inline status dropdown (quick edit, persists immediately)
function statusSelect(pg, view) {
  const sel = select(PAGE_STATUSES, { value: pg.status || 'Active' });
  sel.classList.add('no-rowclick');
  sel.style.width = 'auto';
  sel.addEventListener('change', () => { store.upsertPage({ ...pg, status: sel.value }); toast(`${pg.name}: ${sel.value}`, 'info'); });
  return sel;
}

function rowActions(pg, view) {
  const wrap = el('div', { class: 'row no-rowclick', style: { gap: '6px', justifyContent: 'flex-end' } });
  wrap.appendChild(button('Edit', { variant: 'ghost', onClick: () => openPageModal(view, pg) }));
  wrap.appendChild(button('✕', { variant: 'subtle', title: 'Delete page', onClick: () => { store.deletePage(pg.id); toast(`Deleted ${pg.name}.`, 'success'); rerender(view); } }));
  return wrap;
}

// ---------------------------------------------------------------------------
// Add / edit page modal
// ---------------------------------------------------------------------------
function openPageModal(view, existing) {
  const codes = store.getProductCodes();
  const nameInput = input({ value: existing?.name || '', placeholder: 'e.g. GINKGO-01 Memory PH' });
  const detected = el('span', { class: 'field__hint' });
  const productSel = select(['— auto-detect / unmapped —', ...codes], { value: existing?.productCode || '— auto-detect / unmapped —' });
  const ordersInput = input({ type: 'number', value: existing?.pendingOrders ?? 0 });
  const itemsInput = input({ type: 'number', value: existing?.pendingItems ?? 0 });
  const spendInput = input({ type: 'number', value: existing?.yesterdaySpend ?? 0 });
  const statusSel = select(PAGE_STATUSES, { value: existing?.status || 'Active' });

  function refreshDetected() {
    const d = detectProductCode(nameInput.value, codes);
    detected.innerHTML = d ? `Detected code: <b style="color:var(--good)">${d}</b>` : 'No code detected in name — will be "Needs mapping" unless you pick one.';
  }
  nameInput.addEventListener('input', refreshDetected);
  refreshDetected();

  const body = el('div', { class: 'stack' },
    field('Page name', nameInput, { hint: 'Include the product code (e.g. "SCAR-02 …") for auto-mapping.' }),
    detected,
    field('Product (override)', productSel, { hint: 'Leave on auto-detect to map from the name.' }),
    el('div', { class: 'form-grid' },
      field('Pending orders', ordersInput),
      field('Pending items', itemsInput),
      field('Yesterday ad spend (₱)', spendInput),
      field('Status', statusSel),
    ),
  );

  openModal({
    title: existing ? `Edit ${existing.name}` : 'Add page', width: 560, body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: existing ? 'Save' : 'Add page', variant: 'primary', onClick: (close) => {
        const name = nameInput.value.trim();
        if (!name) { detected.innerHTML = '<b style="color:var(--bad)">Page name is required.</b>'; return; }
        const override = productSel.value.startsWith('—') ? '' : productSel.value;
        const productCode = override || detectProductCode(name, codes);
        store.upsertPage({
          ...(existing || {}),
          name, productCode,
          pendingOrders: toNum(ordersInput.value),
          pendingItems: toNum(itemsInput.value),
          yesterdaySpend: toNum(spendInput.value),
          status: statusSel.value,
        });
        toast(existing ? 'Page updated.' : 'Page added.', 'success');
        close();
        rerender(view);
      } },
    ],
  });
}
