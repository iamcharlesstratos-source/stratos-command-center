// app.js — application entry point.
// Owns: hash routing, nav/active state, header summary chips, export/import,
// and the AI-settings modal (config only; ai.js consumes these settings later).

import * as store from './store.js';
import * as metrics from './metrics.js';
import * as ai from './ai.js';
import * as sync from './sync.js';
import * as auth from './auth.js';
import { el, clear, button, openModal, confirmDialog, toast, field, input, select, pageHeader, popoverMenu, orbitalMark, brandMark } from './ui.js';
import { todayStr } from './util.js';

// Module views (each exports `render(view, params)`).
import * as dashboard from './modules/dashboard.js';
import * as products from './modules/products.js';
import * as creatives from './modules/creatives.js';
import * as daily from './modules/daily.js';
import * as pages from './modules/pages.js';
import * as content from './modules/content.js';
import * as competitors from './modules/competitors.js';
import * as experiments from './modules/experiments.js';

const ROUTES = {
  dashboard, products, creatives, daily, pages, content, competitors, experiments,
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
    experiments: store.getExperiments().length,
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

  const backendSeg = segmented(['auto', 'groq', 'proxy', 'direct'], ai.backend, (v) => { state.backend = v; renderHint(); });
  const langSeg = segmented(['Taglish', 'English', 'Tagalog'], ai.language, (v) => { state.language = v; });

  const state = { ...ai };

  const groqKeyInput = input({ type: 'password', value: ai.groqKey || '', placeholder: 'gsk_…', onInput: (e) => state.groqKey = e.target.value.trim() });
  const keyInput = input({ type: 'password', value: ai.apiKey, placeholder: 'sk-ant-...', onInput: (e) => state.apiKey = e.target.value });
  const proxyInput = input({ value: ai.proxyUrl, placeholder: 'http://localhost:8787/ai', onInput: (e) => state.proxyUrl = e.target.value });
  const copyModelInput = input({ value: ai.copyModel, onInput: (e) => state.copyModel = e.target.value });
  const bulkModelInput = input({ value: ai.bulkModel, onInput: (e) => state.bulkModel = e.target.value });
  const maxTokInput = input({ type: 'number', value: ai.maxTokens, onInput: (e) => state.maxTokens = parseInt(e.target.value, 10) || 1024 });

  const hint = el('p', { class: 'field__hint' });
  function renderHint() {
    if (state.backend === 'groq') hint.innerHTML = '✅ <b>Groq mode (recommended) — FREE, no proxy.</b> Calls Groq directly from the browser. Get a free key (no card) at <b>console.groq.com/keys</b>. Key stays in this browser only.';
    else if (state.backend === 'direct') hint.innerHTML = '⚠️ <b>Anthropic direct — internal-use only.</b> Your key is stored in this browser and sent from the client.';
    else if (state.backend === 'proxy') hint.textContent = 'Proxy mode: requests go to your local proxy (run start-ai-proxy.bat). Holds the key server-side.';
    else hint.textContent = 'Auto: uses your Groq key if set (free, no proxy), else a configured proxy, else Anthropic direct.';
  }
  renderHint();

  const body = el('div', { class: 'stack' },
    field('🆓 Groq key (free — recommended)', groqKeyInput, { hint: 'Get one in 30s at console.groq.com/keys — works instantly, no terminal/proxy needed.' }),
    field('Backend', backendSeg, { hint: 'How AI requests are sent. "auto" just uses your Groq key.' }),
    hint,
    field('Anthropic API key (direct mode)', keyInput, { hint: 'Optional. Stored client-side. Used only for Anthropic direct calls.' }),
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
// View preferences — light/dark theme
// ---------------------------------------------------------------------------
const ICON_SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function applyUiPrefs() {
  const ui = store.getConfig().ui || {};
  document.documentElement.dataset.theme = ui.theme === 'light' ? 'light' : 'dark';
}
const themeBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnTheme', onClick: () => {
  const ui = store.getConfig().ui || {};
  store.updateConfig({ ui: { theme: ui.theme === 'light' ? 'dark' : 'light' } });
  applyUiPrefs(); syncViewButtons();
} });
function syncViewButtons() {
  const ui = store.getConfig().ui || {};
  themeBtn.innerHTML = ui.theme === 'light' ? ICON_MOON : ICON_SUN;
  themeBtn.title = ui.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
}
const _actions = document.querySelector('.topbar__actions');
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
    { icon: '📊', label: 'Daily Metrics', run: go('#/daily') },
    { icon: '📄', label: 'Page Status', run: go('#/pages') },
    { icon: '✨', label: 'AI Content', run: go('#/content') },
    { icon: '🔍', label: 'Competitor Ads', run: go('#/competitors') },
    { icon: '🧪', label: 'A/B Tests & Experiments', run: go('#/experiments') },
    { icon: '＋', label: 'New product', hint: 'go to products', run: go('#/products') },
    { icon: '⬆', label: 'Export backup', run: () => document.getElementById('btnExport').click() },
    { icon: '⬇', label: 'Import backup', run: () => document.getElementById('btnImport').click() },
    { icon: '🤖', label: 'AI Settings', run: openAiSettings },
    { icon: '☁', label: 'Cloud Sync settings', run: openSyncSettings },
    { icon: '🌓', label: 'Toggle light / dark theme', run: () => themeBtn.click() },
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

