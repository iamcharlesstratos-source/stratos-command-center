// products.js — Module 1: Product Testing Command Center (the hub).
//
// Two views:
//   #/products          → list of all products (sortable table)
//   #/products/CODE      → full editor for one product
//
// Everything else in the app links to a product by `code`. Status is
// auto-tagged deterministically (see metrics.computeStatus); the editor shows a
// live preview of the would-be status and launch readiness as you edit.

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import * as ai from '../ai.js';
import {
  el, clear, button, pill, field, input, textarea, select, slider, sortableTable,
  pageHeader, card, openModal, confirmDialog, toast, emptyState, statTile,
} from '../ui.js';
import { toNum, nowISO, todayStr } from '../util.js';

const SAMPLE_STATUS = ['Not ordered', 'Ordered', 'Shipped', 'Received', 'Approved', 'Rejected'];
const CATEGORIES = ['Supplements', 'Skincare', 'Beauty', 'Health', 'Home', 'Gadgets', 'Fashion', 'Other'];

// Advertisers are admins; Graphic Artists get a read-only view of products.
const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();

export function render(view, params) {
  if (params && params[0]) renderDetail(view, decodeURIComponent(params[0]));
  else renderList(view);
}

// ===========================================================================
// LIST VIEW
// ===========================================================================
function renderList(view) {
  metrics.recomputeAllStatuses(); // keep Scaling/Ready tags fresh
  const products = store.getProducts();

  view.appendChild(pageHeader(
    'Stratos Products',
    'Every product runs through one pipeline — R&D → scoring → offer → pricing → launch.',
    isAdmin() ? [
      button('Auto-tag rules', { variant: 'ghost', onClick: openThresholdsModal }),
      button('+ New product', { variant: 'primary', onClick: openNewProductModal }),
    ] : [],
  ));

  if (!products.length) {
    view.appendChild(emptyState(
      isAdmin() ? 'No products yet. Create your first product to start the pipeline.' : 'No products yet. (Only an Advertiser can add them.)',
      isAdmin() ? button('+ New product', { variant: 'primary', onClick: openNewProductModal }) : null));
    return;
  }

  // status summary tiles
  const cfg = store.getConfig();
  const counts = { Scaling: 0, Ready: 0, Pending: 0, Failed: 0 };
  products.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Scaling', String(counts.Scaling), { tone: 'good' }),
    statTile('Ready', String(counts.Ready), { tone: 'good' }),
    statTile('Pending', String(counts.Pending), { tone: 'warn' }),
    statTile('Failed', String(counts.Failed), { tone: 'bad' }),
  ));

  const columns = [
    { key: 'code', label: 'Code', render: (p) => el('span', { class: 'code-badge', text: p.code }) },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', render: (p) => p.category || '—' },
    { key: 'score', label: 'Score', align: 'center', sortValue: (p) => p.score?.total ?? 0,
      render: (p) => scoreBadge(p.score?.total ?? 0, cfg.thresholds.failScore) },
    { key: 'roas', label: 'Cur. ROAS', align: 'right', sortValue: (p) => metrics.currentRoas(p.code) ?? -1,
      render: (p) => metrics.fmt(metrics.currentRoas(p.code), 'roas') },
    { key: 'readiness', label: 'Readiness', align: 'center', sortValue: (p) => metrics.launchReadiness(p).pct,
      render: (p) => readinessMini(metrics.launchReadiness(p).pct) },
    { key: 'status', label: 'Status', render: (p) => pill(p.status) },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (p) => rowActions(p) },
  ];

  view.appendChild(sortableTable(columns, products, {
    sort: { key: 'status', dir: 'asc' },
    onRowClick: (p) => { location.hash = `#/products/${encodeURIComponent(p.code)}`; },
    rowClass: (p) => p.status === 'Failed' ? 'row--danger' : (p.status === 'Scaling' ? 'row--good' : ''),
    empty: 'No products.',
  }));
}

