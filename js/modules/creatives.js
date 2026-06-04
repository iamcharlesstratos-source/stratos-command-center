// creatives.js — Module 2: Creative Testing Machine.
//
// Create/track/test image & video creatives. Status workflow, artist assignment,
// deadline + overdue detection, a reusable hook bank, a winning-creative
// leaderboard (composite ROAS↑/CPP↓/CTR↑/CPM↓ with editable weights), and AI
// generation of hooks / image prompts / video scripts. Creatives spawned from a
// competitor keep `sourceCompetitorId`.

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import * as ai from '../ai.js';
import {
  el, clear, button, pill, field, input, textarea, select, sortableTable,
  pageHeader, card, openModal, confirmDialog, toast, emptyState, statTile, sparkline,
} from '../ui.js';
import { todayStr, toNum } from '../util.js';

const STATUSES = ['To Do', 'In Progress', 'For Review', 'Approved', 'Launched', 'Winner', 'Loser'];
const APPROVED_SET = ['Approved', 'Launched', 'Winner'];
// Advertisers are admins; Graphic Artists can work creatives but not leaderboard/team settings.
const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();
let viewMode = 'tables'; // 'tables' | 'board'
let mineOnly = null;     // null = uninitialized; set from role on first render
let mineOnlyRole = null; // re-init the filter when the role changes

export function isOverdue(c) {
  return c.deadline && c.deadline < todayStr() && !APPROVED_SET.includes(c.status);
}

export function render(view) {
  const products = store.getProducts();
  const ui = store.getConfig().ui || {};
  const me = ui.userName || '';
  if (mineOnly === null || mineOnlyRole !== ui.role) { mineOnly = !!me && ui.role === 'Graphic Artist'; mineOnlyRole = ui.role; } // artists default to their own work
  const allCreatives = store.getCreatives();
  const creatives = (mineOnly && me) ? allCreatives.filter((c) => c.assignee === me) : allCreatives;

  view.appendChild(pageHeader(
    ui.role === 'Graphic Artist' ? 'My Creatives' : 'Creative Testing Machine',
    ui.role === 'Graphic Artist' ? 'Mga creative na naka-assign sa iyo — briefs, deadlines & status.' : 'Brief, assign, track & rank image/video creatives — fast.',
    [
      me ? button(mineOnly ? '◉ Mine only' : '○ All', { variant: 'ghost', title: 'Filter to creatives assigned to you', onClick: () => { mineOnly = !mineOnly; rerender(view); } }) : null,
      button(viewMode === 'tables' ? 'Board view' : 'Table view', { variant: 'ghost', onClick: () => { viewMode = viewMode === 'tables' ? 'board' : 'tables'; rerender(view); } }),
      isAdmin() ? button('Rank weights', { variant: 'ghost', onClick: () => openWeightsModal(view) }) : null,
      isAdmin() ? button('Manage team', { variant: 'ghost', onClick: () => openTeamModal(view) }) : null,
      button('+ New creative', { variant: 'primary', onClick: () => openCreativeModal(view) }),
    ].filter(Boolean),
  ));

  if (!products.length) {
    view.appendChild(emptyState('Add a product first (Module 1) — creatives are linked to products.',
      button('Go to products', { variant: 'primary', onClick: () => { location.hash = '#/products'; } })));
    return;
  }

  // summary
  const overdue = creatives.filter(isOverdue).length;
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Creatives', String(creatives.length)),
    statTile('Winners', String(creatives.filter((c) => c.status === 'Winner').length), { tone: 'good' }),
    statTile('In pipeline', String(creatives.filter((c) => !['Winner', 'Loser'].includes(c.status)).length), { tone: 'warn' }),
    statTile('Overdue', String(overdue), { tone: overdue ? 'bad' : undefined }),
  ));

  // leaderboard
  view.appendChild(renderLeaderboard(view, creatives));

  // main view
  if (viewMode === 'board') view.appendChild(renderBoard(view, creatives));
  else {
    view.appendChild(renderTable(view, 'image', creatives.filter((c) => c.type === 'image')));
    view.appendChild(renderTable(view, 'video', creatives.filter((c) => c.type === 'video')));
  }

  // hook bank
  view.appendChild(renderHookBank(view));
}

function rerender(view) { clear(view); render(view); }

