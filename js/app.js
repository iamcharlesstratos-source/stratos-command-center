// app.js — application entry point.
// Owns: hash routing, nav/active state, header summary chips, export/import,
// and the AI-settings modal (config only; ai.js consumes these settings later).

import * as store from './store.js';
import * as metrics from './metrics.js';
import * as ai from './ai.js';
import * as sync from './sync.js';
import { el, clear, button, openModal, confirmDialog, toast, field, input, pageHeader, popoverMenu } from './ui.js';
import { todayStr } from './util.js';

// Module views (each exports `render(view, params)`).
import * as dashboard from './modules/dashboard.js';
import * as products from './modules/products.js';
import * as creatives from './modules/creatives.js';
import * as daily from './modules/daily.js';
import * as pages from './modules/pages.js';
import * as content from './modules/content.js';
import * as competitors from './modules/competitors.js';

const ROUTES = {
  dashboard, products, creatives, daily, pages, content, competitors,
};
const DEFAULT_ROUTE = 'dashboard';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, ''); // strip "#/" or "#"
  const segments = raw.split('/').filter(Boolean);
  const route = segments[0] || DEFAULT_ROUTE;
  return { route: ROUTES[route] ? route : DEFAULT_ROUTE, params: segments.slice(1) };
}

function renderRoute() {
  const { route, params } = parseHash();
  const mod = ROUTES[route];
  clear(viewEl);
  try {
    mod.render(viewEl, params);
  } catch (err) {
    console.error(`[app] error rendering "${route}":`, err);
    viewEl.appendChild(pageHeader('Something went wrong', String(err && err.message || err)));
  }
  setActiveNav(route);
  window.scrollTo(0, 0);
}

function setActiveNav(route) {
  navEl.querySelectorAll('.nav__item').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
}

window.addEventListener('hashchange', renderRoute);

// ---------------------------------------------------------------------------
// Header summary chips + nav counts (kept live via store.subscribe)
// ---------------------------------------------------------------------------
function refreshChrome() {
  const s = store.getSummary();
  // nav counts
  const counts = {
    products: s.products,
    creatives: s.creatives,
    pages: s.pages,
    competitors: s.competitors,
    daily: store.getDailyMetrics().length,
  };
  navEl.querySelectorAll('.nav__num').forEach((span) => {
    const key = span.dataset.count;
    span.textContent = counts[key] !== undefined && counts[key] > 0 ? counts[key] : '';
  });

  // summary chips
  const host = document.getElementById('summaryChips');
  clear(host);
  host.appendChild(chip(`${s.products}`, 'Products'));
  const order = [['Scaling', 'good'], ['Ready', 'good'], ['Pending', 'warn'], ['Failed', 'bad']];
  for (const [label, tone] of order) {
    const n = s.byStatus[label] || 0;
    if (n > 0) host.appendChild(statusChip(n, label, tone));
  }
  // action-needed alerts chip (clickable → dashboard)
  let alertCount = 0;
  try { alertCount = metrics.computeAlerts().length; } catch { /* ignore */ }
  if (alertCount > 0) {
    host.appendChild(el('a', { href: '#/dashboard', class: 'chip', title: 'Action needed', style: { borderColor: 'var(--warn)', color: 'var(--warn)' } },
      document.createTextNode('⚠ '), el('b', { text: String(alertCount) }), document.createTextNode(' alerts')));
  }
}

function chip(value, label) {
  return el('span', { class: 'chip' }, el('b', { text: value }), document.createTextNode(' ' + label));
}
function statusChip(n, label, tone) {
  return el('span', { class: 'chip' },
    el('span', { class: `chip__dot chip__dot--${tone}` }),
    el('b', { text: String(n) }), document.createTextNode(' ' + label));
}