// ---------------------------------------------------------------------------
// Identity + role (Advertiser / Graphic Artist) + avatar
// ---------------------------------------------------------------------------
function initials(name, email) {
  const s = (name || (email || '').split('@')[0] || '?').trim();
  const parts = s.split(/\s+/);
  return (((parts[0] || '?')[0] || '?') + (parts[1] ? (parts[1][0] || '') : '')).toUpperCase();
}
/** A round avatar: the user's picture (data URL) or their initials. */
function avatarNode(user, size = 28) {
  const av = user && user.avatar;
  if (av) return el('img', { src: av, alt: '', class: 'avatar', style: { width: size + 'px', height: size + 'px' } });
  return el('span', { class: 'avatar avatar--initials', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' }, text: initials(user && user.name, user && user.email) });
}
/** Read an image File → square 128px JPEG data URL via canvas. cb(null) on failure. */
function fileToAvatar(file, cb) {
  if (!file || !/^image\//.test(file.type)) { cb(null); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      try {
        const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
        const ctx = c.getContext('2d');
        const scale = Math.max(S / img.width, S / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        cb(c.toDataURL('image/jpeg', 0.82));
      } catch (e) { cb(null); }
    };
    img.onerror = () => cb(null);
    img.src = reader.result;
  };
  reader.onerror = () => cb(null);
  reader.readAsDataURL(file);
}

// Edit display name + profile picture.
function openEditProfile() {
  const u = auth.current() || {};
  let avatar = u.avatar || (store.getConfig().ui || {}).avatar || '';
  const nameInput = input({ value: u.name || '', placeholder: 'Display name' });
  const preview = el('div', {});
  const renderPreview = () => { clear(preview); preview.appendChild(avatarNode({ name: nameInput.value, email: u.email, avatar }, 72)); };
  renderPreview();
  nameInput.addEventListener('input', renderPreview);
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) fileToAvatar(f, (d) => { if (d) { avatar = d; renderPreview(); } else toast('Hindi mabasa ang larawan.', 'error'); });
  });
  const msg = el('div', { class: 'field__hint', style: { color: 'var(--bad)' } });
  openModal({
    title: 'Edit profile', width: 420,
    body: el('div', { class: 'stack' },
      el('div', { class: 'row', style: { gap: '14px', alignItems: 'center' } },
        preview,
        el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          button('Upload picture', { variant: 'ghost', onClick: () => fileInput.click() }),
          button('Remove', { variant: 'subtle', onClick: () => { avatar = ''; renderPreview(); } }))),
      fileInput,
      field('Display name', nameInput, { hint: 'Ginagamit din bilang assignee sa creatives.' }),
      msg,
    ),
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Save', variant: 'primary', onClick: async (close) => {
        if (!nameInput.value.trim()) { msg.textContent = 'Kailangan ng display name.'; return; }
        try { await auth.updateProfile({ name: nameInput.value, avatar }); updateIdentityChip(); renderTeamPanel(); toast('Profile updated.', 'success'); close(); }
        catch (e) { msg.textContent = e.message; }
      } },
    ],
  });
}

