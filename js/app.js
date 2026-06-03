// app.js — application entry point.
// Owns: hash routing, nav/active state, header summary chips, export/import,
// and the AI-settings modal (config only; ai.js consumes these settings later).

import * as store from './store.js';
import * as metrics from './metrics.js';
import * as ai from './ai.js';
import * as sync from './sync.js';
import { el, clear, button, openModal, confirmDialog, toast, field, input, pageHeader } from './ui.js';
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

// header sync chip (inserted before the AI Settings button)
const syncBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnSync', title: 'Cloud Sync', onClick: openSyncSettings, html: '<span class="chip__dot chip__dot--neutral" id="syncDot" style="margin-right:2px"></span><span id="syncLbl">Sync</span>' });
document.querySelector('.topbar__actions').insertBefore(syncBtn, document.getElementById('btnAiSettings'));
function updateSyncChip(st) {
  const labels = { off: 'Sync off', connecting: 'Connecting…', syncing: 'Syncing…', synced: 'Synced', error: 'Sync error' };
  const tones = { off: 'neutral', connecting: 'warn', syncing: 'warn', synced: 'good', error: 'bad' };
  const lbl = syncBtn.querySelector('#syncLbl'); const dot = syncBtn.querySelector('#syncDot');
  if (lbl) lbl.textContent = labels[st.status] || 'Sync';
  if (dot) dot.className = 'chip__dot chip__dot--' + (tones[st.status] || 'neutral');
  syncBtn.style.marginRight = '0';
  syncBtn.title = 'Cloud Sync' + (st.detail ? ' — ' + st.detail : '');
}
sync.onStatus(updateSyncChip);

// expose for modules that need to open settings (e.g. AI buttons before config)
// and as a debugging affordance for this internal tool.
window.STRATOS = { openAiSettings, openSyncSettings, refreshChrome, renderRoute, store, metrics, ai, sync };

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!location.hash) location.replace('#/dashboard');
refreshChrome();
renderRoute();
sync.start(renderRoute); // no-op until Cloud Sync is configured & enabled
