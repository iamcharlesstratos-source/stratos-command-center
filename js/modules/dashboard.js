// dashboard.js — decision-first "Today" command center.
// Order = what you act on first: alerts → today's KPIs → scale/kill calls →
// top movers → pipeline snapshot → module links / recent (progressive disclosure).

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import * as ai from '../ai.js';
import { el, button, pageHeader, statTile, card, pill, toast, confirmDialog, field, input, select, lineChart, barChart, countUp, dateRangeControl } from '../ui.js';
import { todayStr, yesterdayStr, toNum, resolveRange, inRange } from '../util.js';

const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();

const MODULES = [
  { route: 'products', title: 'Stratos Products', desc: 'R&D, scoring, offers, pricing & launch readiness — the hub.' },
  { route: 'creatives', title: 'Creative Testing', desc: 'Brief, assign & rank image/video creatives.' },
  { route: 'daily', title: 'Daily Metrics', desc: 'Daily spend/revenue → ROAS, CPP, CPM, CTR & scale calls.' },
  { route: 'pages', title: 'Page Status', desc: 'Per-Facebook-Page performance & product mapping.' },
  { route: 'content', title: 'AI Content', desc: 'Captions, hooks, headlines & scripts in your chosen language.' },
  { route: 'research', title: 'Marketing Research', desc: 'Trending hooks, formats & angles + one-click to real ads.' },
  { route: 'competitors', title: 'Competitor Ads', desc: 'Track competitor ads & recreate / improve them.' },
  { route: 'experiments', title: 'A/B Tests', desc: 'Log tests, compare variants & let AI call the winner.' },
  { route: 'diagnostics', title: 'Diagnostics', desc: 'Turns each product’s metrics into what’s wrong, why & the next move.' },
  { route: 'scorecards', title: 'Team Scorecards', desc: 'Who shipped what — creatives, winners, win rate & output vs quota.' },
];