// ---------------------------------------------------------------------------
// Leaderboard (composite ranking, editable weights)
// ---------------------------------------------------------------------------
function renderLeaderboard(view, creatives) {
  const w = store.getConfig().creativeWeights;
  // rank on EFFECTIVE metrics: a creative's daily rows summed if present, else its blob
  const ranked = metrics.rankCreatives(creatives.map((x) => ({ ...x, metrics: metrics.creativeRawMetrics(x) })), w);
  const wlabel = `ROAS ${pct(w.roas)} · CPP ${pct(w.cpp)} · CTR ${pct(w.ctr)} · CPM ${pct(w.cpm)}`;
  const winnerPatterns = () => {
    if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
    const winners = store.getCreatives().filter((x) => x.status === 'Winner' || x.status === 'Launched');
    const pool = winners.length ? winners : ranked.slice(0, 3).map((r) => store.getCreative(r.id)).filter(Boolean);
    if (!pool.length) { toast('No winners yet to analyze.', 'warn'); return; }
    const ctx = pool.map((x) => { const m = metrics.computeMetrics(x.metrics || {}); return `[${x.productCode} ${x.type}] "${x.title}" — hook: "${x.hook || ''}" — ROAS ${metrics.fmt(m.roas, 'roas')}, CTR ${metrics.fmt(m.ctr, 'ctr')}.`; }).join('\n');
    ai.openAiEditor({
      title: 'What do my winners share?',
      system: `${ai.languageDirective()} You analyze winning ad creatives and extract repeatable patterns.`,
      user: `My winning creatives:\n${ctx}\n\nWhat do these have in common (hook style, angle, format, offer)? Give 3–5 repeatable patterns to apply to the next batch.`,
      saveLabel: 'Done', onSave: () => {},
    });
  };

  const c = el('section', { class: 'card' });
  c.appendChild(el('div', { class: 'spread' },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: '🏆 Winning Creative Leaderboard' }),
    el('div', { class: 'row', style: { gap: '10px', alignItems: 'center' } },
      el('span', { class: 'field__hint', text: 'Weights: ' + wlabel }),
      button('✨ Winner patterns', { variant: 'ghost', onClick: winnerPatterns }))));
  if (!ranked.length) { c.appendChild(el('p', { class: 'muted', style: { margin: '10px 0 0' }, text: 'No creatives with metrics yet. Add spend/revenue to a creative to rank it.' })); return c; }

  const columns = [
    { key: 'rank', label: '#', align: 'center', sortValue: (r) => r._rank, render: (r) => medal(r._rank) },
    { key: 'title', label: 'Creative', render: (r) => el('div', {}, el('strong', { text: r.title || '(untitled)' }), el('div', { class: 'muted', style: { fontSize: '11px' } }, el('span', { class: 'code-badge', text: r.productCode }), ' · ' + r.type)) },
    { key: 'score', label: 'Score', align: 'right', sortValue: (r) => r._score, render: (r) => el('strong', { text: r._score.toFixed(0) }) },
    { key: 'roas', label: 'ROAS', align: 'right', sortValue: (r) => r._metrics.roas ?? -1, cellBg: (r) => { const l = metrics.labelForRoas(r._metrics.roas, store.getConfig().thresholds); return l === 'Scale' ? 'rgba(45,212,167,0.18)' : l === 'Observe' ? 'rgba(245,185,69,0.16)' : l === 'Kill' ? 'rgba(244,80,107,0.16)' : null; }, render: (r) => metrics.fmt(r._metrics.roas, 'roas') },
    { key: 'cpp', label: 'CPP', align: 'right', sortValue: (r) => r._metrics.cpp ?? Infinity, render: (r) => metrics.fmt(r._metrics.cpp, 'cpp') },
    { key: 'ctr', label: 'CTR', align: 'right', sortValue: (r) => r._metrics.ctr ?? -1, render: (r) => metrics.fmt(r._metrics.ctr, 'ctr') },
    { key: 'cpm', label: 'CPM', align: 'right', sortValue: (r) => r._metrics.cpm ?? -1, render: (r) => metrics.fmt(r._metrics.cpm, 'cpm') },
    { key: 'status', label: 'Status', render: (r) => pill(r.status) },
  ];
  c.appendChild(el('div', { style: { marginTop: '12px' } }, sortableTable(columns, ranked, { sort: { key: 'rank', dir: 'asc' }, onRowClick: (r) => openCreativeModal(view, store.getCreative(r.id)) })));
  return c;
}
function pct(n) { return Math.round((n || 0) * 100) + '%'; }
function medal(rank) { return el('span', { text: rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank) }); }

