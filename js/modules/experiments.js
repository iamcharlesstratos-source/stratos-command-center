// experiments.js — A/B Test & Experiment Log.
//
// Log every test: a hypothesis, two (or more) variants with their own metrics,
// a status, and a winner. Computed ROAS/CPP/CTR per variant (never stored).
// An AI "verdict" reads the numbers + hypothesis and recommends the winner +
// next step. Experiments sync + back up like every other collection.

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import * as ai from '../ai.js';
import {
  el, clear, button, pill, field, input, select, textarea, sortableTable,
  pageHeader, card, openModal, confirmDialog, toast, emptyState, statTile,
} from '../ui.js';
import { toNum } from '../util.js';

const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();
const TYPES = ['Creative', 'Audience', 'Offer', 'Price', 'Landing', 'Other'];
const STATUSES = ['Planned', 'Running', 'Done'];

export function render(view) {
  const experiments = store.getExperiments();

  view.appendChild(pageHeader(
    'A/B Tests & Experiments',
    'Log every test — hypothesis, variants, results, and which one won.',
    isAdmin() ? [button('+ New experiment', { variant: 'primary', onClick: () => openEditor(view) })] : [],
  ));

  if (!experiments.length) {
    view.appendChild(emptyState(
      isAdmin() ? 'No tests yet. Create your first experiment — compare two versions and see which one wins.' : 'No experiments yet.',
      isAdmin() ? button('+ New experiment', { variant: 'primary', onClick: () => openEditor(view) }) : null));
    return;
  }

  const running = experiments.filter((e) => e.status === 'Running').length;
  const done = experiments.filter((e) => e.status === 'Done').length;
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Experiments', String(experiments.length)),
    statTile('Running', String(running), { tone: 'warn' }),
    statTile('Done', String(done), { tone: 'good' }),
    statTile('May winner', String(experiments.filter((e) => e.winner).length)),
  ));

  const columns = [
    { key: 'name', label: 'Experiment', render: (e) => e.name || '(untitled)' },
    { key: 'productCode', label: 'Product', render: (e) => e.productCode ? el('span', { class: 'code-badge', text: e.productCode }) : el('span', { class: 'muted', text: '—' }) },
    { key: 'type', label: 'Type', render: (e) => e.type || '—' },
    { key: 'result', label: 'Result', align: 'right', sortValue: (e) => bestRoas(e) ?? -1, render: (e) => resultCell(e) },
    { key: 'winner', label: 'Winner', align: 'center', render: (e) => e.winner ? el('span', { class: 'pill pill--good', text: e.winner }) : el('span', { class: 'muted', text: '—' }) },
    { key: 'status', label: 'Status', render: (e) => pill(e.status) },
    { key: 'actions', label: '', sortable: false, align: 'right', render: (e) => rowActions(view, e) },
  ];

  view.appendChild(sortableTable(columns, experiments, {
    sort: { key: 'status', dir: 'asc' },
    onRowClick: (e) => openEditor(view, e.id),
    rowClass: (e) => e.status === 'Done' && e.winner ? 'row--good' : '',
    empty: 'No experiments.',
  }));
}

function rerender(view) { clear(view); render(view); }

function bestRoas(e) {
  const vals = (e.variants || []).map((v) => metrics.computeMetrics(v).roas).filter((r) => r != null && Number.isFinite(r));
  return vals.length ? Math.max(...vals) : null;
}
function resultCell(e) {
  const parts = (e.variants || []).map((v) => `${v.label}: ${metrics.fmt(metrics.computeMetrics(v).roas, 'roas')}`);
  return el('span', { text: parts.join('   ·   ') || '—' });
}

