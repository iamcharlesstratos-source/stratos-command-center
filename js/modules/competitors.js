// competitors.js — Module 6: Competitor Ads Library Tracker.
//
// Log competitor ads so ideas aren't re-collected manually. Track recreate
// status (Not Started | Copied | Improved), generate AI "recreate faithfully"
// and "improved for our product" prompts, and hand a row off to the Creative
// Testing Machine as a new Creative that keeps `sourceCompetitorId`.

import * as store from '../store.js';
import * as ai from '../ai.js';
import {
  el, clear, button, field, input, textarea, select, sortableTable,
  pageHeader, openModal, confirmDialog, toast, emptyState, statTile,
} from '../ui.js';

const RECREATE = ['Not Started', 'Copied', 'Improved'];
const TYPES = ['image', 'video'];
let filterText = '';

export function render(view, params) {
  // Module 1 links here with a product code → prefill the search as a loose filter.
  if (params && params[0]) {
    const p = store.getProduct(decodeURIComponent(params[0]));
    if (p) filterText = (p.name || '').split(' ')[0]; // arriving from a product always filters to it
  }

  const all = store.getCompetitors();
  const counts = { 'Not Started': 0, Copied: 0, Improved: 0 };
  all.forEach((c) => { counts[c.recreateStatus] = (counts[c.recreateStatus] || 0) + 1; });

  view.appendChild(pageHeader(
    'Competitor Ads Library Tracker',
    'Stop re-collecting competitor ideas — log them once, then recreate or improve.',
    [button('+ Add competitor ad', { variant: 'primary', onClick: () => openCompetitorModal(view) })],
  ));

  // summary chips
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Logged', String(all.length)),
    statTile('Not started', String(counts['Not Started'] || 0), { tone: counts['Not Started'] ? 'warn' : undefined }),
    statTile('Copied', String(counts.Copied || 0), { tone: counts.Copied ? 'warn' : undefined }),
    statTile('Improved', String(counts.Improved || 0), { tone: counts.Improved ? 'good' : undefined }),
  ));

  if (!all.length) {
    view.appendChild(emptyState('No competitor ads logged yet.',
      button('+ Add competitor ad', { variant: 'primary', onClick: () => openCompetitorModal(view) })));
    return;
  }

  // search/filter
  const search = input({ value: filterText, placeholder: 'Filter by brand, product, hook…' });
  search.addEventListener('input', () => { filterText = search.value; refreshTable(); });
  const searchRow = el('div', { class: 'row', style: { gap: '8px', marginBottom: '12px', alignItems: 'center' } },
    el('span', { class: 'field__label', text: 'Search' }), search);
  if (filterText) searchRow.appendChild(button('Clear', { variant: 'subtle', onClick: () => { filterText = ''; rerender(view); } }));
  view.appendChild(searchRow);

  const tableHost = el('div', {});
  view.appendChild(tableHost);
  function refreshTable() {
    clear(tableHost);
    const q = filterText.trim().toLowerCase();
    const rows = q ? all.filter((c) => [c.brand, c.product, c.hook, c.offer, c.cta].some((f) => (f || '').toLowerCase().includes(q))) : all;
    tableHost.appendChild(buildTable(view, rows));
  }
  refreshTable();
}

function rerender(view) { clear(view); render(view); }

function buildTable(view, rows) {
  const trunc = (s, n = 40) => !s ? '—' : (s.length > n ? s.slice(0, n) + '…' : s);
  const columns = [
    { key: 'brand', label: 'Brand', render: (c) => el('strong', { text: c.brand || '—' }) },
    { key: 'product', label: 'Product', render: (c) => trunc(c.product, 24) },
    { key: 'hook', label: 'Hook', render: (c) => el('span', { title: c.hook || '', text: trunc(c.hook, 40) }) },
    { key: 'creativeType', label: 'Type', render: (c) => c.creativeType || '—' },
    { key: 'offer', label: 'Offer', render: (c) => trunc(c.offer, 24) },
    { key: 'cta', label: 'CTA', render: (c) => c.cta || '—' },
    { key: 'visualStyle', label: 'Visual', render: (c) => trunc(c.visualStyle, 24) },
    { key: 'screenshotUrl', label: 'Shot', sortable: false, render: (c) => thumb(c.screenshotUrl) },
    { key: 'recreateStatus', label: 'Recreate', sortable: false, render: (c) => statusSelect(c, view) },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (c) => rowActions(c, view) },
  ];
  return sortableTable(columns, rows, { sort: { key: 'brand', dir: 'asc' }, empty: 'No matches.', onRowClick: (c) => openCompetitorModal(view, store.getCompetitor(c.id)) });
}