export function render(view) {
  const products = store.getProducts();
  const s = store.getSummary();
  const today = todayStr();
  const yday = yesterdayStr();
  const cfg = store.getConfig();

  const range = store.getDateRange();
  const rr = resolveRange(range);
  const rangePicker = dateRangeControl({ value: range, onChange: (resolved, raw) => { store.setDateRange(raw); rerenderDash(); } });
  const headerActions = [rangePicker];
  if (products.length && isAdmin()) headerActions.push(button('+ New product', { variant: 'primary', onClick: () => { location.hash = '#/products'; } }));
  view.appendChild(pageHeader('Today', `What to act on today · ${today}`, headerActions));

  // ---- empty state ----
  if (s.products === 0 && s.creatives === 0 && s.competitors === 0) {
    view.appendChild(card('Get started',
      isAdmin()
        ? el('p', { class: 'muted', text: 'No data yet. Load a small sample dataset (2 products with creatives, daily metrics, pages & competitors) to explore every module, or jump straight into adding your first product.' })
        : el('p', { class: 'muted', text: 'No data yet. Wait for the Advertiser to set things up — then the creatives assigned to you will show up here.' }),
      isAdmin() ? el('div', { class: 'row', style: { marginTop: '8px' } },
        button('Load sample data', { variant: 'primary', onClick: () => loadSample(view) }),
        button('Start with a product', { variant: 'ghost', onClick: () => { location.hash = '#/products'; } }),
      ) : null,
    ));
    return;
  }

  // ---- 0) WAR ROOM — today's direction (everyone sees it; admin sets it) ----
  view.appendChild(renderWarRoom());

  // ---- 0.5) RANGE PERFORMANCE — date-range view on the main landing ----
  view.appendChild(renderRangeCard(rr, cfg));

  // ---- 1) ACTION NEEDED (alerts first) ----
  const alerts = metrics.computeAlerts();
  if (alerts.length) {
    const c = el('section', { class: 'card', style: { borderLeft: '3px solid var(--warn)' } });
    c.appendChild(el('h3', { class: 'card__title', text: `Action needed (${alerts.length})` }));
    const list = el('div', { class: 'stack', style: { gap: '6px' } });
    alerts.forEach((a) => list.appendChild(el('a', { href: a.route, class: 'spread', style: { padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' } },
      el('span', { text: `${a.icon}  ${a.text}` }),
      el('span', { class: `pill pill--${a.level === 'bad' ? 'bad' : 'warn'}`, text: a.level === 'bad' ? 'urgent' : 'review' }))));
    c.appendChild(list);
    view.appendChild(c);
  }

  // ---- 1b) CREATIVES FOR REVIEW (Advertiser only) — submitted by the Graphic Artist ----
  if (isAdmin()) {
    notifyNewReviews(cfg);
    const queue = renderReviewQueue(view);
    if (queue) view.appendChild(queue);
  }

  // ---- 1c) AI ACCOUNT AUDITOR (admin) ----
  if (isAdmin()) view.appendChild(renderAuditor());

  // ---- 2) TODAY hero KPIs ----
  const dayRows = store.getDailyMetricsByDate(today);
  const agg = metrics.aggregate(dayRows);
  const dayProfit = dayRows.reduce((sum, r) => sum + metrics.profit(r, store.getProduct(r.productCode)), 0);
  const margin = metrics.profitLabel(dayProfit, agg.spend);
  const roasTone = (() => { const l = metrics.labelForRoas(agg.roas, cfg.thresholds); return l === 'Scale' ? 'good' : l === 'Observe' ? 'warn' : l === 'Kill' ? 'bad' : undefined; })();
  const heroGrid = el('div', { class: 'grid grid-4', style: { marginTop: 'var(--gap)' } },
    statTile('Ad spend today', metrics.fmt(agg.spend, 'peso'), { sub: `${dayRows.length} product(s) logged` }),
    statTile('Revenue today', metrics.fmt(agg.revenue, 'peso'), { tone: agg.revenue >= agg.spend ? 'good' : 'bad' }),
    statTile('Blended ROAS', metrics.fmt(agg.roas, 'roas'), { tone: roasTone }),
    statTile('Est. profit', metrics.fmt(dayProfit, 'peso'), { tone: dayProfit > 0 ? 'good' : dayProfit < 0 ? 'bad' : 'warn', sub: margin || '—' }),
  );
  view.appendChild(heroGrid);
  // count-up animation on the hero numbers (reduced-motion aware inside countUp)
  const hv = heroGrid.querySelectorAll('.stat-tile__value');
  const peso = (v) => Math.round(v).toLocaleString('en-PH');
  countUp(hv[0], agg.spend, { prefix: '₱', fmt: peso });
  countUp(hv[1], agg.revenue, { prefix: '₱', fmt: peso });
  if (Number.isFinite(agg.roas)) countUp(hv[2], agg.roas, { fmt: (v) => v.toFixed(2), suffix: '×' });
  countUp(hv[3], dayProfit, { prefix: '₱', fmt: peso });
  if (!dayRows.length) {
    view.appendChild(el('p', { class: 'muted', style: { marginTop: '-6px' } },
      'No metrics logged for today yet — ', el('a', { href: '#/daily', style: { color: 'var(--accent)' }, text: 'log them in Daily Metrics →' })));
  }

  // ---- 3) TODAY'S CALLS (scale / observe / kill) + movers ----
  const calls = { Scale: [], Observe: [], Kill: [] };
  products.forEach((p) => {
    const m = store.getDailyMetric(p.code, today);
    if (!m) return;
    const r = metrics.roas(Number(m.revenue) || 0, Number(m.spend) || 0);
    const lbl = metrics.labelForRoas(r, cfg.thresholds);
    if (lbl) calls[lbl].push({ p, r });
  });
  const hasCalls = calls.Scale.length || calls.Observe.length || calls.Kill.length;
  if (hasCalls) {
    const callCol = (title, tone, items, advice) => {
      const col = el('div', { class: 'card', style: { borderTop: `2px solid var(--${tone})` } });
      col.appendChild(el('div', { class: 'spread' }, el('h3', { class: 'card__title', style: { margin: 0 }, text: title }), pill(title)));
      col.appendChild(el('p', { class: 'field__hint', text: advice }));
      if (!items.length) col.appendChild(el('p', { class: 'muted', style: { margin: 0 }, text: 'None today.' }));
      items.sort((a, b) => (b.r ?? 0) - (a.r ?? 0)).forEach(({ p, r }) => col.appendChild(el('div', { class: 'spread', style: { padding: '6px 0', borderTop: '1px solid var(--border)' } },
        el('a', { href: `#/products/${encodeURIComponent(p.code)}` }, el('span', { class: 'code-badge', text: p.code })),
        el('span', { class: 'mono', text: metrics.fmt(r, 'roas') }))));
      return col;
    };
    view.appendChild(card('Today\'s calls',
      el('div', { class: 'grid grid-3' },
        callCol('Scale', 'good', calls.Scale, 'Push budget / duplicate.'),
        callCol('Observe', 'warn', calls.Observe, 'Hold; watch a day.'),
        callCol('Kill', 'bad', calls.Kill, 'Cut spend / off.'),
      )));
  }

  // ---- 3.5) TRENDS (7-day line + today profit bars) ----
  const dates = [];
  { const base = new Date(today + 'T00:00:00'); for (let i = 6; i >= 0; i--) { const x = new Date(base); x.setDate(base.getDate() - i); dates.push(todayStr(x)); } }
  const daily = dates.map((d) => metrics.aggregate(store.getDailyMetricsByDate(d)));
  const spendSeries = daily.map((a) => a.spend);
  const revSeries = daily.map((a) => a.revenue);
  const anyTrend = spendSeries.some((v) => v > 0) || revSeries.some((v) => v > 0);
  const profitItems = products.map((p) => { const m = store.getDailyMetric(p.code, today); return m ? { label: p.code, value: metrics.profit(m, p) } : null; }).filter(Boolean);
  if (anyTrend || profitItems.length) {
    const grid = el('div', { class: 'grid grid-2', style: { marginTop: 'var(--gap)' } });
    if (anyTrend) grid.appendChild(card('Spend vs Revenue · 7 days',
      lineChart([{ name: 'Spend', color: '#3B82F6', values: spendSeries }, { name: 'Revenue', color: '#2DD4A7', values: revSeries }],
        { labels: dates.map((d) => d.slice(5)), fmt: (v) => '₱' + Math.round(v / 1000) + 'k' })));
    if (profitItems.length) grid.appendChild(card('Profit by product · today',
      barChart(profitItems, { fmt: (v) => metrics.fmt(v, 'peso') })));
    view.appendChild(grid);
  }

  // ---- 4) PIPELINE snapshot ----
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginTop: 'var(--gap)' } },
    statTile('Scaling', String(s.byStatus.Scaling || 0), { tone: 'good' }),
    statTile('Ready', String(s.byStatus.Ready || 0), { tone: 'good' }),
    statTile('Pending', String(s.byStatus.Pending || 0), { tone: 'warn' }),
    statTile('Failed', String(s.byStatus.Failed || 0), { tone: 'bad' }),
  ));

  // ---- 5) Module links (progressive disclosure) ----
  const links = el('div', { class: 'grid grid-3' });
  for (const m of MODULES) {
    links.appendChild(el('a', { class: 'card', href: `#/${m.route}`, style: { cursor: 'pointer' } },
      el('h3', { class: 'card__title', text: m.title }),
      el('p', { class: 'muted', style: { margin: 0 }, text: m.desc })));
  }
  view.appendChild(el('h3', { class: 'card__title', style: { marginTop: 'var(--gap-lg)' }, text: 'Modules' }));
  view.appendChild(links);
}