function scoreBadge(total, failScore) {
  const tone = total >= failScore ? 'good' : 'bad';
  return el('span', { class: `pill pill--${tone}`, text: `${total}/25` });
}
function readinessMini(pct) {
  const wrap = el('div', { class: 'gauge', style: { minWidth: '90px' } });
  wrap.appendChild(el('div', { class: 'gauge__track' }, el('div', { class: 'gauge__fill', style: { width: pct + '%' } })));
  wrap.appendChild(el('span', { class: 'gauge__label', text: pct + '%' }));
  return wrap;
}
function rowActions(p) {
  const wrap = el('div', { class: 'row', style: { gap: '6px', justifyContent: 'flex-end' } });
  wrap.appendChild(button('Open', { variant: 'ghost', onClick: () => { location.hash = `#/products/${encodeURIComponent(p.code)}`; } }));
  if (isAdmin()) wrap.appendChild(button('✕', { variant: 'subtle', title: 'Delete product', onClick: (e) => deleteProductFlow(p) }));
  return wrap;
}

// ===========================================================================
// NEW PRODUCT
// ===========================================================================
function openNewProductModal() {
  const codeInput = input({ placeholder: 'e.g. GINKGO-01', style: { textTransform: 'uppercase' } });
  const nameInput = input({ placeholder: 'e.g. Ginkgo Memory Boost' });
  const catSelect = select(CATEGORIES, { value: 'Supplements' });
  const err = el('p', { class: 'field__hint', style: { color: 'var(--bad)' } });

  const body = el('div', { class: 'stack' },
    field('Product code', codeInput, { hint: 'Unique identifier used everywhere. Uppercase, e.g. SCAR-02.' }),
    field('Product name', nameInput),
    field('Category', catSelect),
    err,
  );

  openModal({
    title: 'New product', width: 480, body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Create', variant: 'primary', onClick: (close) => {
        const code = codeInput.value.trim().toUpperCase();
        const name = nameInput.value.trim();
        if (!code) { err.textContent = 'Code is required.'; return; }
        if (store.getProduct(code)) { err.textContent = `Code "${code}" already exists.`; return; }
        const p = store.blankProduct(code, name);
        p.category = catSelect.value;
        store.upsertProduct(p);
        toast(`Product ${code} created.`, 'success');
        close();
        location.hash = `#/products/${encodeURIComponent(code)}`;
      } },
    ],
  });
}