function thumb(url) {
  if (!url) return el('span', { class: 'muted', text: '—' });
  const a = el('a', { href: url, target: '_blank', class: 'no-rowclick', title: url });
  const img = el('img', { src: url, alt: 'shot', style: { width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)', display: 'block' } });
  img.addEventListener('error', () => { a.textContent = '🔗 link'; });
  a.appendChild(img);
  return a;
}

function statusSelect(c, view) {
  const sel = select(RECREATE, { value: c.recreateStatus || 'Not Started' });
  sel.classList.add('no-rowclick'); sel.style.width = 'auto';
  sel.addEventListener('change', () => { store.upsertCompetitor({ ...c, recreateStatus: sel.value }); toast(`${c.brand}: ${sel.value}`, 'info'); rerender(view); });
  return sel;
}

function rowActions(c, view) {
  const wrap = el('div', { class: 'row no-rowclick', style: { gap: '6px', justifyContent: 'flex-end', flexWrap: 'nowrap' } });
  wrap.appendChild(button('→ Creative', { variant: 'ghost', title: 'Send to Creative Machine', onClick: () => sendToCreative(view, c) }));
  wrap.appendChild(button('Edit', { variant: 'ghost', onClick: () => openCompetitorModal(view, c) }));
  wrap.appendChild(button('✕', { variant: 'subtle', title: 'Delete', onClick: async () => {
    if (await confirmDialog({ title: 'Delete competitor ad?', message: `${c.brand} — ${c.product || ''}`, confirmText: 'Delete', danger: true })) { store.deleteCompetitor(c.id); toast('Deleted.', 'success'); rerender(view); }
  } }));
  return wrap;
}

// ---------------------------------------------------------------------------
// Add / edit competitor modal (with AI prompt generation)
// ---------------------------------------------------------------------------
function openCompetitorModal(view, existing) {
  const e = existing || {};
  const brand = input({ value: e.brand || '', placeholder: 'Competitor brand' });
  const product = input({ value: e.product || '', placeholder: 'Their product' });
  const hook = input({ value: e.hook || '', placeholder: 'Their hook / angle' });
  const typeSel = select(TYPES, { value: e.creativeType || 'video' });
  const offer = input({ value: e.offer || '', placeholder: 'e.g. Buy 1 Take 1' });
  const cta = input({ value: e.cta || '', placeholder: 'e.g. Shop Now' });
  const visual = input({ value: e.visualStyle || '', placeholder: 'e.g. talking head + captions' });
  const shot = input({ value: e.screenshotUrl || '', placeholder: 'https://… screenshot URL' });

  // AI prompt fields
  const recreateTa = textarea({ value: e.recreatePrompt || '', rows: 4, placeholder: 'Faithful-recreate prompt (generate with AI)…' });
  const improvedTa = textarea({ value: e.improvedPrompt || '', rows: 4, placeholder: 'Improved-version prompt (generate with AI)…' });

  const current = () => ({ brand: brand.value, product: product.value, hook: hook.value, creativeType: typeSel.value, offer: offer.value, cta: cta.value, visualStyle: visual.value });
  const ctxStr = () => { const c = current(); return `Competitor ad:\nBrand: ${c.brand}\nProduct: ${c.product}\nHook: ${c.hook}\nType: ${c.creativeType}\nOffer: ${c.offer}\nCTA: ${c.cta}\nVisual style: ${c.visualStyle}`; };
  const requireAi = () => { if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return false; } return true; };

  const genRecreate = button('✨ Recreate prompt', { variant: 'ghost', onClick: () => requireAi() && ai.openAiEditor({
    title: 'Duplicate (faithful recreate) prompt',
    system: `${ai.languageDirective()} You write creative production briefs/prompts that faithfully recreate an existing ad.`,
    user: `${ctxStr()}\n\nWrite a detailed prompt/brief to faithfully recreate this ad (same angle, structure, and feel) for our own version. Be specific about hook, visuals, and CTA.`,
    saveLabel: 'Use recreate prompt', onSave: (t) => { recreateTa.value = t; },
  }) });
  const genImproved = button('✨ Improved prompt', { variant: 'ghost', onClick: () => requireAi() && ai.openAiEditor({
    title: 'Improved-version prompt',
    system: `${ai.languageDirective()} You improve on competitor ads — same proven angle, but a stronger hook and offer.`,
    user: `${ctxStr()}\n\nWrite a prompt/brief for an IMPROVED version for our product: keep the winning angle but strengthen the hook and offer, and make it more scroll-stopping. Be specific.`,
    saveLabel: 'Use improved prompt', onSave: (t) => { improvedTa.value = t; },
  }) });

  const body = el('div', { class: 'stack' },
    el('div', { class: 'form-grid' },
      field('Brand', brand), field('Their product', product),
      field('Hook', hook, { full: true }),
      field('Creative type', typeSel), field('CTA', cta),
      field('Offer', offer), field('Visual style', visual),
      field('Screenshot URL', shot, { full: true }),
    ),
    el('hr', { class: 'divider' }),
    el('div', { class: 'spread' }, el('span', { class: 'field__label', text: 'AI prompts' }), el('div', { class: 'row', style: { gap: '8px' } }, genRecreate, genImproved)),
    field('Recreate prompt (faithful)', recreateTa, { full: true }),
    field('Improved prompt (stronger)', improvedTa, { full: true }),
  );

  openModal({
    title: existing ? `Edit — ${e.brand || 'competitor'}` : 'Add competitor ad', width: 680, body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      existing ? { label: '→ Send to Creative', variant: 'ghost', onClick: (close) => { close(); sendToCreative(view, store.getCompetitor(existing.id)); } } : null,
      { label: existing ? 'Save' : 'Add', variant: 'primary', onClick: (close) => {
        if (!brand.value.trim()) { toast('Brand is required.', 'warn'); return; }
        store.upsertCompetitor({ ...(existing || {}), ...current(), screenshotUrl: shot.value.trim(), recreatePrompt: recreateTa.value, improvedPrompt: improvedTa.value, recreateStatus: e.recreateStatus || 'Not Started' });
        toast(existing ? 'Saved.' : 'Competitor ad added.', 'success'); close(); rerender(view);
      } },
    ].filter(Boolean),
  });
}