// ---------------------------------------------------------------------------
// Creative review queue + launch scheduler (Advertiser-facing)
// ---------------------------------------------------------------------------
function rerenderDash() { if (window.STRATOS) window.STRATOS.renderRoute(); }

function renderReviewQueue() {
  const forReview = store.getCreatives()
    .filter((c) => c.status === 'For Review')
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  if (!forReview.length) return null;

  const c = el('section', { class: 'card', style: { borderLeft: '3px solid var(--accent)' } });
  c.appendChild(el('h3', { class: 'card__title', text: `🎨 Creatives for review (${forReview.length})` }));
  c.appendChild(el('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12px' }, text: 'New creatives from the Graphic Artist. Review them, set a launch date, then Approve.' }));
  const list = el('div', { class: 'stack', style: { gap: '8px' } });
  forReview.forEach((cr) => {
    const dateInput = el('input', { class: 'input', type: 'date', value: cr.launchDate || '', style: { width: 'auto' }, title: 'Launch date' });
    const schedule = button('🗓️ Schedule', { variant: 'ghost', title: 'Save the launch date (stays For Review)', onClick: () => {
      if (!dateInput.value) { toast('Pick a date first.', 'warn'); return; }
      store.upsertCreative({ ...cr, launchDate: dateInput.value });
      toast(`Scheduled: ${cr.title || 'creative'} → ${dateInput.value}`, 'success'); rerenderDash();
    } });
    const approve = button('✓ Approve', { variant: 'primary', onClick: () => {
      store.upsertCreative({ ...cr, status: 'Approved', launchDate: dateInput.value || cr.launchDate || '' });
      if (cr.productCode) metrics.recomputeStatus(cr.productCode);
      toast(`Approved: ${cr.title || 'creative'}${dateInput.value ? ' · launch ' + dateInput.value : ''}`, 'success'); rerenderDash();
    } });
    const open = el('a', { href: '#/creatives', class: 'btn btn--ghost btn--sm', text: 'Open' });
    list.appendChild(el('div', { class: 'spread', style: { padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
      el('div', { style: { minWidth: '0' } },
        el('div', { style: { fontWeight: '600' }, text: cr.title || '(untitled)' }),
        el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px' } }, el('span', { class: 'code-badge', text: cr.productCode || '—' }), document.createTextNode(`  ·  ${cr.type || 'image'}${cr.assignee ? '  ·  ' + cr.assignee : ''}`))),
      el('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
        el('span', { class: 'field__label', text: 'Launch' }), dateInput, schedule, approve, open)));
  });
  c.appendChild(list);
  return c;
}

// One-time toast (+ browser notification) when the GA submits new creatives.
function notifyNewReviews(cfg) {
  const seenAt = (cfg.ui && cfg.ui.reviewSeenAt) || '';
  const fresh = store.getCreatives().filter((c) => c.status === 'For Review' && (c.updatedAt || c.createdAt || '') > seenAt);
  if (!fresh.length) return;
  toast(`🎨 ${fresh.length} new creative(s) for review!`, 'info');
  try {
    if ('Notification' in window) {
      const body = fresh.map((c) => c.title).filter(Boolean).slice(0, 3).join(', ') || 'Open the dashboard to review them.';
      if (Notification.permission === 'granted') new Notification('New creative for review', { body });
      else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') new Notification('New creative for review', { body }); });
    }
  } catch (e) { /* ignore */ }
  store.updateConfig({ ui: { reviewSeenAt: new Date().toISOString() } });
}

// ---------------------------------------------------------------------------
// AI Account Auditor — reads the whole account and gives today's action list
// ---------------------------------------------------------------------------
function renderAuditor() {
  const c = el('section', { class: 'card', style: { borderLeft: '3px solid var(--accent)' } });
  c.appendChild(el('div', { class: 'spread' },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: '🧠 AI Account Auditor' }),
    button("Run today's audit", { variant: 'primary', onClick: runAudit })));
  c.appendChild(el('p', { class: 'field__hint', style: { margin: '8px 0 0' }, text: 'AI reviews your metrics, creatives & experiments, then tells you exactly what to scale, kill or fix today.' }));
  return c;
}