async function deleteProductFlow(p) {
  const linked = store.getCreativesByProduct(p.code).length
    + store.getDailyMetricsByProduct(p.code).length
    + store.getPages().filter((pg) => pg.productCode === p.code).length;
  const ok = await confirmDialog({
    title: `Delete ${p.code}?`,
    message: linked
      ? `${p.code} has ${linked} linked record(s) (creatives, daily metrics, pages). Deleting cascades and removes them too.`
      : `Delete ${p.code}? This cannot be undone.`,
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  const summary = store.deleteProduct(p.code, 'cascade');
  toast(`Deleted ${p.code} (+${summary.creatives} creatives, ${summary.dailyMetrics} metrics, ${summary.pages} pages).`, 'success');
  if (location.hash.includes(encodeURIComponent(p.code))) location.hash = '#/products';
  else if (window.STRATOS) window.STRATOS.renderRoute();
}

// ===========================================================================
// THRESHOLDS CONFIG
// ===========================================================================
function openThresholdsModal() {
  const cfg = store.getConfig();
  const t = cfg.thresholds;
  const failInput = input({ type: 'number', value: t.failScore, min: 5, max: 25 });
  const scaleInput = input({ type: 'number', value: t.scaleRoas, step: 0.1 });
  const obsInput = input({ type: 'number', value: t.observeRoas, step: 0.1 });

  const body = el('div', { class: 'stack' },
    el('p', { class: 'muted', text: 'These deterministic rules drive product status everywhere. Changing them re-tags all products.' }),
    field('Fail if score below (out of 25)', failInput),
    field('Scale if ROAS ≥', scaleInput, { hint: 'Also drives the Module 1 "Scaling" tag.' }),
    field('Observe if ROAS ≥ (else Kill)', obsInput),
  );
  openModal({
    title: 'Auto-tag rules', width: 460, body,
    actions: [
      { label: 'Reset defaults', variant: 'ghost', onClick: (close) => { store.resetConfig(); metrics.recomputeAllStatuses(); toast('Thresholds reset.', 'info'); close(); window.STRATOS.renderRoute(); } },
      { label: 'Save', variant: 'primary', onClick: (close) => {
        store.updateConfig({ thresholds: {
          failScore: toNum(failInput.value), scaleRoas: toNum(scaleInput.value), observeRoas: toNum(obsInput.value),
        } });
        metrics.recomputeAllStatuses();
        toast('Thresholds saved & products re-tagged.', 'success');
        close();
        window.STRATOS.renderRoute();
      } },
    ],
  });
}

// ===========================================================================
// DETAIL / EDITOR
// ===========================================================================
function renderDetail(view, code) {
  const original = store.getProduct(code);
  if (!original) {
    view.appendChild(pageHeader('Product not found', `No product with code "${code}".`,
      [button('← All products', { variant: 'ghost', onClick: () => { location.hash = '#/products'; } })]));
    return;
  }
  metrics.recomputeStatus(code);
  // working draft (deep clone) — edits live here until Save
  const draft = JSON.parse(JSON.stringify(store.getProduct(code)));

  // ---- header ----
  const statusSlot = el('span', {});
  statusSlot.appendChild(pill(metrics.computeStatus(draft)));
  const setStatusPill = (s) => { clear(statusSlot); statusSlot.appendChild(pill(s)); };
  const head = el('div', { class: 'page-head' });
  const left = el('div', {},
    el('div', { class: 'row', style: { alignItems: 'center', gap: '10px' } },
      el('span', { class: 'code-badge', text: draft.code }),
      statusSlot,
    ),
    el('h2', { class: 'page-title', text: draft.name || '(unnamed product)', style: { marginTop: '8px' } }),
  );
  const admin = isAdmin();
  const actions = el('div', { class: 'page-head__actions' },
    button('← All', { variant: 'ghost', onClick: () => { location.hash = '#/products'; } }),
    admin ? button('Rename code', { variant: 'ghost', onClick: () => renameFlow(draft.code) }) : null,
    admin ? button('Delete', { variant: 'danger', onClick: () => deleteProductFlow(draft) }) : null,
    admin ? button('Save changes', { variant: 'primary', onClick: save }) : null,
  );
  head.appendChild(left); head.appendChild(actions);
  view.appendChild(head);
  if (!admin) {
    view.appendChild(el('div', { class: 'banner banner--info', style: { marginBottom: 'var(--gap)' } },
      el('span', { text: '👁️ Read-only view — you\'re a Graphic Artist. Only Advertisers can edit products.' })));
  }

  // ---- live-derived panels recompute from the draft ----
  const derivedHost = el('div', { class: 'grid grid-3', style: { marginBottom: 'var(--gap)' } });
  view.appendChild(derivedHost);
  function refreshDerived() {
    // score total
    draft.score.total = ['demand', 'margin', 'uniqueness', 'problemSolving', 'repeatPurchase']
      .reduce((s, k) => s + (draft.score[k] || 0), 0);
    // pricing
    draft.pricing.breakevenRoas = metrics.breakevenRoas(draft.pricing.srp, draft.pricing.cost, draft.pricing.shipping);
    draft.pricing.projectedMargin = metrics.projectedMargin(draft.pricing.srp, draft.pricing.cost, draft.pricing.shipping);
    const predicted = metrics.computeStatus(draft);
    const readiness = metrics.launchReadiness(draft);

    clear(derivedHost);
    derivedHost.appendChild(statTile('Score', `${draft.score.total}/25`, {
      tone: draft.score.total >= store.getConfig().thresholds.failScore ? 'good' : 'bad',
      sub: draft.score.total >= store.getConfig().thresholds.failScore ? 'Passes threshold' : 'Below fail threshold',
    }));
    derivedHost.appendChild(statTile('Would-be status', predicted, {
      tone: predicted === 'Failed' ? 'bad' : (predicted === 'Pending' ? 'warn' : 'good'),
      sub: 'on save',
    }));
    // readiness gauge tile
    const rt = el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-tile__value', text: readiness.pct + '%' }),
      el('div', { class: 'stat-tile__label', text: 'Launch readiness' }),
      readinessGates(readiness.gates),
    );
    derivedHost.appendChild(rt);

    setStatusPill(predicted);
  }

  // ---- sections ----
  const grid = el('div', { class: 'grid grid-2' });
  view.appendChild(grid);

  grid.appendChild(sectionRnD(draft, refreshDerived));
  grid.appendChild(sectionScore(draft, refreshDerived));
  grid.appendChild(sectionPainPoints(draft));
  grid.appendChild(sectionApproval(draft, refreshDerived));
  grid.appendChild(sectionOffer(draft));
  grid.appendChild(sectionPricing(draft, refreshDerived));
  grid.appendChild(sectionChecklist(draft, 'fbPage', 'Facebook Page Setup', refreshDerived));
  grid.appendChild(sectionChecklist(draft, 'creativeReq', 'Creative Requirements', refreshDerived));
  grid.appendChild(sectionCompetitors(draft));
  grid.appendChild(sectionAI(draft));

  refreshDerived();

  // ---- save ----
  function save() {
    refreshDerived();
    // stamp approval decision date
    if (draft.approval.decision && draft.approval.decision !== 'pending' && !draft.approval.decidedAt) {
      draft.approval.decidedAt = todayStr();
    }
    store.upsertProduct(draft);
    const status = metrics.recomputeStatus(draft.code);
    toast(`Saved ${draft.code} — status: ${status}.`, 'success');
    setStatusPill(status);
  }
}

function readinessGates(gates) {
  const wrap = el('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' } });
  for (const g of gates) {
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: g.ok ? 'var(--good)' : 'var(--text-dim)' } },
      `${g.ok ? '✓' : '○'} ${g.label}`));
  }
  return wrap;
}

