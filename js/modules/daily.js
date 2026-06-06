// daily.js — Module 3: Daily Marketing Dashboard.
//
// Enter raw daily inputs (spend/revenue/impressions/clicks/purchases) per
// product for a chosen date; everything else is computed live by metrics.js:
// ROAS/CPP/CPM/CTR, Scale/Observe/Kill labels (which feed Module 1's "Scaling"
// tag), today-vs-yesterday comparison, scaling recommendations and the page
// performance table (which reuses these same per-product metrics).

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import * as ai from '../ai.js';
import * as meta from '../meta.js';
import {
  el, clear, button, pill, field, input, select, sortableTable, pageHeader, card,
  statTile, toast, emptyState, textarea, openModal, sparkline, dateRangeControl, confirmDialog,
} from '../ui.js';
import { todayStr, yesterdayStr, toNum, debounce, resolveRange, inRange, nowISO } from '../util.js';

let selectedDate = todayStr();
let autoPulledFor = ''; // guards the once-per-open auto-sync from looping

// Advertisers are admins; Graphic Artists view metrics read-only (no entry/import).
const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();

// subtle performance tints (work on both themes)
const HEAT = { good: 'rgba(45,212,167,0.18)', warn: 'rgba(245,185,69,0.16)', bad: 'rgba(244,80,107,0.16)' };
const roasHeat = (r, cfg) => { const l = metrics.labelForRoas(r, cfg.thresholds); return l === 'Scale' ? HEAT.good : l === 'Observe' ? HEAT.warn : l === 'Kill' ? HEAT.bad : null; };
const profitHeat = (prof, spend) => { const l = metrics.profitLabel(prof, spend); return l === 'Profitable' ? HEAT.good : l === 'Breakeven' ? HEAT.warn : l === 'Bleeding' ? HEAT.bad : null; };

export function render(view) {
  const products = store.getProducts();
  const cfg = store.getConfig();

  // ---- header + date picker ----
  const mc = store.getMetaConfig();
  const connected = !!(mc.token && mc.accountId);
  const metaBtns = isAdmin()
    ? (connected
        ? [
            button('⤓ Sync Meta', { variant: 'primary', title: `Pull ${mc.accountName || ('act ' + mc.accountId)} for ${selectedDate}`, onClick: () => syncMeta(view, selectedDate, false) }),
            button('⚙', { variant: 'ghost', title: 'Meta connection settings', onClick: () => openMetaConnect(view) }),
          ]
        : [button('🔗 Connect Meta', { variant: 'ghost', onClick: () => openMetaConnect(view) })])
    : [];

  const dateInput = el('input', { class: 'input', type: 'date', value: selectedDate, style: { width: 'auto' } });
  dateInput.addEventListener('change', () => { selectedDate = dateInput.value || todayStr(); rerender(view); });
  view.appendChild(pageHeader(
    'Daily Metrics',
    'Which product is winning, losing, or ready to scale — for the selected day.',
    [
      ...metaBtns,
      isAdmin() ? button('⇪ Paste import', { variant: 'ghost', onClick: () => openImportModal(view) }) : null,
      el('div', { class: 'row', style: { alignItems: 'center', gap: '8px' } },
        el('span', { class: 'field__label', text: 'Date' }), dateInput),
    ].filter(Boolean),
  ));

  // Auto-pull today's numbers once per app-open when connected + enabled.
  if (connected && mc.autoPull && selectedDate === todayStr() && autoPulledFor !== selectedDate) {
    autoPulledFor = selectedDate;
    syncMeta(view, selectedDate, true);
  }

  if (!products.length) {
    view.appendChild(emptyState('Add products first (Module 1) before logging daily metrics.',
      button('Go to products', { variant: 'primary', onClick: () => { location.hash = '#/products'; } })));
    return;
  }

  // ---- range performance (Meta-style date-range analytics) ----
  view.appendChild(renderRangeSummary(view, cfg));

  const yday = yesterdayStr(selectedDate);

  // ---- totals for the day ----
  const dayRows = store.getDailyMetricsByDate(selectedDate);
  const agg = metrics.aggregate(dayRows);
  const dayProfit = dayRows.reduce((s, r) => s + metrics.profit(r, store.getProduct(r.productCode)), 0);
  const margin = metrics.profitLabel(dayProfit, agg.spend);
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Ad spend', metrics.fmt(agg.spend, 'peso'), { sub: `${dayRows.length} product(s) logged` }),
    statTile('Revenue', metrics.fmt(agg.revenue, 'peso'), { tone: agg.revenue >= agg.spend ? 'good' : 'bad' }),
    statTile('Blended ROAS', metrics.fmt(agg.roas, 'roas'), { tone: roasTone(agg.roas, cfg) }),
    statTile('Est. profit', metrics.fmt(dayProfit, 'peso'), { tone: dayProfit > 0 ? 'good' : dayProfit < 0 ? 'bad' : 'warn', sub: margin ? margin + ' (after COGS)' : 'set product cost/shipping' }),
  ));
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile('Purchases', String(agg.purchases), { sub: 'total orders' }),
    statTile('CPP', metrics.fmt(agg.cpp, 'cpp')),
    statTile('CPM', metrics.fmt(agg.cpm, 'cpm')),
    statTile('CTR', metrics.fmt(agg.ctr, 'ctr')),
  ));

  // ---- entry grid (Advertiser-only; artists see metrics read-only) ----
  if (isAdmin()) {
    view.appendChild(renderEntry(view, products));
  } else {
    view.appendChild(el('div', { class: 'banner banner--info', style: { marginBottom: 'var(--gap)' } },
      el('span', { text: '👁️ Read-only — you\'re a Graphic Artist. Only Advertisers enter daily metrics.' })));
  }

  // ---- scaling recommendations ----
  view.appendChild(renderRecommendations(products, cfg));

  // ---- product performance (today vs yesterday) ----
  view.appendChild(renderPerformance(products, yday, cfg));

  // ---- yesterday winners & losers ----
  view.appendChild(renderWinnersLosers(products, yday, cfg));

  // ---- page performance (reuses per-product metrics) ----
  view.appendChild(renderPagePerformance(cfg));

  // ---- AI daily report (button wired in Phase 4) ----
  view.appendChild(renderReportPanel());
}