function latestMetricFor(code) {
  return store.getDailyMetricsByProduct(code).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
}

function buildAuditContext() {
  const cfg = store.getConfig();
  const th = cfg.thresholds;
  const today = todayStr();
  const L = [];
  L.push(`Date: ${today}`);
  const tAgg = metrics.aggregate(store.getDailyMetricsByDate(today));
  const yAgg = metrics.aggregate(store.getDailyMetricsByDate(yesterdayStr()));
  L.push(`Account today: spend ${metrics.fmt(tAgg.spend, 'peso')}, revenue ${metrics.fmt(tAgg.revenue, 'peso')}, blended ROAS ${metrics.fmt(tAgg.roas, 'roas')}, ${tAgg.purchases} orders.`);
  L.push(`Account yesterday: spend ${metrics.fmt(yAgg.spend, 'peso')}, revenue ${metrics.fmt(yAgg.revenue, 'peso')}, ROAS ${metrics.fmt(yAgg.roas, 'roas')}.`);
  L.push(`Decision thresholds: Scale ROAS >= ${th.scaleRoas}, Observe ${th.observeRoas}-${th.scaleRoas}, Kill < ${th.observeRoas}.`);

  L.push('\nPer product (latest day with data):');
  store.getProducts().forEach((p) => {
    const m = store.getDailyMetric(p.code, today) || latestMetricFor(p.code);
    if (!m) { L.push(`- ${p.code} (${p.name}) [${p.status}]: NO metrics logged.`); return; }
    const cm = metrics.computeMetrics(m);
    const prof = metrics.profit(m, p);
    const fat = metrics.detectFatigue(p.code);
    L.push(`- ${p.code} (${p.name}) [${p.status}], ${m.date}: spend ${metrics.fmt(cm.spend, 'peso')}, rev ${metrics.fmt(cm.revenue, 'peso')}, ROAS ${metrics.fmt(cm.roas, 'roas')}, CPP ${metrics.fmt(cm.cpp, 'cpp')}, CTR ${metrics.fmt(cm.ctr, 'ctr')}, profit ${metrics.fmt(prof, 'peso')} (${metrics.profitLabel(prof, cm.spend) || '?'})${fat.fatiguing ? `, FATIGUING (${fat.reason})` : ''} -> ${metrics.labelForRoas(cm.roas, th) || 'n/a'}`);
  });

  const crs = store.getCreatives();
  const odue = crs.filter((c) => c.deadline && c.deadline < today && !['Approved', 'Launched', 'Winner'].includes(c.status)).length;
  L.push(`\nCreatives: ${crs.length} total, ${crs.filter((c) => c.status === 'Winner').length} winners, ${crs.filter((c) => c.status === 'For Review').length} for review, ${odue} overdue.`);

  const exps = store.getExperiments();
  L.push(`Experiments: ${exps.length} total, ${exps.filter((e) => e.status === 'Running').length} running, ${exps.filter((e) => e.winner).length} with a winner.`);

  const alerts = metrics.computeAlerts();
  if (alerts.length) L.push('\nSystem alerts: ' + alerts.map((a) => a.text).join('; ') + '.');
  return L.join('\n');
}