// ---------------------------------------------------------------------------
// Creative table (image / video)
// ---------------------------------------------------------------------------
function renderTable(view, type, list) {
  const title = type === 'image' ? 'Image Creatives' : 'Video Creatives';
  const columns = [
    { key: 'title', label: 'Title', render: (c) => el('div', {},
      el('span', { text: c.title || '(untitled)' }),
      c.sourceCompetitorId ? el('span', { class: 'tag', style: { marginLeft: '6px' }, title: 'Duplicated from a competitor ad' }, '↻ competitor') : null,
      el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px' }, text: c.hook || '' })) },
    { key: 'productCode', label: 'Product', render: (c) => el('span', { class: 'code-badge', text: c.productCode || '—' }) },
    { key: 'assignee', label: 'Assignee', render: (c) => c.assignee || '—' },
    { key: 'deadline', label: 'Deadline', sortValue: (c) => c.deadline || '', render: (c) => deadlineCell(c) },
    { key: 'trend', label: '7d', sortable: false, render: (c) => { const s = metrics.creativeSeries(c.id, 7); return s.length >= 1 ? sparkline(s.map((x) => x.roas), { width: 60, height: 20 }) : el('span', { class: 'muted', text: '—' }); } },
    { key: 'roas', label: 'ROAS', align: 'right', sortValue: (c) => metrics.computeMetrics(metrics.creativeRawMetrics(c)).roas ?? -1, render: (c) => metrics.fmt(metrics.computeMetrics(metrics.creativeRawMetrics(c)).roas, 'roas') },
    { key: 'status', label: 'Status', sortable: false, render: (c) => statusSelect(c, view) },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (c) => rowActions(c, view) },
  ];
  return card(`${title} (${list.length})`,
    sortableTable(columns, list, { sort: { key: 'deadline', dir: 'asc' }, empty: `No ${type} creatives yet.`,
      rowClass: (c) => isOverdue(c) ? 'row--danger' : '', onRowClick: (c) => openCreativeModal(view, store.getCreative(c.id)) }));
}

function deadlineCell(c) {
  if (!c.deadline) return el('span', { class: 'muted', text: '—' });
  const over = isOverdue(c);
  return el('span', { style: { color: over ? 'var(--bad)' : 'inherit', fontWeight: over ? '700' : '400' }, text: c.deadline + (over ? ' ⚠' : '') });
}

function statusSelect(c, view) {
  const sel = select(STATUSES, { value: c.status || 'To Do' });
  sel.classList.add('no-rowclick');
  sel.style.width = 'auto';
  sel.addEventListener('change', () => {
    store.upsertCreative({ ...c, status: sel.value });
    if (c.productCode) metrics.recomputeStatus(c.productCode); // Approved/Launched/Winner can make product Ready
    // winning-hook feedback: a Winner's hook gets starred into the Hook Bank
    if (sel.value === 'Winner' && c.hook && !store.getHooks().some((h) => h.text === c.hook)) {
      store.upsertHook({ text: c.hook, productCode: c.productCode, angle: '★ winner' });
      toast('Winning hook saved to Hook Bank ⭐', 'success');
    } else {
      toast(`${c.title || 'Creative'}: ${sel.value}`, 'info');
    }
    rerender(view);
  });
  return sel;
}

function rowActions(c, view) {
  const wrap = el('div', { class: 'row no-rowclick', style: { gap: '6px', justifyContent: 'flex-end' } });
  wrap.appendChild(button('⎘', { variant: 'subtle', title: 'Make AI variants of this creative', onClick: () => makeVariants(view, c) }));
  wrap.appendChild(button('Edit', { variant: 'ghost', onClick: () => openCreativeModal(view, c) }));
  wrap.appendChild(button('✕', { variant: 'subtle', title: 'Delete', onClick: async () => {
    if (await confirmDialog({ title: 'Delete creative?', message: c.title || '(untitled)', confirmText: 'Delete', danger: true })) {
      store.deleteCreative(c.id); if (c.productCode) metrics.recomputeStatus(c.productCode); toast('Deleted.', 'success'); rerender(view);
    }
  } }));
  return wrap;
}

// Generate 3 hook variations of a (winning) creative → new creatives linked by sourceCreativeId.
function makeVariants(view, c) {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  const product = store.getProduct(c.productCode);
  ai.openAiEditor({
    title: `Variants of "${c.title || 'creative'}"`, asList: true,
    system: `${ai.languageDirective()} You create test variations of a winning ad — keep the proven angle, fresh hooks.`,
    user: `${product ? ai.productContext(product) + '\n' : ''}Winning ${c.type} hook: "${c.hook || ''}"${c.script ? '\nScript: ' + c.script.slice(0, 200) : ''}\n\nWrite 3 new HOOK variations to test against this winner. One per line, no numbering.`,
    saveLabel: 'Create variants',
    onSave: (t) => {
      const hooks = ai.parseList(t).slice(0, 5);
      hooks.forEach((h, i) => store.upsertCreative({ productCode: c.productCode, type: c.type, title: `${c.title || 'Creative'} — variant ${i + 1}`, hook: h, script: c.script || '', assignee: c.assignee || '', status: 'To Do', sourceCreativeId: c.id }));
      if (c.productCode) metrics.recomputeStatus(c.productCode);
      toast(`Created ${hooks.length} variant(s).`, 'success'); rerender(view);
    },
  });
}

// Per-creative daily performance (sparkline + log-a-day + history) — modal section
function renderCreativeDaily(host, c) {
  clear(host);
  const series = metrics.creativeSeries(c.id, 14);
  host.appendChild(el('hr', { class: 'divider' }));
  host.appendChild(el('div', { class: 'spread' },
    el('span', { class: 'field__label', text: 'Daily performance (per-creative — feeds the leaderboard)' }),
    series.length ? sparkline(series.map((x) => x.roas), { width: 140, height: 28 }) : el('span', { class: 'muted', text: 'no daily rows yet' })));

  const dateInp = input({ type: 'date', value: todayStr() });
  const fields = ['spend', 'revenue', 'impressions', 'clicks', 'purchases'];
  const inputs = {};
  const grid = el('div', { class: 'form-grid' }, field('Date', dateInp));
  fields.forEach((f) => { const i = input({ type: 'number', step: 'any', value: 0 }); inputs[f] = i; grid.appendChild(field(f[0].toUpperCase() + f.slice(1), i)); });
  host.appendChild(grid);
  host.appendChild(el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '8px' } },
    button('Log day', { variant: 'ghost', onClick: () => {
      store.upsertCreativeMetric({ creativeId: c.id, date: dateInp.value, ...Object.fromEntries(fields.map((f) => [f, toNum(inputs[f].value)])) });
      if (c.productCode) metrics.recomputeStatus(c.productCode);
      toast('Logged.', 'success'); renderCreativeDaily(host, c);
    } })));

  const rows = store.getCreativeMetricsByCreative(c.id).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (rows.length) {
    const cols = [
      { key: 'date', label: 'Date', render: (r) => r.date },
      { key: 'spend', label: 'Spend', align: 'right', render: (r) => metrics.fmt(toNum(r.spend), 'peso') },
      { key: 'roas', label: 'ROAS', align: 'right', render: (r) => metrics.fmt(metrics.roas(toNum(r.revenue), toNum(r.spend)), 'roas') },
      { key: 'del', label: '', sortable: false, align: 'right', render: (r) => button('✕', { variant: 'subtle', title: 'Delete row', onClick: () => { store.deleteCreativeMetric(r.id); renderCreativeDaily(host, c); } }) },
    ];
    host.appendChild(el('div', { style: { marginTop: '10px' } }, sortableTable(cols, rows, { empty: '—' })));
  }
}