// ---- section builders -----------------------------------------------------
function sectionRnD(draft, onChange) {
  const r = draft.rnd;
  const grid = el('div', { class: 'form-grid' },
    field('Product name', bindInput(draft, 'name', { placeholder: 'Product name' }, onChange), { full: true }),
    field('Category', select(CATEGORIES, { value: draft.category, onChange: (e) => { draft.category = e.target.value; } })),
    field('Sample status', select(SAMPLE_STATUS, { value: r.sampleStatus, onChange: (e) => { r.sampleStatus = e.target.value; } })),
    field('Source', bindInput(r, 'source', { placeholder: '1688 / Alibaba / Local' })),
    field('Supplier', bindInput(r, 'supplier', { placeholder: 'Supplier name' })),
    field('Unit cost (₱)', bindNumber(r, 'cost')),
    field('MOQ', bindNumber(r, 'moq')),
    field('Notes', bindTextarea(r, 'notes', { placeholder: 'Specs, packaging, lead time…' }), { full: true }),
  );
  return card('Product R&D', grid);
}

function sectionScore(draft, onChange) {
  const dims = [
    ['demand', 'Demand'], ['margin', 'Margin'], ['uniqueness', 'Uniqueness'],
    ['problemSolving', 'Problem-solving'], ['repeatPurchase', 'Repeat purchase'],
  ];
  const body = el('div', { class: 'stack', style: { gap: '10px' } });
  for (const [key, label] of dims) {
    const row = el('div', { class: 'spread' },
      el('span', { class: 'field__label', text: label, style: { minWidth: '120px' } }),
      slider({ value: draft.score[key], onInput: (v) => { draft.score[key] = v; onChange(); } }),
    );
    body.appendChild(row);
  }
  return card('Product Scoring (1–5 each)', body);
}

function sectionPainPoints(draft) {
  return card('Pain Point Checker', listEditor(draft.painPoints, 'Add a customer pain point…'));
}