function runAudit() {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  if (!store.getProducts().length) { toast('Add products + log metrics first.', 'warn'); return; }
  const today = todayStr();
  ai.openAiEditor({
    title: `AI Account Audit — ${today}`,
    system: `${ai.languageDirective()} You are a senior Philippine performance-marketing strategist auditing a Facebook/TikTok COD e-commerce ad account. Be specific, decisive and prioritized, and use the account's own numbers.`,
    user: `${buildAuditContext()}\n\nAudit this account and give me a PRIORITIZED action list for TODAY. For each item give: the product/area, the exact action (e.g. "scale +20%", "kill", "fix RTS", "ship 3 new hooks", "log metrics"), and a one-line reason from the data. Explicitly flag: products to SCALE, products to KILL, fatiguing creatives, missing data, and the single biggest opportunity. Keep it punchy — max ~10 items. Plain readable text only — no markdown symbols (no **, no #); start each item with "• ".`,
    saveLabel: 'Save to daily report',
    onSave: (text) => { const prev = store.getDailyReport(today); store.saveDailyReport(today, (prev ? prev + '\n\n' : '') + 'AUDIT:\n' + text); toast('Saved to daily report.', 'success'); },
  });
}

// ---------------------------------------------------------------------------
// War Room — today's direction (Marketing Head sets it; whole team sees it)
// ---------------------------------------------------------------------------
const WARROOM_ANGLES = ['Pain', 'Senior', 'Testimonial', 'Problem-Solution', 'Promo', 'Doctor', 'Lifestyle'];
const dateOf = (iso) => (iso || '').slice(0, 10);