function rowActions(view, e) {
  const wrap = el('div', { class: 'row', style: { gap: '6px', justifyContent: 'flex-end' } });
  wrap.appendChild(button('Open', { variant: 'ghost', onClick: () => openEditor(view, e.id) }));
  if (isAdmin()) {
    wrap.appendChild(button('✕', { variant: 'subtle', title: 'Delete', onClick: async () => {
      if (await confirmDialog({ title: 'Delete experiment?', message: e.name || '(untitled)', confirmText: 'Delete', danger: true })) {
        store.deleteExperiment(e.id); toast('Deleted.', 'success'); rerender(view);
      }
    } }));
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Editor modal (create / edit)
// ---------------------------------------------------------------------------
function seg(values, current, onPick) {
  const wrap = el('div', { class: 'segmented' });
  values.forEach((v) => {
    const b = el('button', { type: 'button', text: v, class: v === current ? 'active' : '' });
    b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); onPick(v); });
    wrap.appendChild(b);
  });
  return wrap;
}

function variantCard(v, placeholder, onChange) {
  const computed = el('div', { class: 'muted', style: { fontSize: '11px', fontWeight: '600' } });
  function recompute() {
    const m = metrics.computeMetrics(v);
    clear(computed);
    computed.appendChild(el('span', { text: `ROAS ${metrics.fmt(m.roas, 'roas')}` }));
    computed.appendChild(document.createTextNode(`  ·  CPP ${metrics.fmt(m.cpp, 'cpp')}  ·  CTR ${metrics.fmt(m.ctr, 'ctr')}`));
  }
  const numInput = (key) => {
    const i = el('input', { class: 'input', type: 'number', min: 0, step: 'any', value: v[key] || 0 });
    i.addEventListener('input', () => { v[key] = toNum(i.value); recompute(); onChange && onChange(); });
    return i;
  };
  const descInput = el('input', { class: 'input', value: v.desc || '', placeholder });
  descInput.addEventListener('input', () => { v.desc = descInput.value; });

  recompute();
  return el('div', { class: 'card', style: { padding: '12px', background: 'var(--surface-2)' } },
    el('div', { class: 'spread', style: { marginBottom: '6px' } }, el('b', { text: `Variant ${v.label}` }), computed),
    field('What\'s different', descInput),
    el('div', { class: 'form-grid' },
      field('Spend ₱', numInput('spend')),
      field('Revenue ₱', numInput('revenue')),
      field('Purchases', numInput('purchases')),
      field('Impressions', numInput('impressions')),
      field('Clicks', numInput('clicks')),
    ),
  );
}