function sectionApproval(draft, onChange) {
  const a = draft.approval;
  const decision = select(
    [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }],
    { value: a.decision, onChange: (e) => { a.decision = e.target.value; if (a.decision !== 'pending' && !a.decidedAt) a.decidedAt = todayStr(); onChange(); } },
  );
  const grid = el('div', { class: 'form-grid' },
    field('Decision', decision),
    field('Decided by', bindInput(a, 'decidedBy', { placeholder: 'Name' })),
    field('Reason / notes', bindTextarea(a, 'reason', { placeholder: 'Why approved or rejected…' }), { full: true }),
  );
  return card('Product Approval', grid);
}

function sectionOffer(draft) {
  const o = draft.offer;
  const grid = el('div', { class: 'form-grid' },
    field('Mechanism', bindInput(o, 'mechanism', { placeholder: 'How it works / key ingredient' }), { full: true }),
    field('Bundle', bindInput(o, 'bundle', { placeholder: 'e.g. Buy 2 Take 1' })),
    field('Guarantee', bindInput(o, 'guarantee', { placeholder: 'e.g. 30-day money back' })),
    field('Bonus', bindInput(o, 'bonus', { placeholder: 'Free gift / ebook' })),
    field('Urgency', bindInput(o, 'urgency', { placeholder: 'Promo ends Sunday' })),
  );
  return card('Offer Builder', grid);
}

function sectionPricing(draft, onChange) {
  const p = draft.pricing;
  const out = el('div', { class: 'stack' });
  const grid = el('div', { class: 'form-grid' },
    field('SRP (₱)', bindNumber(p, 'srp', onChange)),
    field('Product cost (₱)', bindNumber(p, 'cost', onChange)),
    field('Shipping (₱)', bindNumber(p, 'shipping', onChange)),
    field('Target CPP (₱)', bindNumber(p, 'targetCpp', onChange)),
  );
  const derived = el('div', { class: 'grid grid-2', style: { marginTop: '4px' } });
  function refresh() {
    clear(derived);
    const be = metrics.breakevenRoas(p.srp, p.cost, p.shipping);
    const margin = metrics.projectedMargin(p.srp, p.cost, p.shipping);
    const mpct = metrics.marginPct(p.srp, p.cost, p.shipping);
    derived.appendChild(statTile('Breakeven ROAS', metrics.fmt(be, 'roas'), { tone: be === null ? 'bad' : 'warn', sub: be === null ? 'margin ≤ 0' : 'SRP ÷ (SRP−cost−ship)' }));
    derived.appendChild(statTile('Projected margin', metrics.fmt(margin, 'peso'), { tone: margin > 0 ? 'good' : 'bad', sub: mpct === null ? '' : mpct.toFixed(0) + '% of SRP' }));
  }
  // re-run local refresh whenever a pricing input changes
  grid.querySelectorAll('input').forEach((i) => i.addEventListener('input', refresh));
  refresh();
  out.appendChild(grid); out.appendChild(derived);
  return card('Pricing Setup', out);
}