function renderWarRoom() {
  const today = todayStr();
  const admin = isAdmin();
  const brief = store.getBrief(today) || {};
  const products = store.getProducts();
  const creatives = store.getCreatives();

  const createdToday = creatives.filter((x) => dateOf(x.createdAt) === today);
  const vids = createdToday.filter((x) => x.type === 'video').length;
  const imgs = createdToday.filter((x) => x.type === 'image').length;
  const launched = creatives.filter((x) => x.status === 'Launched' && dateOf(x.updatedAt) === today).length;
  const killed = creatives.filter((x) => x.status === 'Loser' && dateOf(x.updatedAt) === today).length;
  const winners = creatives.filter((x) => x.status === 'Winner').length;

  const c = el('section', { class: 'card', style: { borderLeft: '3px solid var(--accent)' } });
  c.appendChild(el('div', { class: 'spread', style: { marginBottom: '8px' } },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: "🪖 War Room — today's direction" }),
    el('span', { class: 'field__hint', text: today })));

  if (admin) {
    const focusSel = select([{ value: '', label: '— pick focus product —' }, ...products.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))], { value: brief.focusCode || '' });
    const angleSel = select(['', ...WARROOM_ANGLES].map((a) => ({ value: a, label: a || '— pick angle —' })), { value: brief.angle || '' });
    const vidTarget = input({ type: 'number', min: 0, value: brief.targetVideos != null ? brief.targetVideos : 5 });
    const imgTarget = input({ type: 'number', min: 0, value: brief.targetImages != null ? brief.targetImages : 3 });
    const noteInput = input({ value: brief.note || '', placeholder: 'e.g. Senior pain-relief angle, Buy 1 Take 1, Send Message CTA' });
    c.appendChild(el('div', { class: 'form-grid' },
      field('Focus product', focusSel),
      field('Angle', angleSel),
      field('Target videos', vidTarget),
      field('Target images', imgTarget)));
    c.appendChild(field('Direction note', noteInput));
    c.appendChild(el('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
      button('Set direction', { variant: 'primary', onClick: () => {
        store.saveBrief(today, { focusCode: focusSel.value, angle: angleSel.value, targetVideos: toNum(vidTarget.value), targetImages: toNum(imgTarget.value), note: noteInput.value });
        toast("Today's direction set — the team sees it now.", 'success'); rerenderDash();
      } })));
  } else {
    const fp = brief.focusCode ? store.getProduct(brief.focusCode) : null;
    const has = brief.focusCode || brief.angle || brief.note;
    c.appendChild(el('p', { class: has ? '' : 'muted', style: { margin: '0 0 4px' } },
      has
        ? el('span', {}, el('b', { text: 'Focus: ' }), document.createTextNode(fp ? `${fp.code} — ${fp.name || ''}` : (brief.focusCode || '—')), brief.angle ? document.createTextNode(`   ·   Angle: ${brief.angle}`) : null)
        : document.createTextNode('No direction set yet — waiting for the Marketing Head.')));
    if (brief.note) c.appendChild(el('p', { class: 'field__hint', style: { margin: 0 }, text: brief.note }));
    if (brief.targetVideos || brief.targetImages) c.appendChild(el('p', { class: 'field__hint', style: { margin: '4px 0 0' }, text: `Target: ${brief.targetVideos || 0} videos · ${brief.targetImages || 0} images` }));
  }

  const bar = (label, n, target) => {
    const pct = target > 0 ? Math.min(100, Math.round((n / target) * 100)) : (n > 0 ? 100 : 0);
    return el('div', { style: { marginTop: '8px' } },
      el('div', { class: 'spread', style: { fontSize: '12px', marginBottom: '3px' } }, el('span', { text: label }), el('b', { text: `${n}${target ? ' / ' + target : ''}` })),
      el('div', { class: 'gauge__track' }, el('div', { class: 'gauge__fill', style: { width: pct + '%' } })));
  };
  c.appendChild(el('div', { class: 'grid grid-2', style: { gap: '12px', marginTop: '10px' } },
    bar('🎬 Videos produced today', vids, brief.targetVideos || 0),
    bar('🖼️ Images produced today', imgs, brief.targetImages || 0)));
  c.appendChild(el('div', { class: 'row', style: { gap: '16px', marginTop: '10px', fontSize: '12px', flexWrap: 'wrap', alignItems: 'center' } },
    el('span', {}, el('b', { text: String(launched) }), document.createTextNode(' launched today')),
    el('span', {}, el('b', { text: String(killed) }), document.createTextNode(' killed today')),
    el('span', {}, el('b', { style: { color: 'var(--good)' }, text: String(winners) }), document.createTextNode(' winners total')),
    el('a', { href: '#/creatives', class: 'btn btn--ghost btn--sm', text: '+ New creative' })));
  return c;
}

// ---------------------------------------------------------------------------
// Range performance — date-range view (the picker lives in the page header)
// ---------------------------------------------------------------------------
function dShiftD(dateStr, days) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + days); return todayStr(d); }
function dDayCount(since, until) { return Math.round((new Date(`${until}T00:00:00`) - new Date(`${since}T00:00:00`)) / 86400000) + 1; }
function dDelta(cur, prev) {
  if (!Number.isFinite(prev) || prev === 0) return el('span', { class: 'muted', style: { fontSize: '11px' }, text: '—' });
  const d = ((cur - prev) / Math.abs(prev)) * 100, up = d >= 0;
  return el('span', { style: { fontSize: '11px', color: up ? 'var(--good)' : 'var(--bad)' }, text: `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}% vs prev` });
}