function openIdentityModal() {
  const u = auth.current();
  const admin = auth.isAdmin();
  const local = auth.isLocal();
  const roleLine = local
    ? '📴 Local mode — pumasok ka sa device na ito (walang Supabase account). Gumagana pa rin ang Cloud Sync.'
    : u
      ? (admin ? '🛡️ Advertiser (admin) — full access sa lahat ng module at settings.'
               : '🎨 Graphic Artist — view + i-update ang mga creatives na assigned sa iyo. Read-only ang iba.')
      : 'Hindi naka-log in.';
  openModal({
    title: 'Account', width: 440,
    body: el('div', { class: 'stack' },
      el('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } },
        avatarNode(u || {}, 52),
        el('div', { style: { minWidth: '0' } },
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            el('b', { text: u ? u.name : 'Guest', style: { fontSize: '16px' } }),
            u ? el('span', { class: 'pill ' + (admin ? 'pill--good' : 'pill--neutral'), text: local ? u.role + ' (local)' : u.role }) : null),
          u && u.email ? el('div', { class: 'field__hint', style: { margin: '2px 0 0' }, text: u.email }) : null),
      ),
      el('p', { class: 'field__hint', text: roleLine }),
      el('div', { class: 'row', style: { gap: '8px', marginTop: '4px', flexWrap: 'wrap' } },
        button('Edit profile', { variant: 'ghost', onClick: openEditProfile }),
        local ? null : button('Change password', { variant: 'ghost', onClick: openChangePassword }),
        (!local && admin) ? button('Manage users', { variant: 'primary', onClick: openUserManagement }) : null,
      ),
    ),
    actions: [
      { label: 'Close', variant: 'ghost', onClick: (close) => close() },
      { label: 'Log out', variant: 'danger', onClick: async (close) => {
        close();
        try { await auth.signOut(); } catch (e) { /* ignore */ }
        location.reload();
      } },
    ],
  });
}

// Change the logged-in user's own password.
function openChangePassword() {
  const pw1 = input({ type: 'password', placeholder: 'New password', autocomplete: 'new-password' });
  const pw2 = input({ type: 'password', placeholder: 'Confirm new password', autocomplete: 'new-password' });
  const msg = el('div', { class: 'field__hint', style: { color: 'var(--bad)' } });
  openModal({
    title: 'Change password', width: 420,
    body: el('div', { class: 'stack' },
      field('New password', pw1, { hint: 'At least 6 characters.' }),
      field('Confirm new password', pw2),
      msg,
    ),
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Update password', variant: 'primary', onClick: async (close) => {
        msg.textContent = '';
        const a = pw1.value, b = pw2.value;
        if (a.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; return; }
        if (a !== b) { msg.textContent = 'Passwords do not match.'; return; }
        try { await auth.updatePassword(a); toast('Password updated.', 'success'); close(); }
        catch (e) { msg.textContent = e.message; }
      } },
    ],
  });
  setTimeout(() => pw1.focus(), 30);
}

// One-time Supabase setup for the team profiles table (roles + name + avatar).
const PROFILES_SETUP_SQL = `-- STRATOS — team profiles (roles + display name + avatar)
create table if not exists public.stratos_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'Graphic Artist',
  avatar text,
  updated_at timestamptz default now()
);
alter table public.stratos_profiles enable row level security;

create or replace function public.stratos_is_admin()
returns boolean language sql security definer stable as
$$ select exists(select 1 from public.stratos_profiles where id = auth.uid() and role = 'Advertiser') $$;

drop policy if exists "profiles read" on public.stratos_profiles;
create policy "profiles read" on public.stratos_profiles for select to authenticated using (true);
drop policy if exists "profiles insert self" on public.stratos_profiles;
create policy "profiles insert self" on public.stratos_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles update self" on public.stratos_profiles;
create policy "profiles update self" on public.stratos_profiles for update to authenticated using (id = auth.uid());
drop policy if exists "profiles update admin" on public.stratos_profiles;
create policy "profiles update admin" on public.stratos_profiles for update to authenticated using (public.stratos_is_admin());`;

function renderProfilesSetup() {
  const wrap = el('div', { class: 'stack', style: { gap: '8px' } });
  wrap.appendChild(el('p', { class: 'field__hint', text: 'I-set up ang User Management — isang beses lang: kopyahin ang SQL → Supabase → SQL Editor → paste → Run, tapos mag-log out / log in ulit.' }));
  const ta = el('textarea', { class: 'input', style: { fontFamily: 'var(--mono)', fontSize: '11px', height: '170px', whiteSpace: 'pre', width: '100%' } });
  ta.readOnly = true;
  ta.value = PROFILES_SETUP_SQL;
  ta.addEventListener('focus', () => ta.select());
  const copyBtn = button('📋 Copy SQL', { variant: 'primary', onClick: () => {
    const done = () => toast('Na-copy ang SQL — i-paste sa Supabase SQL Editor.', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(PROFILES_SETUP_SQL).then(done).catch(() => { ta.select(); done(); });
    else { ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } done(); }
  } });
  const sync = store.getConfig().sync || {};
  const m = (sync.url || '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  const dashUrl = m ? `https://supabase.com/dashboard/project/${m[1]}/sql/new` : 'https://supabase.com/dashboard';
  const openLink = el('a', { class: 'btn btn--ghost', href: dashUrl, target: '_blank', rel: 'noopener', text: 'Open SQL Editor ↗' });
  wrap.appendChild(ta);
  wrap.appendChild(el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, copyBtn, openLink));
  return wrap;
}