function sectionChecklist(draft, kind, title, onChange) {
  const cfg = store.getConfig();
  const items = kind === 'fbPage' ? cfg.fbPageChecklist : cfg.creativeReqChecklist;
  const stateKey = kind === 'fbPage' ? 'fbPageChecklist' : 'creativeReqChecklist';
  const readyKey = kind === 'fbPage' ? 'fbPageReady' : 'creativeReqReady';
  if (!draft[stateKey]) draft[stateKey] = {};

  const body = el('div', {});
  const statusLine = el('div', { class: 'field__hint', style: { marginBottom: '8px' } });

  function syncReady() {
    const allChecked = items.length > 0 && items.every((it) => draft[stateKey][it]);
    draft[readyKey] = allChecked;
    const done = items.filter((it) => draft[stateKey][it]).length;
    statusLine.innerHTML = `${done}/${items.length} done — <b style="color:${allChecked ? 'var(--good)' : 'var(--text-dim)'}">${readyKey} = ${allChecked}</b>`;
    if (onChange) onChange();
  }

  items.forEach((it) => {
    const label = el('label', { class: 'check' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!draft[stateKey][it];
    cb.addEventListener('change', () => { draft[stateKey][it] = cb.checked; syncReady(); });
    label.appendChild(cb);
    label.appendChild(el('span', { text: it }));
    body.appendChild(label);
  });
  syncReady();
  return card(title, statusLine, body);
}

function sectionCompetitors(draft) {
  const body = el('div', { class: 'stack' },
    el('p', { class: 'muted', style: { margin: 0 }, text: `${store.getCompetitors().length} competitor ads logged. Track ideas for this product in the Competitor Ads library.` }),
    button('View competitor ads →', { variant: 'ghost', onClick: () => { location.hash = `#/competitors/${encodeURIComponent(draft.code)}`; } }),
  );
  return card('Competitor Research', body);
}

function sectionAI(draft) {
  if (!draft.copy) draft.copy = { hooks: [], captions: [], headlines: [], primaryText: [], ctas: [], scripts: [] };
  const briefTa = bindTextarea(draft, 'brief', { placeholder: 'Product brief — generate with AI or write manually…', rows: 5 });
  const anglesEditor = listEditor(draft.angles, 'Add a marketing angle…');

  const copyCounts = el('div', { class: 'row', style: { gap: '6px' } });
  function refreshCounts() {
    clear(copyCounts);
    for (const k of ['hooks', 'captions', 'headlines', 'primaryText', 'ctas', 'scripts']) {
      copyCounts.appendChild(el('span', { class: 'tag', text: `${k}: ${(draft.copy[k] || []).length}` }));
    }
  }
  refreshCounts();

  const requireAi = () => {
    if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return false; }
    return true;
  };
  const lang = () => ai.languageDirective();

  const genBrief = () => requireAi() && ai.openAiEditor({
    title: `Generate brief — ${draft.code}`,
    system: `${lang()} You are a senior direct-response marketing strategist for a Philippine e-commerce brand.`,
    user: `${ai.productContext(draft)}\nScores /5 — demand:${draft.score.demand}, margin:${draft.score.margin}, uniqueness:${draft.score.uniqueness}, problem-solving:${draft.score.problemSolving}, repeat:${draft.score.repeatPurchase}.\n\nWrite a tight product brief (3–5 short paragraphs): who it's for, the core promise, why it works, and the recommended testing angle.`,
    saveLabel: 'Save brief',
    onSave: (text) => { draft.brief = text; briefTa.value = text; store.upsertProduct(draft); toast('Brief saved.', 'success'); },
  });

  const genAngles = () => requireAi() && ai.openAiEditor({
    title: `Generate angles — ${draft.code}`, asList: true,
    system: `${lang()} You generate distinct, testable marketing angles.`,
    user: `${ai.productContext(draft)}\n\nGenerate 3–5 distinct marketing angles to test for this product. One angle per line, no numbering.`,
    saveLabel: 'Append angles',
    onSave: (text) => { ai.parseList(text).forEach((a) => draft.angles.push(a)); anglesEditor.refresh(); store.upsertProduct(draft); toast('Angles added.', 'success'); },
  });

  const genCopy = (bucket, label, count) => () => requireAi() && ai.openAiEditor({
    title: `Generate ${label} — ${draft.code}`, asList: true,
    system: `${lang()} You write high-converting Facebook/TikTok ad copy for a PH audience.`,
    user: `${ai.productContext(draft)}\n\nWrite ${count} ${label} for this product. One per line, no numbering.`,
    saveLabel: `Append ${label}`,
    onSave: (text) => { ai.parseList(text).forEach((t) => draft.copy[bucket].push({ text: t, at: nowISO() })); store.upsertProduct(draft); refreshCounts(); toast(`${label} added.`, 'success'); },
  });

  const briefRow = el('div', { class: 'row', style: { gap: '8px' } }, button('✨ Generate brief', { variant: 'ghost', onClick: genBrief }));
  const anglesRow = el('div', { class: 'row', style: { gap: '8px' } }, button('✨ Generate 3–5 angles', { variant: 'ghost', onClick: genAngles }));
  const copyRow = el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
    button('✨ Hooks', { variant: 'ghost', onClick: genCopy('hooks', 'scroll-stopping hooks', 5) }),
    button('✨ Captions', { variant: 'ghost', onClick: genCopy('captions', 'ad captions', 3) }),
    button('✨ Headlines', { variant: 'ghost', onClick: genCopy('headlines', 'headlines', 5) }),
  );

  const body = el('div', { class: 'stack' },
    el('div', { class: 'field__hint', text: 'Set the output language and backend in AI Settings. Outputs are editable before saving; copy appends with timestamps.' }),
    field('Product brief', briefTa, { full: true }), briefRow,
    field('Marketing angles', anglesEditor, { full: true }), anglesRow,
    el('div', {}, el('span', { class: 'field__label', text: 'Saved copy' }), copyCounts, el('div', { style: { marginTop: '8px' } }, copyRow)),
  );
  return card('AI Content', body);
}