function rerender(view) { clear(view); render(view); }
function roasTone(r, cfg) {
  const label = metrics.labelForRoas(r, cfg.thresholds);
  return label === 'Scale' ? 'good' : label === 'Observe' ? 'warn' : label === 'Kill' ? 'bad' : undefined;
}

// ---------------------------------------------------------------------------
// Meta (Facebook) Ads — connect once, then auto-fill Daily Metrics
// ---------------------------------------------------------------------------
async function syncMeta(view, dateStr, silent) {
  const mc = store.getMetaConfig();
  if (!mc.token || !mc.accountId) { openMetaConnect(view); return; }
  if (!silent) toast('Pulling from Meta…', 'info');
  try {
    const rows = await meta.pullDay(mc.token, mc.accountId, dateStr);
    const products = store.getProducts();
    const { byCode, unmapped } = meta.mapRowsToProducts(rows, products);
    const codes = Object.keys(byCode);
    for (const code of codes) {
      const m = byCode[code];
      store.upsertDailyMetric({ productCode: code, date: dateStr, spend: round2(m.spend), revenue: Math.round(m.revenue), impressions: Math.round(m.impressions), clicks: Math.round(m.clicks), purchases: Math.round(m.purchases) });
      metrics.recomputeStatus(code);
    }
    store.setMetaConfig({ lastPull: dateStr, lastPullAt: nowISO() });
    if (dateStr === todayStr()) autoPulledFor = dateStr; // don't double-pull on the follow-up render
    if (codes.length || !silent) {
      toast(`Synced ${codes.length} product(s) from Meta for ${dateStr}${unmapped.length ? ` · ${unmapped.length} campaign(s) unmapped` : ''}.`, codes.length ? 'success' : 'warn');
    }
    if (unmapped.length && !silent) {
      console.info('[meta] unmapped campaigns (no product code found in name):', unmapped);
    }
    rerender(view);
  } catch (err) {
    toast(`Meta sync failed: ${err.message}`, 'error');
  }
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function openMetaConnect(view) {
  const mc = store.getMetaConfig();
  const tokenInput = el('input', { class: 'input', type: 'password', value: mc.token || '', placeholder: 'Paste Meta access token (ads_read)…' });
  let accountSel = select([{ value: mc.accountId || '', label: mc.accountId ? (mc.accountName || ('act ' + mc.accountId)) : '— fetch accounts first —' }], { value: mc.accountId || '' });
  const accountWrap = el('div', {}, accountSel);
  const autoChk = el('input', { type: 'checkbox' }); autoChk.checked = mc.autoPull !== false;
  const statusLine = el('div', { class: 'field__hint', style: { minHeight: '16px' } });

  let accounts = [];
  const fetchBtn = button('Fetch accounts', { variant: 'ghost', onClick: async () => {
    const tok = tokenInput.value.trim();
    if (!tok) { statusLine.textContent = 'Paste a token first.'; statusLine.style.color = 'var(--warn)'; return; }
    statusLine.textContent = 'Fetching ad accounts…'; statusLine.style.color = '';
    try {
      accounts = await meta.listAccounts(tok);
      if (!accounts.length) { statusLine.textContent = 'No ad accounts visible to this token.'; statusLine.style.color = 'var(--warn)'; return; }
      const newSel = select(accounts.map((a) => ({ value: a.accountId, label: `${a.name} (act_${a.accountId})${a.currency ? ' · ' + a.currency : ''}` })), { value: mc.accountId || accounts[0].accountId });
      clear(accountWrap); accountWrap.appendChild(newSel); accountSel = newSel;
      statusLine.textContent = `Found ${accounts.length} ad account(s). Pick one and Save.`; statusLine.style.color = 'var(--good)';
    } catch (err) {
      statusLine.textContent = `Could not fetch: ${err.message}`; statusLine.style.color = 'var(--bad)';
    }
  } });

  const body = el('div', { class: 'stack' },
    el('div', { class: 'banner banner--info' }, el('span', { text: '🔒 Your token stays on THIS device only — it is never synced to the team or included in backups. Use a read-only (ads_read) token.' })),
    field('Access token', el('div', { class: 'row', style: { gap: '8px' } }, tokenInput, fetchBtn), { hint: 'Get one at developers.facebook.com → Tools → Graph API Explorer (permission: ads_read), or a System User token for long life.' }),
    field('Ad account', accountWrap),
    el('label', { class: 'row', style: { gap: '8px', alignItems: 'center', cursor: 'pointer' } }, autoChk, el('span', { text: 'Auto-pull today’s numbers when I open the app' })),
    statusLine,
    el('p', { class: 'field__hint', text: 'Mapping: each campaign is matched to a product by finding the product CODE inside the campaign name (e.g. “GINKGO-01 - Senior - ABO” → GINKGO-01). Name campaigns with the code for clean auto-fill.' }),
  );

  openModal({
    title: 'Connect Meta (Facebook Ads)', width: 600, body,
    actions: [
      mc.token ? { label: 'Disconnect', variant: 'ghost', onClick: async (close) => {
        if (await confirmDialog({ title: 'Disconnect Meta?', message: 'Removes the token from this device. Imported data stays.', confirmText: 'Disconnect', danger: true })) {
          store.disconnectMeta(); toast('Meta disconnected.', 'success'); close(); rerender(view);
        }
      } } : null,
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Save', variant: 'primary', onClick: (close) => {
        const tok = tokenInput.value.trim();
        const acct = accountSel.value;
        if (!tok) { statusLine.textContent = 'Paste a token first.'; statusLine.style.color = 'var(--warn)'; return; }
        if (!acct) { statusLine.textContent = 'Fetch and pick an ad account.'; statusLine.style.color = 'var(--warn)'; return; }
        const found = accounts.find((a) => a.accountId === acct);
        store.setMetaConfig({ token: tok, accountId: acct, accountName: found ? found.name : (mc.accountName || ''), autoPull: autoChk.checked });
        autoPulledFor = ''; // allow an immediate auto/sync after (re)connect
        toast('Meta connected. Hit “⤓ Sync Meta” or it auto-pulls today.', 'success');
        close(); rerender(view);
      } },
    ].filter(Boolean),
  });
}