// Keep chrome live on any data change (does NOT re-render the active view, so
// in-progress form input is never disrupted — navigation re-renders views).
store.subscribe(() => refreshChrome());

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------
function doExport() {
  const payload = store.exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = todayStr().replace(/-/g, '');
  const a = el('a', { href: url, download: `stratos-backup-${stamp}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded.', 'success');
}

function doImport(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch {
      toast('That file is not valid JSON.', 'error');
      return;
    }
    const ok = await confirmDialog({
      title: 'Restore from backup?',
      message: 'This replaces ALL current data (products, creatives, metrics, pages, competitors, hooks, settings) with the contents of the file. Export first if unsure.',
      confirmText: 'Replace everything',
      danger: true,
    });
    if (!ok) return;
    try {
      const summary = store.importAll(payload);
      const counts = Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ');
      toast(`Restored: ${counts}.`, 'success');
      refreshChrome();
      renderRoute();
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
}

document.getElementById('btnExport').addEventListener('click', doExport);
const importInput = document.getElementById('importFile');
document.getElementById('btnImport').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  if (importInput.files[0]) doImport(importInput.files[0]);
  importInput.value = ''; // allow re-importing the same filename
});

// ---------------------------------------------------------------------------
// AI Settings modal (config editing only — generation lives in ai.js)
// ---------------------------------------------------------------------------
function openAiSettings() {
  const cfg = store.getConfig();
  const ai = cfg.ai;

  const backendSeg = segmented(['auto', 'direct', 'proxy'], ai.backend, (v) => { state.backend = v; renderHint(); });
  const langSeg = segmented(['Taglish', 'English', 'Tagalog'], ai.language, (v) => { state.language = v; });

  const state = { ...ai };

  const keyInput = input({ type: 'password', value: ai.apiKey, placeholder: 'sk-ant-...', onInput: (e) => state.apiKey = e.target.value });
  const proxyInput = input({ value: ai.proxyUrl, placeholder: 'http://localhost:8787/ai', onInput: (e) => state.proxyUrl = e.target.value });
  const copyModelInput = input({ value: ai.copyModel, onInput: (e) => state.copyModel = e.target.value });
  const bulkModelInput = input({ value: ai.bulkModel, onInput: (e) => state.bulkModel = e.target.value });
  const maxTokInput = input({ type: 'number', value: ai.maxTokens, onInput: (e) => state.maxTokens = parseInt(e.target.value, 10) || 1024 });

  const hint = el('p', { class: 'field__hint' });
  function renderHint() {
    if (state.backend === 'direct') hint.innerHTML = '⚠️ <b>Direct mode is internal-use only.</b> Your API key is stored in this browser\'s localStorage and sent from the client — never deploy this publicly.';
    else if (state.backend === 'proxy') hint.textContent = 'Proxy mode: requests go to your local endpoint, which holds the key server-side (see /proxy/server.js).';
    else hint.textContent = 'Auto: use the proxy if a Proxy URL is set, otherwise fall back to a direct browser call.';
  }
  renderHint();

  const body = el('div', { class: 'stack' },
    field('Backend', backendSeg, { hint: 'How AI requests are sent.' }),
    hint,
    field('Anthropic API key (direct mode)', keyInput, { hint: 'Stored client-side. Used only for direct calls.' }),
    field('Proxy URL (proxy mode)', proxyInput),
    el('div', { class: 'form-grid' },
      field('Copy model', copyModelInput, { hint: 'Used for briefs, captions, scripts.' }),
      field('Bulk model', bulkModelInput, { hint: 'Cheaper model for high-volume hooks.' }),
    ),
    el('div', { class: 'form-grid' },
      field('Max tokens', maxTokInput),
      field('Default output language', langSeg),
    ),
  );

  openModal({
    title: 'AI Settings',
    width: 600,
    body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Save settings', variant: 'primary', onClick: (close) => {
        store.updateConfig({ ai: { ...state } });
        toast('AI settings saved.', 'success');
        close();
      } },
    ],
  });
}

// little segmented control used in the modal
function segmented(values, current, onPick) {
  const wrap = el('div', { class: 'segmented' });
  values.forEach((v) => {
    const b = el('button', { type: 'button', text: v, class: v === current ? 'active' : '' });
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onPick(v);
    });
    wrap.appendChild(b);
  });
  return wrap;
}

document.getElementById('btnAiSettings').addEventListener('click', openAiSettings);

// ---------------------------------------------------------------------------
// Cloud Sync (shared team data via Supabase) — settings modal + header chip
// ---------------------------------------------------------------------------
function openSyncSettings() {
  const cur = store.getConfig().sync || {};
  const draft = { ...cur };
  const enableSeg = segmented(['Off', 'On'], cur.enabled ? 'On' : 'Off', (v) => { draft.enabled = (v === 'On'); });
  const urlInput = input({ value: cur.url || '', placeholder: 'https://xxxx.supabase.co', onInput: (e) => draft.url = e.target.value.trim() });
  const keyInput = input({ value: cur.anonKey || '', placeholder: 'Supabase anon public key', onInput: (e) => draft.anonKey = e.target.value.trim() });
  const pollInput = input({ type: 'number', value: cur.pollSeconds || 5, onInput: (e) => draft.pollSeconds = parseInt(e.target.value, 10) || 5 });
  const testOut = el('div', { class: 'field__hint' });

  const body = el('div', { class: 'stack' },
    el('p', { class: 'field__hint', html: 'Shares your <b>data</b> (products, metrics, creatives…) across the team via Supabase. Your AI key &amp; thresholds stay local to this browser. <b>Last-write-wins</b> — coordinate large simultaneous edits. See the README for the 1-minute Supabase setup + SQL.' }),
    field('Cloud Sync', enableSeg),
    field('Supabase URL', urlInput),
    field('Anon public key', keyInput, { hint: 'Supabase → Project Settings → API → "anon public". Safe for the browser when RLS is on.' }),
    field('Poll interval (seconds)', pollInput),
    el('div', { class: 'row', style: { gap: '8px' } }, button('Test connection', { variant: 'ghost', onClick: async () => {
      store.updateConfig({ sync: { ...draft } }); testOut.textContent = 'Testing…';
      const r = await sync.test();
      testOut.innerHTML = r.ok ? `<b style="color:var(--good)">✓ ${r.detail}</b>` : `<b style="color:var(--bad)">✗ ${r.detail}</b>`;
    } })),
    testOut,
  );

  openModal({
    title: 'Cloud Sync — shared team data', width: 600, body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Save & connect', variant: 'primary', onClick: (close) => { store.updateConfig({ sync: { ...draft } }); toast('Cloud Sync settings saved.', 'success'); close(); sync.start(renderRoute); } },
    ],
  });
}

// Cloud Sync status is surfaced in the ⋯ menu (see toolbar build below).
let syncStatus = { status: 'off', detail: '' };
sync.onStatus((st) => { syncStatus = st; });

// ---------------------------------------------------------------------------
// View preferences — light/dark theme + comfortable/compact density
// ---------------------------------------------------------------------------
const ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICON_ROWS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

function applyUiPrefs() {
  const ui = store.getConfig().ui || {};
  document.documentElement.dataset.theme = ui.theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('density-compact', ui.density === 'compact');
}
const themeBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnTheme', onClick: () => {
  const ui = store.getConfig().ui || {};
  store.updateConfig({ ui: { theme: ui.theme === 'light' ? 'dark' : 'light' } });
  applyUiPrefs(); syncViewButtons();
} });
const densityBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnDensity', html: ICON_ROWS, onClick: () => {
  const ui = store.getConfig().ui || {};
  store.updateConfig({ ui: { density: ui.density === 'compact' ? 'comfortable' : 'compact' } });
  applyUiPrefs(); syncViewButtons();
} });
function syncViewButtons() {
  const ui = store.getConfig().ui || {};
  themeBtn.innerHTML = ui.theme === 'light' ? ICON_MOON : ICON_SUN;
  themeBtn.title = ui.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  densityBtn.title = ui.density === 'compact' ? 'Comfortable density' : 'Compact density';
  densityBtn.style.opacity = ui.density === 'compact' ? '1' : '0.7';
}
const _actions = document.querySelector('.topbar__actions');
_actions.insertBefore(densityBtn, _actions.firstChild);
_actions.insertBefore(themeBtn, _actions.firstChild);
syncViewButtons();
applyUiPrefs();

// ---------------------------------------------------------------------------
// Command palette (⌘/Ctrl-K) — fast nav to modules, products & actions
// ---------------------------------------------------------------------------
let paletteOpen = false;
function buildCommands() {
  const go = (hash) => () => { location.hash = hash; };
  const cmds = [
    { icon: '▦', label: 'Dashboard', run: go('#/dashboard') },
    { icon: '📦', label: 'Product Testing', run: go('#/products') },
    { icon: '🎬', label: 'Creative Testing', run: go('#/creatives') },
    { icon: '📊', label: 'Daily Dashboard', run: go('#/daily') },
    { icon: '📄', label: 'Page Status', run: go('#/pages') },
    { icon: '✨', label: 'AI Content', run: go('#/content') },
    { icon: '🔍', label: 'Competitor Ads', run: go('#/competitors') },
    { icon: '＋', label: 'New product', hint: 'go to products', run: go('#/products') },
    { icon: '⬆', label: 'Export backup', run: () => document.getElementById('btnExport').click() },
    { icon: '⬇', label: 'Import backup', run: () => document.getElementById('btnImport').click() },
    { icon: '🤖', label: 'AI Settings', run: openAiSettings },
    { icon: '☁', label: 'Cloud Sync settings', run: openSyncSettings },
    { icon: '🌓', label: 'Toggle light / dark theme', run: () => themeBtn.click() },
    { icon: '≣', label: 'Toggle density', run: () => densityBtn.click() },
  ];
  store.getProducts().forEach((p) => cmds.push({ icon: '•', label: `${p.code} — ${p.name || ''}`.trim(), hint: 'product', keywords: `${p.code} ${p.name || ''}`.toLowerCase(), run: () => { location.hash = '#/products/' + encodeURIComponent(p.code); } }));
  return cmds;
}
function openCommandPalette() {
  if (paletteOpen) return; paletteOpen = true;
  const cmds = buildCommands();
  let filtered = cmds, sel = 0;
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal', style: { maxWidth: '560px', marginTop: '2vh' } });
  const search = el('input', { class: 'input', placeholder: 'Jump to a module, product or action…', style: { border: 'none', borderRadius: '0', fontSize: '15px', padding: '16px 18px', background: 'transparent' } });
  const listEl = el('div', { style: { maxHeight: '54vh', overflowY: 'auto', borderTop: '1px solid var(--border)' } });
  box.appendChild(search); box.appendChild(listEl); overlay.appendChild(box);
  function renderList() {
    clear(listEl);
    filtered.forEach((c, i) => {
      const row = el('div', { style: { padding: '10px 18px', cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'center', background: i === sel ? 'var(--surface-2)' : 'transparent' } },
        el('span', { style: { width: '18px', textAlign: 'center', opacity: '.85' }, text: c.icon || '›' }),
        el('span', { text: c.label }),
        c.hint ? el('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '11px' }, text: c.hint }) : null);
      row.addEventListener('mouseenter', () => { sel = i; paint(); });
      row.addEventListener('click', () => run(c));
      listEl.appendChild(row);
    });
    if (!filtered.length) listEl.appendChild(el('div', { class: 'muted', style: { padding: '16px 18px' }, text: 'No matches.' }));
  }
  function paint() { [...listEl.children].forEach((r, i) => { r.style.background = i === sel ? 'var(--surface-2)' : 'transparent'; }); }
  function filt() { const q = search.value.trim().toLowerCase(); filtered = q ? cmds.filter((c) => c.label.toLowerCase().includes(q) || (c.keywords || '').includes(q)) : cmds; sel = 0; renderList(); }
  function run(c) { close(); c.run(); }
  function close() { paletteOpen = false; document.removeEventListener('keydown', onKey, true); overlay.remove(); }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); paint(); listEl.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); listEl.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[sel]) run(filtered[sel]); }
  }
  search.addEventListener('input', filt);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  renderList();
  setTimeout(() => search.focus(), 30);
}
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openCommandPalette(); }
});
const searchBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnSearch', title: 'Search / jump (Ctrl-K)', onClick: openCommandPalette, html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><span style="margin-left:6px;opacity:.65;font-size:11px">⌘K</span>' });
_actions.insertBefore(searchBtn, _actions.firstChild);

// Condense the toolbar: fold Import / Export / Cloud Sync / AI Settings into a ⋯ menu.
['btnImport', 'btnExport', 'btnAiSettings'].forEach((id) => { const b = document.getElementById(id); if (b) b.style.display = 'none'; });
const moreBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnMore', title: 'More', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>' });
moreBtn.addEventListener('click', () => popoverMenu(moreBtn, [
  { label: 'Import backup', onClick: () => document.getElementById('importFile').click() },
  { label: 'Export backup', onClick: doExport },
  { divider: true },
  { label: 'Cloud Sync', hint: syncStatus.status, onClick: openSyncSettings },
  { label: 'AI Settings', onClick: openAiSettings },
]));
_actions.appendChild(moreBtn);

// expose for modules that need to open settings (e.g. AI buttons before config)
// and as a debugging affordance for this internal tool.
window.STRATOS = { openAiSettings, openSyncSettings, openCommandPalette, applyUiPrefs, refreshChrome, renderRoute, store, metrics, ai, sync };

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!location.hash) location.replace('#/dashboard');
refreshChrome();
renderRoute();
sync.start(renderRoute); // no-op until Cloud Sync is configured & enabled