// ---------------------------------------------------------------------------
// Kanban board (optional view)
// ---------------------------------------------------------------------------
function renderBoard(view, creatives) {
  const wrap = el('div', { class: 'row', style: { gap: '12px', overflowX: 'auto', alignItems: 'flex-start', flexWrap: 'nowrap' } });
  STATUSES.forEach((status) => {
    const col = el('div', { style: { minWidth: '210px', flex: '1 0 210px' } });
    const items = creatives.filter((c) => (c.status || 'To Do') === status);
    col.appendChild(el('div', { class: 'spread', style: { marginBottom: '8px' } },
      pill(status), el('span', { class: 'nav__num', text: String(items.length) })));
    items.forEach((c) => {
      const cardEl = el('div', { class: 'card', style: { padding: '10px', marginBottom: '8px', cursor: 'pointer', borderLeft: isOverdue(c) ? '3px solid var(--bad)' : '3px solid var(--border)' } });
      cardEl.addEventListener('click', () => openCreativeModal(view, store.getCreative(c.id)));
      cardEl.appendChild(el('div', { style: { fontWeight: '600', fontSize: '13px' }, text: c.title || '(untitled)' }));
      cardEl.appendChild(el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } }, el('span', { class: 'code-badge', text: c.productCode || '—' }), ' · ' + c.type));
      cardEl.appendChild(el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' }, text: (c.assignee || 'Unassigned') + (c.deadline ? ' · ' + c.deadline : '') }));
      col.appendChild(cardEl);
    });
    if (!items.length) col.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', padding: '8px' }, text: '—' }));
    wrap.appendChild(col);
  });
  return card('Workflow Board', wrap);
}