// ---------------------------------------------------------------------------
// Range performance — Meta-style date-range analytics + Week-over-Week deltas
// ---------------------------------------------------------------------------
function shiftDay(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayStr(d);
}
function dayCount(since, until) {
  const a = new Date(`${since}T00:00:00`), b = new Date(`${until}T00:00:00`);
  return Math.round((b - a) / 86400000) + 1;
}
function deltaPct(cur, prev) {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
function deltaNode(cur, prev) {
  const d = deltaPct(cur, prev);
  if (d === null) return el('span', { class: 'muted', style: { fontSize: '11px' }, text: 'vs — ' });
  const up = d >= 0;
  return el('span', { style: { fontSize: '11px', color: up ? 'var(--good)' : 'var(--bad)' }, text: `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}% vs prev` });
}

function renderRangeSummary(view, cfg) {
  const range = store.getDateRange();
  const rr = resolveRange(range);
  const picker = dateRangeControl({ value: range, onChange: (resolved, raw) => { store.setDateRange(raw); rerender(view); } });

  const all = store.getDailyMetrics();
  const rows = all.filter((r) => inRange(r.date, rr));
  const agg = metrics.aggregate(rows);
  const profit = rows.reduce((s, r) => s + metrics.profit(r, store.getProduct(r.productCode)), 0);

  // Previous equal-length window (only when the range is bounded)
  let prev = null;
  if (rr.since && rr.until && rr.until !== '9999-12-31') {
    const n = dayCount(rr.since, rr.until);
    const pUntil = shiftDay(rr.since, -1);
    const pSince = shiftDay(pUntil, -(n - 1));
    const pRows = all.filter((r) => r.date >= pSince && r.date <= pUntil);
    prev = { agg: metrics.aggregate(pRows), label: `${pSince} → ${pUntil}` };
  }

  const c = el('section', { class: 'card' });
  c.appendChild(el('div', { class: 'spread', style: { alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
    el('div', {}, el('h3', { class: 'card__title', style: { margin: 0 }, text: '📅 Range performance' }),
      el('span', { class: 'field__hint', text: `${rr.label}${rr.since ? ` · ${rr.since} → ${rr.until === '9999-12-31' ? 'today' : rr.until}` : ''}` })),
    picker));

  if (!rows.length) {
    c.appendChild(el('p', { class: 'muted', style: { margin: '10px 0 0' }, text: 'No daily metrics logged in this range yet.' }));
    return c;
  }

  const tile = (label, value, sub, deltaArgs) => el('div', { class: 'stat-tile' },
    el('div', { class: 'stat-tile__value', text: value }),
    el('div', { class: 'stat-tile__label', text: label }),
    deltaArgs ? el('div', { class: 'stat-tile__sub' }, deltaNode(deltaArgs[0], deltaArgs[1])) : (sub ? el('div', { class: 'stat-tile__sub', text: sub }) : null));

  c.appendChild(el('div', { class: 'grid grid-4', style: { marginTop: '12px' } },
    tile('Ad spend', metrics.fmt(agg.spend, 'peso'), `${rows.length} row(s)`, prev ? [agg.spend, prev.agg.spend] : null),
    tile('Revenue', metrics.fmt(agg.revenue, 'peso'), null, prev ? [agg.revenue, prev.agg.revenue] : null),
    tile('Blended ROAS', metrics.fmt(agg.roas, 'roas'), null, prev ? [agg.roas || 0, prev.agg.roas || 0] : null),
    tile('Est. profit', metrics.fmt(profit, 'peso'), 'after COGS', null)));

  // Per-product rollup over the range
  const byCode = {};
  for (const r of rows) {
    (byCode[r.productCode] = byCode[r.productCode] || []).push(r);
  }
  const prodRows = Object.entries(byCode).map(([code, rs]) => {
    const a = metrics.aggregate(rs);
    const pr = rs.reduce((s, r) => s + metrics.profit(r, store.getProduct(r.productCode)), 0);
    return { code, ...a, profit: pr, days: rs.length };
  });

  const columns = [
    { key: 'code', label: 'Product', render: (r) => el('span', { class: 'code-badge', text: r.code || '—' }) },
    { key: 'spend', label: 'Spend', align: 'right', sortValue: (r) => r.spend, render: (r) => metrics.fmt(r.spend, 'peso') },
    { key: 'revenue', label: 'Revenue', align: 'right', sortValue: (r) => r.revenue, render: (r) => metrics.fmt(r.revenue, 'peso') },
    { key: 'roas', label: 'ROAS', align: 'right', sortValue: (r) => r.roas ?? -1, cellBg: (r) => roasHeat(r.roas, cfg), render: (r) => metrics.fmt(r.roas, 'roas') },
    { key: 'cpp', label: 'CPP', align: 'right', sortValue: (r) => r.cpp ?? Infinity, render: (r) => metrics.fmt(r.cpp, 'cpp') },
    { key: 'purchases', label: 'Orders', align: 'right', sortValue: (r) => r.purchases, render: (r) => String(r.purchases) },
    { key: 'profit', label: 'Profit', align: 'right', sortValue: (r) => r.profit, cellBg: (r) => profitHeat(r.profit, r.spend), render: (r) => metrics.fmt(r.profit, 'peso') },
  ];
  c.appendChild(el('div', { style: { marginTop: '12px' } },
    sortableTable(columns, prodRows, { sort: { key: 'spend', dir: 'desc' }, onRowClick: (r) => { location.hash = '#/products/' + encodeURIComponent(r.code); } })));
  if (prev) c.appendChild(el('p', { class: 'field__hint', style: { marginTop: '8px' }, text: `▲▼ compares to the previous ${dayCount(rr.since, rr.until)} day(s): ${prev.label}.` }));
  return c;
}

// ---------------------------------------------------------------------------
// Daily entry grid
// ---------------------------------------------------------------------------
function renderEntry(view, products) {
  const draft = {}; // code -> {spend,revenue,impressions,clicks,purchases}
  products.forEach((p) => {
    const existing = store.getDailyMetric(p.code, selectedDate);
    draft[p.code] = existing
      ? { spend: existing.spend, revenue: existing.revenue, impressions: existing.impressions, clicks: existing.clicks, purchases: existing.purchases }
      : { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 };
  });

  const liveCells = {}; // code -> {roas, cpp}
  const fields = ['spend', 'revenue', 'impressions', 'clicks', 'purchases'];

  const columns = [
    { key: 'code', label: 'Product', sortable: false, render: (p) => el('div', {},
      el('span', { class: 'code-badge', text: p.code }),
      el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px' }, text: p.name || '' })) },
    ...fields.map((f) => ({
      key: f, label: f === 'impressions' ? 'Impr.' : f[0].toUpperCase() + f.slice(1), sortable: false, align: 'right',
      render: (p) => {
        const inp = el('input', { class: 'input', type: 'number', step: 'any', value: draft[p.code][f], style: { width: '92px', textAlign: 'right' } });
        inp.addEventListener('input', () => { draft[p.code][f] = toNum(inp.value); updateLive(p.code); });
        return inp;
      },
    })),
    { key: 'roas', label: 'ROAS', sortable: false, align: 'right', render: (p) => {
      const span = el('span', { class: 'mono' }); liveCells[p.code] = liveCells[p.code] || {}; liveCells[p.code].roas = span; return span; } },
    { key: 'label', label: 'Call', sortable: false, align: 'center', render: (p) => {
      const slot = el('span', {}); liveCells[p.code] = liveCells[p.code] || {}; liveCells[p.code].label = slot; return slot; } },
  ];

  const cfg = store.getConfig();
  function updateLive(code) {
    const m = metrics.computeMetrics(draft[code]);
    const cells = liveCells[code];
    if (cells?.roas) cells.roas.textContent = metrics.fmt(m.roas, 'roas');
    if (cells?.label) { clear(cells.label); const lbl = metrics.labelForRoas(m.roas, cfg.thresholds); cells.label.appendChild(lbl ? pill(lbl) : document.createTextNode('—')); }
  }

  const table = sortableTable(columns, products, { empty: 'No products.' });
  // initialize live cells
  setTimeout(() => products.forEach((p) => updateLive(p.code)), 0);

  const saveBtn = button('Save day', { variant: 'primary', onClick: () => {
    let saved = 0;
    products.forEach((p) => {
      const d = draft[p.code];
      const hasData = fields.some((f) => toNum(d[f]) !== 0);
      const existing = store.getDailyMetric(p.code, selectedDate);
      if (hasData) { store.upsertDailyMetric({ productCode: p.code, date: selectedDate, ...d }); saved++; }
      else if (existing) { store.deleteDailyMetric(existing.id); } // cleared row → remove
    });
    metrics.recomputeAllStatuses(); // metrics drive Module 1 "Scaling" tag
    toast(`Saved ${saved} product row(s) for ${selectedDate}.`, 'success');
    rerender(view);
  } });

  return card('Daily Inputs — ' + selectedDate,
    el('p', { class: 'field__hint', style: { marginTop: '-6px' }, text: 'Enter raw numbers; ROAS & the Scale/Observe/Kill call compute live. Saving re-tags product status.' }),
    table,
    el('div', { class: 'row', style: { marginTop: '12px', justifyContent: 'flex-end' } }, saveBtn),
  );
}

// ---------------------------------------------------------------------------
// Scaling recommendation panel
// ---------------------------------------------------------------------------
function renderRecommendations(products, cfg) {
  const buckets = { Scale: [], Observe: [], Kill: [] };
  products.forEach((p) => {
    const m = store.getDailyMetric(p.code, selectedDate);
    if (!m) return;
    const r = metrics.roas(toNum(m.revenue), toNum(m.spend));
    const label = metrics.labelForRoas(r, cfg.thresholds);
    if (label) buckets[label].push({ p, r });
  });

  const col = (title, tone, items, advice) => {
    const c = el('div', { class: 'card', style: { borderTop: `2px solid var(--${tone})` } });
    c.appendChild(el('div', { class: 'spread' }, el('h3', { class: 'card__title', style: { margin: 0 }, text: title }), pill(title)));
    c.appendChild(el('p', { class: 'field__hint', text: advice }));
    if (!items.length) c.appendChild(el('p', { class: 'muted', style: { margin: 0 }, text: 'None today.' }));
    items.sort((a, b) => (b.r ?? 0) - (a.r ?? 0)).forEach(({ p, r }) => {
      c.appendChild(el('div', { class: 'spread', style: { padding: '6px 0', borderTop: '1px solid var(--border)' } },
        el('a', { href: `#/products/${encodeURIComponent(p.code)}` }, el('span', { class: 'code-badge', text: p.code })),
        el('span', { class: 'mono', text: metrics.fmt(r, 'roas') })));
    });
    return c;
  };

  const diagnose = () => {
    if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
    const losers = products.map((p) => {
      const m = store.getDailyMetric(p.code, selectedDate);
      if (!m) return null;
      const cm = metrics.computeMetrics(m);
      return { p, cm, label: metrics.labelForRoas(cm.roas, cfg.thresholds), prof: metrics.profit(m, p) };
    }).filter(Boolean).filter((x) => x.label === 'Kill' || x.prof < 0);
    if (!losers.length) { toast('No losers or bleeders today — nothing to diagnose. 🎉', 'info'); return; }
    const ctx = losers.map((x) => `${x.p.code} (${x.p.name}): ROAS ${metrics.fmt(x.cm.roas, 'roas')}, CPP ${metrics.fmt(x.cm.cpp, 'cpp')}, CTR ${metrics.fmt(x.cm.ctr, 'ctr')}, profit ${metrics.fmt(x.prof, 'peso')}. Pain points: ${(x.p.painPoints || []).join('; ') || '—'}. Offer: ${x.p.offer?.mechanism || '—'}.`).join('\n');
    ai.openAiEditor({
      title: `Diagnose losers — ${selectedDate}`,
      system: `${ai.languageDirective()} You are a performance-marketing diagnostician for PH Facebook/TikTok direct-response.`,
      user: `These products are losing or bleeding on ${selectedDate}:\n${ctx}\n\nFor EACH product give: 1) the most likely WHY it's losing (creative / offer / audience / pricing), and 2) the single highest-priority thing to TEST next. Be specific and concise.`,
      saveLabel: 'Save to daily report',
      onSave: (t) => { const prev = store.getDailyReport(selectedDate); store.saveDailyReport(selectedDate, (prev ? prev + '\n\n' : '') + 'DIAGNOSIS:\n' + t); toast('Saved to daily report.', 'success'); },
    });
  };

  const c = el('section', { class: 'card' });
  c.appendChild(el('div', { class: 'spread' },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: 'Daily Scaling Recommendation' }),
    button('✨ Diagnose & next steps', { variant: 'ghost', onClick: diagnose })));
  c.appendChild(el('div', { class: 'grid grid-3', style: { marginTop: '14px' } },
    col('Scale', 'good', buckets.Scale, 'Increase budget / duplicate winners.'),
    col('Observe', 'warn', buckets.Observe, 'Hold budget; watch another day.'),
    col('Kill', 'bad', buckets.Kill, 'Cut spend / turn off.'),
  ));
  return c;
}

// ---------------------------------------------------------------------------
// Product performance (today vs yesterday)
// ---------------------------------------------------------------------------
function renderPerformance(products, yday, cfg) {
  const rows = products.map((p) => {
    const t = store.getDailyMetric(p.code, selectedDate);
    const y = store.getDailyMetric(p.code, yday);
    const tm = metrics.computeMetrics(t || {});
    const ym = metrics.computeMetrics(y || {});
    return { p, tm, ym, hasToday: !!t, prof: metrics.profit(t || {}, p) };
  }).filter((r) => r.hasToday || r.ym.spend > 0);

  // rank: ROAS desc, tiebreak CPP asc
  rows.sort((a, b) => {
    const ra = a.tm.roas ?? -1, rb = b.tm.roas ?? -1;
    if (rb !== ra) return rb - ra;
    return (a.tm.cpp ?? Infinity) - (b.tm.cpp ?? Infinity);
  });
  rows.forEach((r, i) => { r.rank = i + 1; });

  const delta = (today, yest) => {
    if (today === null || yest === null) return '';
    const up = today >= yest;
    return el('span', { style: { color: up ? 'var(--good)' : 'var(--bad)', fontSize: '11px', marginLeft: '6px' }, text: (up ? '▲' : '▼') });
  };

  const columns = [
    { key: 'rank', label: '#', align: 'center', sortValue: (r) => r.rank, render: (r) => String(r.rank) },
    { key: 'code', label: 'Product', sortValue: (r) => r.p.code, render: (r) => el('a', { href: `#/products/${encodeURIComponent(r.p.code)}` }, el('span', { class: 'code-badge', text: r.p.code })) },
    { key: 'trend', label: 'ROAS 7d', sortable: false, render: (r) => {
      const series = metrics.productSeries(r.p.code, 7, selectedDate);
      const wrap = el('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'nowrap' } }, sparkline(series.map((s) => s.roas), { width: 78, height: 22 }));
      const fat = metrics.detectFatigue(r.p.code);
      if (fat.fatiguing) wrap.appendChild(el('span', { class: 'pill pill--warn', title: fat.reason, text: '🔻' }));
      return wrap;
    } },
    { key: 'spend', label: 'Spend', align: 'right', sortValue: (r) => r.tm.spend, render: (r) => metrics.fmt(r.tm.spend, 'peso') },
    { key: 'revenue', label: 'Revenue', align: 'right', sortValue: (r) => r.tm.revenue, render: (r) => metrics.fmt(r.tm.revenue, 'peso') },
    { key: 'roas', label: 'ROAS', align: 'right', sortValue: (r) => r.tm.roas ?? -1, cellBg: (r) => roasHeat(r.tm.roas, cfg), render: (r) => el('span', {}, metrics.fmt(r.tm.roas, 'roas'), delta(r.tm.roas, r.ym.roas)) },
    { key: 'cpp', label: 'CPP', align: 'right', sortValue: (r) => r.tm.cpp ?? Infinity, render: (r) => metrics.fmt(r.tm.cpp, 'cpp') },
    { key: 'ctr', label: 'CTR', align: 'right', sortValue: (r) => r.tm.ctr ?? -1, render: (r) => metrics.fmt(r.tm.ctr, 'ctr') },
    { key: 'cpm', label: 'CPM', align: 'right', sortValue: (r) => r.tm.cpm ?? -1, render: (r) => metrics.fmt(r.tm.cpm, 'cpm') },
    { key: 'profit', label: 'Profit', align: 'right', sortValue: (r) => r.prof, cellBg: (r) => profitHeat(r.prof, r.tm.spend), render: (r) => {
      const tone = r.prof > 0.0001 ? 'good' : r.prof < -0.0001 ? 'bad' : 'warn';
      const lbl = metrics.profitLabel(r.prof, r.tm.spend);
      return el('div', { style: { textAlign: 'right' } },
        el('div', { style: { color: `var(--${tone})`, fontWeight: '600' }, text: metrics.fmt(r.prof, 'peso') }),
        lbl ? el('div', { style: { fontSize: '10px', color: `var(--${tone})` }, text: lbl }) : null);
    } },
    { key: 'label', label: 'Call', align: 'center', sortable: false, render: (r) => { const l = metrics.labelForRoas(r.tm.roas, cfg.thresholds); return l ? pill(l) : document.createTextNode('—'); } },
  ];

  return card('Product Performance — ' + selectedDate + ' vs ' + yday,
    sortableTable(columns, rows, { sort: { key: 'rank', dir: 'asc' }, empty: 'No metrics logged for these dates yet.' }));
}

// ---------------------------------------------------------------------------
// Yesterday winners & losers
// ---------------------------------------------------------------------------
function renderWinnersLosers(products, yday, cfg) {
  const ranked = products.map((p) => {
    const m = store.getDailyMetric(p.code, yday);
    return { p, roas: m ? metrics.roas(toNum(m.revenue), toNum(m.spend)) : null };
  }).filter((r) => r.roas !== null).sort((a, b) => b.roas - a.roas);

  if (!ranked.length) {
    return card(`Yesterday (${yday}) Winners & Losers`, el('p', { class: 'muted', style: { margin: 0 }, text: 'No metrics logged for yesterday.' }));
  }
  const top = ranked.slice(0, 3);
  const bottom = ranked.slice(-3).reverse();
  const list = (items, tone) => {
    const w = el('div', { class: 'stack', style: { gap: '6px' } });
    items.forEach(({ p, roas }) => w.appendChild(el('div', { class: 'spread' },
      el('a', { href: `#/products/${encodeURIComponent(p.code)}` }, el('span', { class: 'code-badge', text: p.code })),
      el('span', { class: `pill pill--${tone}`, text: metrics.fmt(roas, 'roas') }))));
    return w;
  };
  return card(`Yesterday (${yday}) Winners & Losers`,
    el('div', { class: 'grid grid-2' },
      el('div', {}, el('div', { class: 'field__label', style: { marginBottom: '8px' }, text: '🏆 Top by ROAS' }), list(top, 'good')),
      el('div', {}, el('div', { class: 'field__label', style: { marginBottom: '8px' }, text: '⚠️ Bottom by ROAS' }), list(bottom, 'bad')),
    ));
}

// ---------------------------------------------------------------------------
// Page performance (reuses per-product metrics) — also shown in Module 4
// ---------------------------------------------------------------------------
function renderPagePerformance(cfg) {
  const pages = store.getPages();
  if (!pages.length) {
    return card('Page Performance', el('p', { class: 'muted', style: { margin: 0 }, text: 'No pages yet — add them in Page Status Manager.' }));
  }
  const columns = [
    { key: 'name', label: 'Page', render: (pg) => pg.name },
    { key: 'productCode', label: 'Product', render: (pg) => pg.productCode ? el('span', { class: 'code-badge', text: pg.productCode }) : el('span', { class: 'muted', text: 'unmapped' }) },
    { key: 'roas', label: 'ROAS', align: 'right', sortValue: (pg) => metrics.currentRoas(pg.productCode) ?? -1, render: (pg) => metrics.fmt(metrics.currentRoas(pg.productCode), 'roas') },
    { key: 'yesterdaySpend', label: 'Yest. spend', align: 'right', sortValue: (pg) => toNum(pg.yesterdaySpend), render: (pg) => metrics.fmt(toNum(pg.yesterdaySpend), 'peso') },
    { key: 'status', label: 'Status', render: (pg) => pill(pg.status || 'Active') },
  ];
  return card('Page Performance',
    sortableTable(columns, pages, { sort: { key: 'roas', dir: 'desc' }, empty: 'No pages.' }));
}

// ---------------------------------------------------------------------------
// AI daily report panel (deterministic placeholder now; AI wired in Phase 4)
// ---------------------------------------------------------------------------
function renderReportPanel() {
  const existing = store.getDailyReport(selectedDate);
  const ta = textarea({ value: existing, rows: 6, placeholder: 'Daily marketing report. Generate with AI or write here…' });

  if (!isAdmin()) {
    ta.setAttribute('readonly', '');
    return card('AI Daily Report — ' + selectedDate,
      existing ? ta : el('p', { class: 'muted', style: { margin: 0 }, text: 'No report for this day yet.' }));
  }

  function buildDataSummary() {
    const cfg = store.getConfig();
    const rows = store.getProducts().map((p) => {
      const m = store.getDailyMetric(p.code, selectedDate);
      if (!m) return null;
      const cm = metrics.computeMetrics(m);
      return `${p.code} (${p.name}): spend ${metrics.fmt(cm.spend, 'peso')}, revenue ${metrics.fmt(cm.revenue, 'peso')}, ROAS ${metrics.fmt(cm.roas, 'roas')}, CPP ${metrics.fmt(cm.cpp, 'cpp')} → ${metrics.labelForRoas(cm.roas, cfg.thresholds) || 'n/a'}`;
    }).filter(Boolean);
    const agg = metrics.aggregate(store.getDailyMetricsByDate(selectedDate));
    return `Date: ${selectedDate}\nBlended: spend ${metrics.fmt(agg.spend, 'peso')}, revenue ${metrics.fmt(agg.revenue, 'peso')}, ROAS ${metrics.fmt(agg.roas, 'roas')}.\nPer product:\n${rows.join('\n') || '(no data logged)'}`;
  }

  const genBtn = button('✨ Generate report (AI)', { variant: 'primary', onClick: () => {
    if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
    if (!store.getDailyMetricsByDate(selectedDate).length) { toast('No metrics logged for this date yet.', 'warn'); return; }
    ai.openAiEditor({
      title: `Daily report — ${selectedDate}`,
      system: `${ai.languageDirective()} You are a performance-marketing lead writing a short daily report for the team.`,
      user: `${buildDataSummary()}\n\nWrite a short daily marketing report: 1) top performers, 2) what to SCALE, 3) what to KILL, 4) 1–2 concrete action items. Keep it punchy.`,
      saveLabel: 'Save report',
      onSave: (text) => { store.saveDailyReport(selectedDate, text); ta.value = text; toast('Report saved.', 'success'); },
    });
  } });
  const saveBtn = button('Save report', { variant: 'ghost', onClick: () => { store.saveDailyReport(selectedDate, ta.value); toast('Report saved.', 'success'); } });
  return card('AI Daily Report — ' + selectedDate,
    el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px', marginBottom: '10px' } }, genBtn, saveBtn),
    ta);
}

// ---------------------------------------------------------------------------
// CSV / paste import (bulk daily entry) — the main friction-killer
// ---------------------------------------------------------------------------
const IMPORT_ALIASES = {
  product: ['product code', 'product', 'code', 'campaign name', 'campaign', 'ad name', 'ad set name', 'adset', 'name'],
  spend: ['amount spent (php)', 'amount spent', 'ad spend', 'spend', 'spent', 'cost'],
  revenue: ['purchases conversion value', 'website purchases conversion value', 'conversion value', 'revenue', 'sales', 'value'],
  impressions: ['impressions', 'impr.', 'impr', 'impression'],
  clicks: ['link clicks', 'clicks (all)', 'outbound clicks', 'clicks'],
  purchases: ['website purchases', 'purchases', 'results', 'orders', 'conversions'],
};

function parseMoney(s) {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function mapHeader(cells) {
  const headers = cells.map((h) => h.toLowerCase().trim());
  const fields = Object.keys(IMPORT_ALIASES);
  const claimed = new Set();
  const map = {};
  // Pass 1: exact alias matches (so "purchases conversion value" → revenue, not purchases).
  for (const field of fields) {
    for (let i = 0; i < headers.length; i++) {
      if (claimed.has(i)) continue;
      if (IMPORT_ALIASES[field].includes(headers[i])) { map[field] = i; claimed.add(i); break; }
    }
  }
  // Pass 2: substring matches (longest alias first) for still-unmapped fields/columns.
  for (const field of fields) {
    if (map[field] !== undefined) continue;
    const aliases = [...IMPORT_ALIASES[field]].sort((a, b) => b.length - a.length);
    for (let i = 0; i < headers.length; i++) {
      if (claimed.has(i)) continue;
      if (aliases.some((a) => headers[i].includes(a))) { map[field] = i; claimed.add(i); break; }
    }
  }
  return map;
}

function matchProduct(token, products) {
  if (!token) return '';
  const t = token.trim(); const up = t.toUpperCase();
  let p = products.find((x) => x.code.toUpperCase() === up); if (p) return p.code;
  p = products.find((x) => up.includes(x.code.toUpperCase())); if (p) return p.code;
  p = products.find((x) => x.name && t.toLowerCase().includes(x.name.toLowerCase())); if (p) return p.code;
  p = products.find((x) => x.name && t.toLowerCase().includes(x.name.toLowerCase().split(' ')[0])); if (p) return p.code;
  return '';
}

const FIELD_LABELS = { product: 'Product / name', spend: 'Spend ₱', revenue: 'Revenue ₱', impressions: 'Impressions', clicks: 'Clicks', purchases: 'Purchases' };
const IMPORT_FIELDS = Object.keys(FIELD_LABELS);

function openImportModal(view) {
  const products = store.getProducts();
  if (!products.length) { toast('Add products first.', 'warn'); return; }
  const codes = products.map((p) => p.code);
  const ta = textarea({ rows: 7, placeholder: 'GINKGO-01\t6000\t18600\t185000\t3500\t52\nSCAR-02\t2500\t4250\t90000\t1400\t14' });
  ta.style.fontFamily = 'var(--mono)'; ta.style.fontSize = '12px';
  const mapHost = el('div', {});
  const previewHost = el('div', {});

  let cells = [];          // parsed 2D grid
  let columnLabels = [];   // header names or "Column N"
  let hasHeader = false;   // is the first row a header?
  let headerOverride = null; // null = auto-detect, true/false = user choice
  let mapping = {};        // field -> column index (or -1)
  let rows = [];

  function reparse() {
    const lines = ta.value.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
    cells = []; columnLabels = []; mapping = {};
    if (lines.length) {
      const delim = lines[0].includes('\t') ? '\t' : ',';
      cells = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
      const hdrMap = mapHeader(cells[0]);
      hasHeader = headerOverride === null ? (Object.keys(hdrMap).length >= 2) : headerOverride;
      const ncols = Math.max(0, ...cells.map((r) => r.length));
      for (let i = 0; i < ncols; i++) columnLabels.push(hasHeader ? (cells[0][i] || `Column ${i + 1}`) : `Column ${i + 1}`);
      if (hasHeader) IMPORT_FIELDS.forEach((f) => { mapping[f] = hdrMap[f] !== undefined ? hdrMap[f] : -1; });
      else IMPORT_FIELDS.forEach((f, i) => { mapping[f] = i < ncols ? i : -1; });
    }
    renderMapper();
    computeRows();
  }

  function computeRows() {
    const dataRows = hasHeader ? cells.slice(1) : cells;
    const get = (row, f) => (mapping[f] >= 0 ? row[mapping[f]] : '');
    rows = dataRows.map((row) => {
      const token = (get(row, 'product') || '').toString();
      return {
        token, productCode: matchProduct(token, products),
        spend: parseMoney(get(row, 'spend')), revenue: parseMoney(get(row, 'revenue')),
        impressions: parseMoney(get(row, 'impressions')), clicks: parseMoney(get(row, 'clicks')),
        purchases: parseMoney(get(row, 'purchases')),
      };
    }).filter((r) => r.token);
    renderPreview();
  }

  function renderMapper() {
    clear(mapHost);
    if (!columnLabels.length) return;
    const headerChk = el('input', { type: 'checkbox', style: { width: 'auto' } });
    headerChk.checked = hasHeader;
    headerChk.addEventListener('change', () => { headerOverride = headerChk.checked; reparse(); });
    mapHost.appendChild(el('label', { class: 'row', style: { gap: '8px', alignItems: 'center', fontSize: '12px', marginBottom: '6px' } }, headerChk, el('span', { text: 'First row is column names (header)' })));
    mapHost.appendChild(el('div', { class: 'field__label', text: 'Map your own columns:' }));
    const grid = el('div', { class: 'form-grid' });
    IMPORT_FIELDS.forEach((f) => {
      const opts = [{ value: '-1', label: '— none —' }, ...columnLabels.map((l, i) => ({ value: String(i), label: `${i + 1}. ${l}` }))];
      const sel = select(opts, { value: String(mapping[f] >= 0 ? mapping[f] : -1), onChange: (e) => { mapping[f] = parseInt(e.target.value, 10); computeRows(); } });
      grid.appendChild(field(FIELD_LABELS[f], sel));
    });
    mapHost.appendChild(grid);
  }

  function renderPreview() {
    clear(previewHost);
    if (!rows.length) { previewHost.appendChild(el('p', { class: 'muted', style: { margin: '8px 0 0' }, text: 'Paste your rows, then Preview.' })); return; }
    const matched = rows.filter((r) => r.productCode).length;
    previewHost.appendChild(el('p', { class: 'field__hint', html: `Importing to <b>${selectedDate}</b> — <b>${matched}</b>/${rows.length} rows matched a product.` }));
    const cols = [
      { key: 'token', label: 'Source', sortable: false, render: (r) => r.token },
      { key: 'productCode', label: '→ Product', sortable: false, render: (r) => {
        const sel = select(['— unmatched —', ...codes], { value: r.productCode || '— unmatched —' });
        sel.style.width = 'auto';
        sel.addEventListener('change', () => { r.productCode = sel.value.startsWith('—') ? '' : sel.value; renderPreview(); });
        return sel;
      } },
      { key: 'spend', label: 'Spend', align: 'right', sortable: false, render: (r) => metrics.fmt(r.spend, 'peso') },
      { key: 'revenue', label: 'Revenue', align: 'right', sortable: false, render: (r) => metrics.fmt(r.revenue, 'peso') },
      { key: 'purchases', label: 'Purch', align: 'right', sortable: false, render: (r) => String(r.purchases) },
      { key: 'roas', label: 'ROAS', align: 'right', sortable: false, render: (r) => metrics.fmt(metrics.roas(r.revenue, r.spend), 'roas') },
    ];
    previewHost.appendChild(sortableTable(cols, rows, { empty: 'No rows.' }));
  }

  ta.addEventListener('input', debounce(reparse, 350));
  reparse();

  const body = el('div', { class: 'stack' },
    el('p', { class: 'field__hint', html: `Paste from Ads Manager or your own spreadsheet (Excel/Sheets). The header is auto-detected; if your columns differ, <b>just map them below</b>. Tab- or comma-separated. Imports to <b>${selectedDate}</b> (this overwrites existing rows for that day).` }),
    ta,
    el('div', { class: 'row', style: { justifyContent: 'flex-end' } }, button('Preview / re-map', { variant: 'ghost', onClick: reparse })),
    mapHost,
    previewHost,
  );

  openModal({
    title: 'Paste daily import', width: 760, body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Import matched', variant: 'primary', onClick: (close) => {
        const matched = rows.filter((r) => r.productCode);
        if (!matched.length) { toast('No matched rows to import.', 'warn'); return; }
        matched.forEach((r) => store.upsertDailyMetric({ productCode: r.productCode, date: selectedDate, spend: r.spend, revenue: r.revenue, impressions: r.impressions, clicks: r.clicks, purchases: r.purchases }));
        metrics.recomputeAllStatuses();
        toast(`Imported ${matched.length} row(s) to ${selectedDate}.`, 'success');
        close(); rerender(view);
      } },
    ],
  });
}