// ---------------------------------------------------------------------------
// Send to Creative Machine (creates a Creative with sourceCompetitorId)
// ---------------------------------------------------------------------------
function sendToCreative(view, c) {
  const codes = store.getProductCodes();
  if (!codes.length) { toast('Add a product first — creatives must link to a product.', 'warn'); return; }
  const cfg = store.getConfig();
  const productSel = select(codes, { value: codes[0] });
  const typeSel = select(TYPES, { value: c.creativeType || 'video' });
  const assigneeSel = select(cfg.team.length ? cfg.team : ['Unassigned'], { value: cfg.team[0] || 'Unassigned' });
  const useImproved = el('input', { type: 'checkbox' });

  const body = el('div', { class: 'stack' },
    el('p', { class: 'field__hint', text: `Creating a creative from ${c.brand}${c.product ? ' — ' + c.product : ''}. The competitor link is preserved (sourceCompetitorId).` }),
    el('div', { class: 'form-grid' },
      field('Our product', productSel), field('Type', typeSel), field('Assignee', assigneeSel),
    ),
    el('label', { class: 'check' }, useImproved, el('span', { text: 'Use the improved prompt as the script (else the recreate prompt)' })),
  );

  openModal({
    title: 'Send to Creative Machine', width: 520, body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Create creative', variant: 'primary', onClick: (close) => {
        const script = useImproved.checked ? (c.improvedPrompt || '') : (c.recreatePrompt || '');
        store.upsertCreative({
          productCode: productSel.value, type: typeSel.value,
          title: `Recreate: ${c.brand}${c.product ? ' — ' + c.product : ''}`,
          hook: c.hook || '', script, assignee: assigneeSel.value,
          deadline: '', status: 'To Do', sourceCompetitorId: c.id,
        });
        // mark the competitor as at least Copied if still Not Started
        if (c.recreateStatus === 'Not Started') store.upsertCompetitor({ ...c, recreateStatus: 'Copied' });
        toast(`Creative created for ${productSel.value}. Opening Creative Machine…`, 'success');
        close();
        location.hash = '#/creatives';
      } },
    ],
  });
}