// ---------------------------------------------------------------------------
// Create / edit creative modal
// ---------------------------------------------------------------------------
function openCreativeModal(view, existing) {
  const products = store.getProductCodes();
  const cfg = store.getConfig();
  const e = existing || {};
  const m = e.metrics || { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 };

  const typeSel = select([{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }], { value: e.type || 'image' });
  const productSel = select(products.length ? products : [''], { value: e.productCode || products[0] || '' });
  const titleInput = input({ value: e.title || '', placeholder: 'Creative title' });
  const hookInput = input({ value: e.hook || '', placeholder: 'Hook / opening line' });
  const scriptTa = textarea({ value: e.script || '', rows: 4, placeholder: 'Script (video) or image concept/prompt' });
  const assigneeSel = select(cfg.team.length ? cfg.team : ['Unassigned'], { value: e.assignee || cfg.team[0] || 'Unassigned' });
  const deadlineInput = input({ type: 'date', value: e.deadline || '' });
  const statusSel = select(STATUSES, { value: e.status || 'To Do' });

  const metricInputs = {};
  const metricGrid = el('div', { class: 'form-grid' });
  ['spend', 'revenue', 'impressions', 'clicks', 'purchases'].forEach((f) => {
    const inp = input({ type: 'number', step: 'any', value: m[f] ?? 0 });
    metricInputs[f] = inp;
    metricGrid.appendChild(field(f[0].toUpperCase() + f.slice(1), inp));
  });

  // AI buttons
  const aiRow = el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
  const requireAi = () => { if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return false; } return true; };
  const scriptBtn = button('✨ Generate video script', { variant: 'ghost', onClick: () => requireAi() && ai.openAiEditor({
    title: 'Generate video script',
    system: `${ai.languageDirective()} You are a short-form video scriptwriter for FB/TikTok DR ads.`,
    user: `${ai.productContext(store.getProduct(productSel.value))}\nHook: ${hookInput.value || '(none yet)'}\n\nWrite a 15–30s UGC-style video ad script (scene directions + voiceover). If helpful, give 1–2 variations.`,
    saveLabel: 'Use script', onSave: (t) => { scriptTa.value = t; },
  }) });
  const imgBtn = button('✨ Generate image prompts', { variant: 'ghost', onClick: () => requireAi() && ai.openAiEditor({
    title: 'Generate image creative prompts', asList: true,
    system: `${ai.languageDirective()} You write image-ad creative concepts/prompts (for a designer or image model).`,
    user: `${ai.productContext(store.getProduct(productSel.value))}\nHook: ${hookInput.value || '(none yet)'}\n\nGenerate 3 distinct image creative prompts/concepts. One per line.`,
    saveLabel: 'Use prompts', onSave: (t) => { scriptTa.value = t; },
  }) });
  const syncAiButtons = () => { const isVideo = typeSel.value === 'video'; scriptBtn.style.display = isVideo ? '' : 'none'; imgBtn.style.display = isVideo ? 'none' : ''; };
  typeSel.addEventListener('change', syncAiButtons);
  aiRow.appendChild(scriptBtn); aiRow.appendChild(imgBtn);

  const dailyHost = el('div', {});
  if (existing) renderCreativeDaily(dailyHost, existing);

  const body = el('div', { class: 'stack' },
    el('div', { class: 'form-grid' },
      field('Type', typeSel), field('Product', productSel),
      field('Title', titleInput, { full: true }),
      field('Hook', hookInput, { full: true }),
    ),
    field('Script / concept', scriptTa, { full: true }),
    aiRow,
    el('div', { class: 'form-grid' },
      field('Assignee', assigneeSel), field('Deadline', deadlineInput), field('Status', statusSel),
    ),
    e.sourceCompetitorId ? el('div', { class: 'field__hint' }, '↻ Duplicated from competitor ', el('a', { href: '#/competitors', text: 'ad' }), ' #' + e.sourceCompetitorId) : null,
    e.sourceCreativeId ? el('div', { class: 'field__hint' }, '↳ Variant of ', el('a', { href: '#/creatives', text: (store.getCreative(e.sourceCreativeId)?.title) || ('#' + e.sourceCreativeId) })) : null,
    el('hr', { class: 'divider' }),
    el('div', { class: 'field__label', text: 'Quick aggregate metrics (used only if there are no daily rows below)' }),
    metricGrid,
    dailyHost,
  );

  openModal({
    title: existing ? 'Edit creative' : 'New creative', width: 660, body,
    onClose: () => {},
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: existing ? 'Save' : 'Create', variant: 'primary', onClick: (close) => {
        if (!productSel.value) { toast('Pick a product.', 'warn'); return; }
        const saved = store.upsertCreative({
          ...(existing || {}),
          type: typeSel.value, productCode: productSel.value, title: titleInput.value.trim(),
          hook: hookInput.value.trim(), script: scriptTa.value, assignee: assigneeSel.value,
          deadline: deadlineInput.value, status: statusSel.value,
          metrics: Object.fromEntries(Object.entries(metricInputs).map(([k, v]) => [k, toNum(v.value)])),
        });
        metrics.recomputeStatus(saved.productCode);
        toast(existing ? 'Creative saved.' : 'Creative created.', 'success');
        close(); rerender(view);
      } },
    ],
  });
  syncAiButtons();
}