// Admin-only: view the team & change roles (writes to the stratos_profiles table).
function openUserManagement() {
  const host = el('div', { class: 'stack' });
  openModal({ title: 'User management', width: 620, body: host, actions: [{ label: 'Close', variant: 'ghost', onClick: (close) => close() }] });
  renderUsers();

  async function renderUsers() {
    clear(host);
    host.appendChild(el('p', { class: 'field__hint', text: 'Lahat ng naka-sign up sa workspace. Baguhin ang role kung kailangan — mag-aapply sa susunod nilang pag-login.' }));
    const loading = el('div', { class: 'loading', style: { padding: '8px 0' } }, orbitalMark(20, { spin: true }), el('span', { text: 'Loading team…' }));
    host.appendChild(loading);
    let users;
    try { users = await auth.listUsers(); }
    catch (e) {
      loading.remove();
      host.appendChild(el('p', { class: 'field__hint', style: { color: 'var(--bad)' }, text: e.message }));
      host.appendChild(renderProfilesSetup());
      return;
    }
    loading.remove();
    const me = auth.current();
    const list = el('div', { class: 'stack', style: { gap: '6px' } });
    if (!users.length) list.appendChild(el('p', { class: 'field__hint', text: 'Wala pang ibang users.' }));
    users.forEach((usr) => {
      const isSelf = me && usr.id === me.id;
      const roleSel = select(['Advertiser', 'Graphic Artist'], {
        value: usr.role === 'Advertiser' ? 'Advertiser' : 'Graphic Artist',
        onChange: async (e) => {
          const next = e.target.value;
          roleSel.disabled = true;
          try { await auth.setUserRole(usr.id, next); usr.role = next; toast(`${usr.name || usr.email}: ${next}`, 'success'); renderTeamPanel(); }
          catch (err) { toast(err.message, 'error'); roleSel.value = usr.role; }
          finally { roleSel.disabled = false; }
        },
      });
      roleSel.style.width = 'auto';
      const row = el('div', { class: 'spread', style: { padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', gap: '12px' } },
        el('div', { style: { minWidth: '0' } },
          el('div', { style: { fontWeight: '600' }, text: (usr.name || '(no name)') + (isSelf ? ' (ikaw)' : '') }),
          el('div', { class: 'field__hint', style: { margin: '0' }, text: usr.email || usr.id }),
        ),
        roleSel,
      );
      list.appendChild(row);
    });
    host.appendChild(list);
  }
}
const identityBtn = el('button', { class: 'btn btn--ghost btn--sm', id: 'btnIdentity', title: 'Account', onClick: openIdentityModal });
function updateIdentityChip() {
  const u = auth.current();
  const ui = store.getConfig().ui || {};
  const name = (u && u.name) || ui.userName || '';
  const r = (u && u.role) || ui.role || 'Advertiser';
  const user = { name, email: u && u.email, avatar: (u && u.avatar) || ui.avatar || '' };
  clear(identityBtn);
  identityBtn.appendChild(avatarNode(user, 20));
  identityBtn.appendChild(el('span', { text: name ? `${name} · ${r}` : 'Account', style: { marginLeft: '6px' } }));
}
_actions.insertBefore(identityBtn, _actions.firstChild);
updateIdentityChip();

// ---------------------------------------------------------------------------
// Sidebar team roster — Advertisers & Graphic Artists (from the profiles table)
// ---------------------------------------------------------------------------
const navTeamEl = document.getElementById('navTeam');
async function renderTeamPanel() {
  if (!navTeamEl) return;
  const me = auth.current();
  let users = [];
  try { if (auth.isConfigured()) users = await auth.listUsers(); } catch (e) { users = []; }
  if (!users.length && me) users = [{ id: me.id, name: me.name, email: me.email, role: me.role }];

  clear(navTeamEl);
  if (!users.length) return;

  const groupEl = (title, members) => {
    if (!members.length) return null;
    const wrap = el('div', { class: 'nav-team__group' }, el('div', { class: 'nav-team__label', text: `${title} · ${members.length}` }));
    members.forEach((m) => {
      const mine = me && m.id === me.id;
      wrap.appendChild(el('div', { class: 'nav-team__member' + (mine ? ' is-me' : ''), title: m.email || '' },
        avatarNode(m, 18),
        el('span', { class: 'nav-team__name', text: (m.name || (m.email || '').split('@')[0] || '—') + (mine ? ' (ikaw)' : '') })));
    });
    return wrap;
  };

  navTeamEl.appendChild(el('div', { class: 'nav-team__title', text: 'Team' }));
  const advs = users.filter((u) => u.role === 'Advertiser');
  const gas = users.filter((u) => u.role !== 'Advertiser');
  const g1 = groupEl('Advertisers', advs); if (g1) navTeamEl.appendChild(g1);
  const g2 = groupEl('Graphic Artists', gas); if (g2) navTeamEl.appendChild(g2);
  if (auth.isAdmin()) {
    const manage = el('a', { href: '#', class: 'nav-team__manage', text: '⚙ Manage users' });
    manage.addEventListener('click', (ev) => { ev.preventDefault(); openUserManagement(); });
    navTeamEl.appendChild(manage);
  }
}

// expose for modules that need to open settings (e.g. AI buttons before config)
// and as a debugging affordance for this internal tool.
window.STRATOS = { openAiSettings, openSyncSettings, openCommandPalette, applyUiPrefs, refreshChrome, renderRoute, renderTeamPanel, store, metrics, ai, sync, auth, isAdmin: () => auth.isAdmin() };

// ---------------------------------------------------------------------------
// Role gating — hide admin-only chrome for Graphic Artists
// ---------------------------------------------------------------------------
function applyRoleGating() {
  const admin = auth.isAdmin();
  document.body.classList.toggle('role-artist', !admin);
  // The ⋯ menu holds Import / Export / Cloud Sync / AI Settings — admin-only.
  if (moreBtn) moreBtn.style.display = admin ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Login screen (full-screen gate; real Supabase Auth)
// ---------------------------------------------------------------------------
function showLogin() {
  return new Promise((resolve) => {
    let mode = 'signin';        // 'signin' | 'signup'
    let pendingMsg = null;      // { kind:'ok'|'bad', text } carried across re-renders
    const overlay = el('div', { class: 'auth-overlay' });
    const card = el('div', { class: 'auth-card' });
    overlay.appendChild(card);

    function render() {
      clear(card);
      const brand = el('div', { class: 'auth-brand' });
      brand.appendChild(brandMark(44));
      brand.appendChild(el('div', { class: 'auth-brand__name' },
        el('div', { text: 'Marketing' }),
        el('div', {}, el('span', { class: 'brand__accent', text: 'Command' }), document.createTextNode(' Center')),
      ));
      card.appendChild(brand);
      card.appendChild(el('div', { class: 'auth-sub', text: mode === 'signin' ? 'Log in to continue' : 'Create a new account' }));

      const msg = el('div', { class: 'auth-msg' });
      if (pendingMsg) { msg.classList.add(pendingMsg.kind === 'ok' ? 'auth-msg--ok' : 'auth-msg--bad'); msg.textContent = pendingMsg.text; pendingMsg = null; }

      // Workspace fields only while the Supabase project isn't connected yet.
      let wsUrl = null, wsKey = null;
      if (!auth.isConfigured()) {
        const s = store.getConfig().sync || {};
        wsUrl = input({ value: s.url || '', placeholder: 'https://xxxx.supabase.co', autocomplete: 'off' });
        wsKey = input({ value: s.anonKey || '', placeholder: 'anon public key', type: 'password', autocomplete: 'off' });
        card.appendChild(el('div', { class: 'auth-note', text: 'First, connect the team workspace (Supabase → Settings → API).' }));
        card.appendChild(field('Workspace URL', wsUrl));
        card.appendChild(field('Workspace key (anon public)', wsKey));
      }

      const nameInput = input({ placeholder: 'Name (e.g. Charles)', autocomplete: 'name' });
      const emailInput = input({ type: 'email', placeholder: 'you@email.com', autocomplete: 'username' });
      const pwInput = input({ type: 'password', placeholder: '••••••••', autocomplete: mode === 'signin' ? 'current-password' : 'new-password' });
      let roleSeg = null;

      if (mode === 'signup') card.appendChild(field('Name', nameInput));
      card.appendChild(field('Email', emailInput));
      card.appendChild(field('Password', pwInput, mode === 'signup' ? { hint: 'At least 6 characters.' } : undefined));
      if (mode === 'signup') {
        roleSeg = segmented(['Advertiser', 'Graphic Artist'], 'Advertiser', () => {});
        card.appendChild(field('Role', roleSeg, { hint: 'Advertiser = admin (full access). Graphic Artist = view + own creatives only.' }));
      }

      card.appendChild(msg);
      const submit = button(mode === 'signin' ? 'Log in' : 'Create account', { variant: 'primary', full: true, onClick: doSubmit });
      card.appendChild(submit);

      const switchRow = el('div', { class: 'auth-switch' },
        el('span', { class: 'muted', text: mode === 'signin' ? "Don't have an account? " : 'Already have an account? ' }),
        el('a', { href: '#', text: mode === 'signin' ? 'Sign up' : 'Log in' }),
      );
      switchRow.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); mode = mode === 'signin' ? 'signup' : 'signin'; render(); });
      card.appendChild(switchRow);

      // Escape hatch — get into the app on THIS device without a Supabase account.
      const localRow = el('div', { class: 'auth-local' },
        el('a', { href: '#', text: 'Hindi gumagana ang login? Pumasok sa device na ito →' }));
      localRow.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        const user = auth.signInLocal((nameInput.value || '').trim() || 'Admin');
        overlay.remove();
        resolve(user);
      });
      card.appendChild(localRow);

      [nameInput, emailInput, pwInput].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } }));
      setTimeout(() => (mode === 'signup' ? nameInput : emailInput).focus(), 30);

      function setBusy(b) {
        submit.disabled = b;
        const lbl = submit.querySelector('span:last-child');
        if (lbl) lbl.textContent = b ? 'Please wait…' : (mode === 'signin' ? 'Log in' : 'Create account');
      }

      async function doSubmit() {
        msg.className = 'auth-msg';
        msg.textContent = '';
        setBusy(true);
        try {
          if (wsUrl && wsKey) {
            const url = wsUrl.value.trim(), key = wsKey.value.trim();
            if (!url || !key) throw new Error('Workspace URL and key are required.');
            store.updateConfig({ sync: { url, anonKey: key, enabled: true } });
          }
          if (!auth.isConfigured()) throw new Error('Workspace settings are incomplete (URL + key).');
          const email = emailInput.value.trim();
          const pw = pwInput.value;
          if (!email || !pw) throw new Error('Email and password are required.');
          let user;
          if (mode === 'signup') {
            const activeBtn = roleSeg.querySelector('button.active');
            const roleVal = (activeBtn ? activeBtn.textContent : 'Advertiser').trim();
            user = await auth.signUp(email, pw, { role: roleVal, name: nameInput.value.trim() });
          } else {
            user = await auth.signIn(email, pw);
          }
          overlay.remove();
          resolve(user);
        } catch (e) {
          if (e.message === 'CONFIRM_EMAIL') {
            pendingMsg = { kind: 'ok', text: '✅ Account created! Check your email to confirm, then log in.' };
            mode = 'signin';
            render();
          } else {
            msg.className = 'auth-msg auth-msg--bad';
            msg.textContent = e.message;
            setBusy(false);
          }
        }
      }
    }

    render();
    document.body.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// Boot — gate the whole app behind login
// ---------------------------------------------------------------------------
(async () => {
  let user = null;
  if (auth.isConfigured() || auth.hasStoredSession()) { try { user = await auth.init(); } catch (e) { /* expired / offline → fall through to login */ } }
  if (!user) { try { user = await showLogin(); } catch (e) { /* user closed? keep gated */ } }
  if (user) store.updateConfig({ ui: { role: user.role, userName: user.name } });

  updateIdentityChip();
  applyRoleGating();
  renderTeamPanel();

  if (!location.hash) {
    const role = (store.getConfig().ui || {}).role;
    location.replace(role === 'Graphic Artist' ? '#/creatives' : '#/dashboard');
  }
  refreshChrome();
  renderRoute();
  sync.start(renderRoute); // no-op until Cloud Sync is configured & enabled
})();