function openEditor(view, id) {
  const editing = !!id;
  const admin = isAdmin();
  const draft = editing ? JSON.parse(JSON.stringify(store.getExperiment(id))) : store.blankExperiment();
  if (editing && !draft.id) { toast('Experiment not found.', 'warn'); return; }

  const products = store.getProducts();
  const nameInput = input({ value: draft.name, placeholder: 'e.g. Hook A vs Hook B' });
  nameInput.addEventListener('input', (e) => draft.name = e.target.value);
  const productSel = select([{ value: '', label: '— none —' }, ...products.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))], { value: draft.productCode, onChange: (e) => draft.productCode = e.target.value });
  const typeSel = select(TYPES, { value: draft.type, onChange: (e) => draft.type = e.target.value });
  const statusSeg = seg(STATUSES, draft.status, (v) => draft.status = v);
  const hypoInput = textarea({ value: draft.hypothesis, rows: 2, placeholder: 'If we use a pain-led hook, ROAS should rise because it\'s more relatable…' });
  hypoInput.addEventListener('input', (e) => draft.hypothesis = e.target.value);

  const winnerSel = select(['', ...draft.variants.map((v) => v.label)].map((l) => ({ value: l, label: l || '— no winner yet —' })), { value: draft.winner, onChange: (e) => draft.winner = e.target.value });
  const notesInput = textarea({ value: draft.notes, rows: 2, placeholder: 'Notes / next steps' });
  notesInput.addEventListener('input', (e) => draft.notes = e.target.value);

  const vCards = el('div', { class: 'grid grid-2', style: { gap: '10px' } },
    variantCard(draft.variants[0], 'e.g. Pain-led hook'),
    variantCard(draft.variants[1], 'e.g. Curiosity hook'),
  );

  const verdictBox = el('div', { class: 'stack', style: { gap: '6px' } });
  function renderVerdict() {
    clear(verdictBox);
    if (draft.verdict) verdictBox.appendChild(el('div', { class: 'banner banner--info', style: { whiteSpace: 'pre-wrap', alignItems: 'flex-start' } }, el('span', { text: draft.verdict })));
  }
  renderVerdict();

  function runVerdict() {
    if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
    const product = draft.productCode ? store.getProduct(draft.productCode) : null;
    const lines = draft.variants.map((v) => {
      const m = metrics.computeMetrics(v);
      return `Variant ${v.label} (${v.desc || '—'}): spend ${metrics.fmt(m.spend, 'peso')}, revenue ${metrics.fmt(m.revenue, 'peso')}, ROAS ${metrics.fmt(m.roas, 'roas')}, CPP ${metrics.fmt(m.cpp, 'cpp')}, CTR ${metrics.fmt(m.ctr, 'ctr')}, purchases ${m.purchases}`;
    });
    ai.openAiEditor({
      title: 'AI verdict',
      system: `${ai.languageDirective()} You are a sharp performance-marketing analyst judging an A/B test. Decide the winner and explain briefly why, considering whether each variant has enough spend/data to trust, plus ROAS, CPP and CTR. Be concise and practical.`,
      user: `${product ? ai.productContext(product) + '\n\n' : ''}Test type: ${draft.type}\nHypothesis: ${draft.hypothesis || '(none)'}\n\n${lines.join('\n')}\n\nWhich variant wins and why? If data is too thin, say "inconclusive" and what to do. End with a line exactly like:\nWINNER: <variant label or inconclusive>`,
      saveLabel: 'Save verdict',
      onSave: (text) => {
        draft.verdict = text;
        const m = text.match(/WINNER:\s*([A-Za-z0-9]+)/i);
        if (m) {
          const match = draft.variants.find((v) => v.label.toLowerCase() === m[1].toLowerCase());
          if (match) { draft.winner = match.label; winnerSel.value = match.label; }
        }
        renderVerdict();
      },
    });
  }

  const body = el('div', { class: 'stack' },
    el('div', { class: 'form-grid' },
      field('Name', nameInput),
      field('Product', productSel),
      field('Type', typeSel),
    ),
    field('Status', statusSeg),
    field('Hypothesis', hypoInput, { hint: 'What do you expect to happen, and why?' }),
    el('div', { class: 'field__label', style: { marginTop: '4px' } }, 'Variants'),
    vCards,
    el('div', { class: 'spread', style: { marginTop: '4px' } },
      el('div', { style: { flex: 1 } }, field('Winner', winnerSel)),
      admin ? button('✨ AI verdict', { variant: 'ghost', onClick: runVerdict }) : null,
    ),
    verdictBox,
    field('Notes', notesInput),
    admin ? null : el('div', { class: 'banner banner--info' }, el('span', { text: '👁️ Read-only — only Advertisers can edit experiments.' })),
  );

  const actions = [{ label: 'Close', variant: 'ghost', onClick: (close) => close() }];
  if (admin) {
    if (editing) actions.push({ label: 'Delete', variant: 'danger', onClick: async (close) => {
      if (await confirmDialog({ title: 'Delete experiment?', message: draft.name || '(untitled)', confirmText: 'Delete', danger: true })) { store.deleteExperiment(draft.id); toast('Deleted.', 'success'); close(); rerender(view); }
    } });
    actions.push({ label: editing ? 'Save changes' : 'Create', variant: 'primary', onClick: (close) => {
      if (!draft.name.trim()) { toast('Give the experiment a name.', 'warn'); return; }
      store.upsertExperiment(draft);
      toast(editing ? 'Experiment saved.' : 'Experiment created.', 'success');
      close(); rerender(view);
    } });
  }

  openModal({ title: editing ? 'Edit experiment' : 'New experiment', width: 760, body, actions });
}