// ---------------------------------------------------------------------------
// Hook bank
// ---------------------------------------------------------------------------
function renderHookBank(view) {
  const hooks = store.getHooks();
  const products = store.getProductCodes();
  const c = el('section', { class: 'card' });
  c.appendChild(el('h3', { class: 'card__title', text: 'Hook Bank' }));
  c.appendChild(el('p', { class: 'field__hint', text: 'Reusable hooks, taggable by product/angle. One-click into a new creative.' }));

  // add + generate row
  const prodSel = select(['(any product)', ...products], { value: products[0] || '(any product)' });
  const hookText = input({ placeholder: 'Add a hook…' }); hookText.style.flex = '1';
  const angleText = input({ placeholder: 'angle/tag (optional)', style: { width: '160px' } });
  const addBtn = button('Add', { variant: 'ghost', onClick: () => {
    const t = hookText.value.trim(); if (!t) return;
    store.upsertHook({ text: t, productCode: prodSel.value === '(any product)' ? '' : prodSel.value, angle: angleText.value.trim() });
    hookText.value = ''; angleText.value = ''; toast('Hook saved.', 'success'); rerender(view);
  } });
  const genBtn = button('✨ Generate 5 hooks', { variant: 'primary', onClick: () => {
    if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
    const code = prodSel.value === '(any product)' ? products[0] : prodSel.value;
    const product = store.getProduct(code);
    if (!product) { toast('Pick a product to generate hooks for.', 'warn'); return; }
    ai.openAiEditor({
      title: `Generate 5 hooks — ${code}`, asList: true,
      system: `${ai.languageDirective()} You write scroll-stopping ad hooks for a PH audience.`,
      user: `${ai.productContext(product)}\n\nWrite 5 scroll-stopping hooks. One per line, no numbering.`,
      genOpts: { bulk: true }, // cheaper model for bulk hooks
      saveLabel: 'Save to hook bank',
      onSave: (text) => { ai.parseList(text).forEach((t) => store.upsertHook({ text: t, productCode: code, angle: 'AI' })); toast('Hooks added to bank.', 'success'); rerender(view); },
    });
  } });

  c.appendChild(el('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap', margin: '10px 0' } }, prodSel, hookText, angleText, addBtn, genBtn));

  if (!hooks.length) { c.appendChild(el('p', { class: 'muted', style: { margin: 0 }, text: 'No saved hooks yet.' })); return c; }
  const list = el('div', { class: 'stack', style: { gap: '6px' } });
  hooks.slice().reverse().forEach((h) => {
    list.appendChild(el('div', { class: 'spread', style: { padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' } },
      el('div', {}, el('span', { text: h.text }),
        el('span', { class: 'muted', style: { marginLeft: '8px', fontSize: '11px' }, text: (h.productCode ? h.productCode : 'any') + (h.angle ? ' · ' + h.angle : '') })),
      el('div', { class: 'row', style: { gap: '6px' } },
        button('Use', { variant: 'ghost', onClick: () => openCreativeModal(view, { productCode: h.productCode || store.getProductCodes()[0] || '', hook: h.text, type: 'video', status: 'To Do' }) }),
        button('✕', { variant: 'subtle', onClick: () => { store.deleteHook(h.id); rerender(view); } }))));
  });
  c.appendChild(list);
  return c;
}

// ---------------------------------------------------------------------------
// Team & weights config modals
// ---------------------------------------------------------------------------
function openTeamModal(view) {
  const cfg = store.getConfig();
  let team = [...cfg.team];
  const listHost = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } });
  const renderChips = () => { clear(listHost); team.forEach((name, i) => { const tag = el('span', { class: 'tag' }, document.createTextNode(name)); tag.appendChild(el('button', { type: 'button', text: '✕', onClick: () => { team.splice(i, 1); renderChips(); } })); listHost.appendChild(tag); }); };
  renderChips();
  const nameInput = input({ placeholder: 'Add team member…' });
  nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const v = nameInput.value.trim(); if (v && !team.includes(v)) { team.push(v); renderChips(); nameInput.value = ''; } } });
  openModal({
    title: 'Team (graphic artists / editors)', width: 480,
    body: el('div', { class: 'stack' }, listHost, el('div', { class: 'row', style: { gap: '6px' } }, nameInput, button('Add', { variant: 'ghost', onClick: () => { const v = nameInput.value.trim(); if (v && !team.includes(v)) { team.push(v); renderChips(); nameInput.value = ''; } } }))),
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Save', variant: 'primary', onClick: (close) => { store.updateConfig({ team: team.length ? team : ['Unassigned'] }); toast('Team saved.', 'success'); close(); rerender(view); } },
    ],
  });
}