function renderRangeCard(rr, cfg) {
  const all = store.getDailyMetrics();
  const rows = all.filter((r) => inRange(r.date, rr));
  const c = el('section', { class: 'card' });
  c.appendChild(el('div', { class: 'spread', style: { alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: `📅 Performance — ${rr.label}` }),
    el('a', { href: '#/daily', class: 'field__hint', text: 'open Daily Metrics →' })));
  if (!rows.length) { c.appendChild(el('p', { class: 'muted', style: { margin: '8px 0 0' }, text: 'No metrics logged in this range yet. Change the range up top, or log/sync metrics in Daily Metrics.' })); return c; }

  const agg = metrics.aggregate(rows);
  const profit = rows.reduce((s, r) => s + metrics.profit(r, store.getProduct(r.productCode)), 0);
  let prev = null;
  if (rr.since && rr.until && rr.until !== '9999-12-31') {
    const n = dDayCount(rr.since, rr.until);
    const pU = dShiftD(rr.since, -1), pS = dShiftD(pU, -(n - 1));
    prev = metrics.aggregate(all.filter((r) => r.date >= pS && r.date <= pU));
  }
  const tone = (() => { const l = metrics.labelForRoas(agg.roas, cfg.thresholds); return l === 'Scale' ? 'good' : l === 'Observe' ? 'warn' : l === 'Kill' ? 'bad' : undefined; })();
  const tile = (label, value, toneC, delta) => el('div', { class: `stat-tile${toneC ? ' stat-tile--' + toneC : ''}` },
    el('div', { class: 'stat-tile__value', text: value }),
    el('div', { class: 'stat-tile__label', text: label }),
    delta ? el('div', { class: 'stat-tile__sub' }, delta) : null);
  c.appendChild(el('div', { class: 'grid grid-4', style: { marginTop: '12px' } },
    tile('Ad spend', metrics.fmt(agg.spend, 'peso'), undefined, prev ? dDelta(agg.spend, prev.spend) : null),
    tile('Revenue', metrics.fmt(agg.revenue, 'peso'), agg.revenue >= agg.spend ? 'good' : 'bad', prev ? dDelta(agg.revenue, prev.revenue) : null),
    tile('Blended ROAS', metrics.fmt(agg.roas, 'roas'), tone, prev ? dDelta(agg.roas || 0, prev.roas || 0) : null),
    tile('Est. profit', metrics.fmt(profit, 'peso'), profit > 0 ? 'good' : profit < 0 ? 'bad' : 'warn', null)));

  // top products by spend in the range
  const byCode = {};
  for (const r of rows) (byCode[r.productCode] = byCode[r.productCode] || []).push(r);
  const top = Object.entries(byCode).map(([code, rs]) => { const a = metrics.aggregate(rs); return { code, spend: a.spend, roas: a.roas }; })
    .sort((a, b) => b.spend - a.spend).slice(0, 5);
  if (top.length) {
    const list = el('div', { class: 'stack', style: { gap: '4px', marginTop: '12px' } },
      el('div', { class: 'field__hint', text: 'Top products by spend' }));
    top.forEach((t) => list.appendChild(el('a', { href: `#/products/${encodeURIComponent(t.code)}`, class: 'spread', style: { padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' } },
      el('span', { class: 'code-badge', text: t.code || '—' }),
      el('span', { class: 'mono', text: `${metrics.fmt(t.spend, 'peso')} · ${metrics.fmt(t.roas, 'roas')}` }))));
    c.appendChild(list);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Sample data loader — realistic, schema-correct, links across modules.
// ---------------------------------------------------------------------------
async function loadSample(view) {
  if (store.getProducts().length) {
    const ok = await confirmDialog({ title: 'Add sample data?', message: 'This appends sample products and related records to your existing data.', confirmText: 'Add samples' });
    if (!ok) return;
  }
  const today = todayStr();
  const yday = yesterdayStr();
  const cfg = store.getConfig();
  const allChecked = (arr) => Object.fromEntries(arr.map((i) => [i, true]));

  const ginkgo = store.blankProduct('GINKGO-01', 'Ginkgo Memory Boost');
  Object.assign(ginkgo, {
    category: 'Supplements', status: 'Scaling',
    rnd: { source: '1688', supplier: 'Shenzhen Herba Co.', cost: 85, moq: 100, notes: 'Capsule form, 60ct bottle.', sampleStatus: 'Received' },
    score: { demand: 5, margin: 4, uniqueness: 3, problemSolving: 5, repeatPurchase: 4, total: 21 },
    painPoints: ['Forgets easily', "Can't focus at work", 'Afternoon brain fog'],
    offer: { mechanism: 'Ginkgo + Vitamin B complex', bundle: 'Buy 2 Take 1', guarantee: '30-day money back', bonus: 'Free ebook: Memory Hacks', urgency: 'Promo ends this week' },
    pricing: { srp: 499, cost: 85, shipping: 60, targetCpp: 250, breakevenRoas: 0, projectedMargin: 0 },
    approval: { decision: 'approved', decidedBy: 'You', decidedAt: today, reason: 'Strong demand + solid margin' },
    fbPageChecklist: allChecked(cfg.fbPageChecklist), creativeReqChecklist: allChecked(cfg.creativeReqChecklist),
    fbPageReady: true, creativeReqReady: true,
  });
  store.upsertProduct(ginkgo);

  const scar = store.blankProduct('SCAR-02', 'Scar Remover Gel');
  Object.assign(scar, {
    category: 'Skincare', status: 'Pending',
    rnd: { source: 'Local distributor', supplier: 'Manila Beauty Supply', cost: 70, moq: 50, notes: 'Tube 30g.', sampleStatus: 'Ordered' },
    score: { demand: 4, margin: 4, uniqueness: 2, problemSolving: 4, repeatPurchase: 3, total: 17 },
    painPoints: ['Unsightly scars', "Stretch marks won't fade"],
    offer: { mechanism: 'Onion extract + Vitamin E', bundle: '', guarantee: 'Visible results in 4 weeks', bonus: '', urgency: '' },
    pricing: { srp: 349, cost: 70, shipping: 55, targetCpp: 180, breakevenRoas: 0, projectedMargin: 0 },
    approval: { decision: 'pending', decidedBy: '', decidedAt: '', reason: '' },
    fbPageReady: false, creativeReqReady: false,
  });
  store.upsertProduct(scar);

  store.upsertCreative({ productCode: 'GINKGO-01', type: 'video', title: 'Grandma testimonial UGC', hook: 'Do you keep forgetting names?', script: 'Open on grandma forgetting...', assignee: 'Unassigned', deadline: today, status: 'Winner', metrics: { spend: 4200, revenue: 14800, impressions: 120000, clicks: 2600, purchases: 41 } });
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'image', title: 'Before/After focus chart', hook: 'Brain fog? Try this.', script: '', assignee: 'Unassigned', deadline: today, status: 'Approved', metrics: { spend: 1800, revenue: 3900, impressions: 65000, clicks: 900, purchases: 11 } });
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'video', title: 'Doctor explainer', hook: "Here's what doctors say...", script: '', assignee: 'Unassigned', deadline: yday, status: 'In Progress', metrics: { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 } });

  store.upsertDailyMetric({ productCode: 'GINKGO-01', date: today, spend: 6000, revenue: 18600, impressions: 185000, clicks: 3500, purchases: 52 });
  store.upsertDailyMetric({ productCode: 'GINKGO-01', date: yday, spend: 5200, revenue: 13520, impressions: 160000, clicks: 3000, purchases: 40 });
  store.upsertDailyMetric({ productCode: 'SCAR-02', date: today, spend: 2500, revenue: 4250, impressions: 90000, clicks: 1400, purchases: 14 });
  store.upsertDailyMetric({ productCode: 'SCAR-02', date: yday, spend: 2200, revenue: 2640, impressions: 80000, clicks: 1200, purchases: 9 });

  store.upsertPage({ name: 'GINKGO-01 Memory PH', productCode: 'GINKGO-01', pendingOrders: 12, pendingItems: 18, yesterdaySpend: 5200, status: 'Scaling' });
  store.upsertPage({ name: 'Glow Skincare Store', productCode: '', pendingOrders: 3, pendingItems: 4, yesterdaySpend: 2200, status: 'Testing' });

  store.upsertCompetitor({ brand: 'NeuroMax', product: 'Memory pills', hook: 'Doctors are shocked!', creativeType: 'video', offer: 'Buy 1 Take 1', cta: 'Shop Now', visualStyle: 'Talking head + captions', screenshotUrl: '', recreateStatus: 'Not Started' });
  store.upsertCompetitor({ brand: 'ClearSkin PH', product: 'Scar gel', hook: 'Goodbye scars in 2 weeks', creativeType: 'image', offer: '50% OFF today', cta: 'Order Now', visualStyle: 'Before/after split', screenshotUrl: '', recreateStatus: 'Copied' });

  toast('Sample data loaded.', 'success');
  if (window.STRATOS) window.STRATOS.refreshChrome();
  view.innerHTML = '';
  render(view);
}