// ---- small input binders --------------------------------------------------
function bindInput(obj, key, props = {}, onChange) {
  const i = input({ value: obj[key] ?? '', ...props });
  i.addEventListener('input', () => { obj[key] = i.value; if (onChange) onChange(); });
  return i;
}
function bindNumber(obj, key, onChange) {
  const i = input({ type: 'number', value: obj[key] ?? 0, step: 'any' });
  i.addEventListener('input', () => { obj[key] = toNum(i.value); if (onChange) onChange(); });
  return i;
}
function bindTextarea(obj, key, props = {}) {
  const t = textarea({ value: obj[key] ?? '', ...props });
  t.addEventListener('input', () => { obj[key] = t.value; });
  return t;
}

/** Editable list of strings (pain points, angles). Mutates the given array in place. */
function listEditor(arr, placeholder) {
  const wrap = el('div', { class: 'stack', style: { gap: '8px' } });
  const chips = el('div', { class: 'row', style: { gap: '6px' } });
  const addRow = el('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } });
  const inp = input({ placeholder });
  inp.style.flex = '1';
  const add = () => {
    const v = inp.value.trim();
    if (!v) return;
    arr.push(v); inp.value = ''; renderChips(); inp.focus();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  addRow.appendChild(inp);
  addRow.appendChild(button('Add', { variant: 'ghost', onClick: add }));

  function renderChips() {
    clear(chips);
    if (!arr.length) chips.appendChild(el('span', { class: 'muted', text: 'None yet.' }));
    arr.forEach((item, i) => {
      const tag = el('span', { class: 'tag' }, document.createTextNode(item));
      tag.appendChild(el('button', { type: 'button', text: '✕', title: 'Remove', onClick: () => { arr.splice(i, 1); renderChips(); } }));
      chips.appendChild(tag);
    });
  }
  renderChips();
  wrap.appendChild(chips); wrap.appendChild(addRow);
  wrap.refresh = renderChips; // lets callers (e.g. AI angle generation) re-render after mutating arr
  return wrap;
}

// ---- rename flow ----------------------------------------------------------
function renameFlow(oldCode) {
  const codeInput = input({ value: oldCode, style: { textTransform: 'uppercase' } });
  const err = el('p', { class: 'field__hint', style: { color: 'var(--bad)' } });
  openModal({
    title: `Rename ${oldCode}`, width: 440,
    body: el('div', { class: 'stack' },
      el('p', { class: 'muted', text: 'Renaming cascades the new code to all linked creatives, daily metrics and pages.' }),
      field('New code', codeInput), err),
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Rename', variant: 'primary', onClick: (close) => {
        const next = codeInput.value.trim().toUpperCase();
        if (!next) { err.textContent = 'Code required.'; return; }
        if (next === oldCode) { close(); return; }
        const ok = store.renameProductCode(oldCode, next);
        if (!ok) { err.textContent = `Code "${next}" already exists.`; return; }
        toast(`Renamed ${oldCode} → ${next}.`, 'success');
        close();
        location.hash = `#/products/${encodeURIComponent(next)}`;
      } },
    ],
  });
}