function openWeightsModal(view) {
  const w = store.getConfig().creativeWeights;
  const inputs = {};
  const grid = el('div', { class: 'form-grid' });
  [['roas', 'ROAS (higher better)'], ['cpp', 'CPP (lower better)'], ['ctr', 'CTR (higher better)'], ['cpm', 'CPM (lower better)']].forEach(([k, label]) => {
    const inp = input({ type: 'number', step: '0.05', min: 0, value: w[k] }); inputs[k] = inp; grid.appendChild(field(label, inp));
  });
  openModal({
    title: 'Leaderboard weights', width: 480,
    body: el('div', { class: 'stack' }, el('p', { class: 'field__hint', text: 'Relative weights for the composite score. They are normalized, so they need not sum to 1.' }), grid),
    actions: [
      { label: 'Reset (40/30/20/10)', variant: 'ghost', onClick: (close) => { store.updateConfig({ creativeWeights: { roas: 0.4, cpp: 0.3, ctr: 0.2, cpm: 0.1 } }); close(); rerender(view); } },
      { label: 'Save', variant: 'primary', onClick: (close) => { store.updateConfig({ creativeWeights: { roas: toNum(inputs.roas.value), cpp: toNum(inputs.cpp.value), ctr: toNum(inputs.ctr.value), cpm: toNum(inputs.cpm.value) } }); toast('Weights saved.', 'success'); close(); rerender(view); } },
    ],
  });
}
