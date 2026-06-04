// dashboard.js — decision-first "Today" command center.
// Order = what you act on first: alerts → today's KPIs → scale/kill calls →
// top movers → pipeline snapshot → module links / recent (progressive disclosure).

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import { el, button, pageHeader, statTile, card, pill, toast, confirmDialog, lineChart, barChart, countUp } from '../ui.js';
import { todayStr, yesterdayStr } from '../util.js';

const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();

const MODULES = [
  { route: 'products', title: 'Product Testing', desc: 'R&D, scoring, offers, pricing & launch readiness — the hub.' },
  { route: 'creatives', title: 'Creative Testing', desc: 'Brief, assign & rank image/video creatives.' },
  { route: 'daily', title: 'Daily Dashboard', desc: 'Daily spend/revenue → ROAS, CPP, CPM, CTR & scale calls.' },
  { route: 'pages', title: 'Page Status', desc: 'Per-Facebook-Page performance & product mapping.' },
  { route: 'content', title: 'AI Content', desc: 'Captions, hooks, headlines & scripts in Taglish.' },
  { route: 'competitors', title: 'Competitor Ads', desc: 'Track competitor ads & recreate / improve them.' },
];

export function render(view) {
  const products = store.getProducts();
  const s = store.getSummary();
  const today = todayStr();
  const yday = yesterdayStr();
  const cfg = store.getConfig();

  view.appendChild(pageHeader(
    'Today', `Mga dapat aksyunan ngayon · ${today}`,
    (products.length && isAdmin()) ? [button('+ New product', { variant: 'primary', onClick: () => { location.hash = '#/products'; } })] : [],
  ));

  // ---- empty state ----
  if (s.products === 0 && s.creatives === 0 && s.competitors === 0) {
    view.appendChild(card('Get started',
      isAdmin()
        ? el('p', { class: 'muted', text: 'No data yet. Load a small sample dataset (2 products with creatives, daily metrics, pages & competitors) to explore every module, or jump straight into adding your first product.' })
        : el('p', { class: 'muted', text: 'Wala pang data. Hintayin ang Advertiser na mag-set up — pagkatapos makikita mo dito ang mga creatives na assigned sa iyo.' }),
      isAdmin() ? el('div', { class: 'row', style: { marginTop: '8px' } },
        button('Load sample data', { variant: 'primary', onClick: () => loadSample(view) }),
        button('Start with a product', { variant: 'ghost', onClick: () => { location.hash = '#/products'; } }),
      ) : null,
    ));
    return;
  }

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
      'No metrics logged for today yet — ', el('a', { href: '#/daily', style: { color: 'var(--accent)' }, text: 'log them in the Daily Dashboard →' })));
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
      lineChart([{ name: 'Spend', color: '#4F7BFF', values: spendSeries }, { name: 'Revenue', color: '#2DD4A7', values: revSeries }],
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
    painPoints: ['Nakakalimot agad (forgetfulness)', 'Hindi makapag-focus sa trabaho', 'Brain fog tuwing hapon'],
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
    painPoints: ['Pangit ang peklat (scars)', 'Hindi nawawala ang stretch marks'],
    offer: { mechanism: 'Onion extract + Vitamin E', bundle: '', guarantee: 'Visible results in 4 weeks', bonus: '', urgency: '' },
    pricing: { srp: 349, cost: 70, shipping: 55, targetCpp: 180, breakevenRoas: 0, projectedMargin: 0 },
    approval: { decision: 'pending', decidedBy: '', decidedAt: '', reason: '' },
    fbPageReady: false, creativeReqReady: false,
  });
  store.upsertProduct(scar);

  store.upsertCreative({ productCode: 'GINKGO-01', type: 'video', title: 'Lola testimonial UGC', hook: 'Nakakalimutan mo na ba ang mga pangalan?', script: 'Open on lola forgetting...', assignee: 'Unassigned', deadline: today, status: 'Winner', metrics: { spend: 4200, revenue: 14800, impressions: 120000, clicks: 2600, purchases: 41 } });
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'image', title: 'Before/After focus chart', hook: 'Brain fog? Subukan mo \'to.', script: '', assignee: 'Unassigned', deadline: today, status: 'Approved', metrics: { spend: 1800, revenue: 3900, impressions: 65000, clicks: 900, purchases: 11 } });
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'video', title: 'Doctor explainer', hook: 'Ito ang sinasabi ng mga doktor...', script: '', assignee: 'Unassigned', deadline: yday, status: 'In Progress', metrics: { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 } });

  store.upsertDailyMetric({ productCode: 'GINKGO-01', date: today, spend: 6000, revenue: 18600, impressions: 185000, clicks: 3500, purchases: 52 });
  store.upsertDailyMetric({ productCode: 'GINKGO-01', date: yday, spend: 5200, revenue: 13520, impressions: 160000, clicks: 3000, purchases: 40 });
  store.upsertDailyMetric({ productCode: 'SCAR-02', date: today, spend: 2500, revenue: 4250, impressions: 90000, clicks: 1400, purchases: 14 });
  store.upsertDailyMetric({ productCode: 'SCAR-02', date: yday, spend: 2200, revenue: 2640, impressions: 80000, clicks: 1200, purchases: 9 });

  store.upsertPage({ name: 'GINKGO-01 Memory PH', productCode: 'GINKGO-01', pendingOrders: 12, pendingItems: 18, yesterdaySpend: 5200, status: 'Scaling' });
  store.upsertPage({ name: 'Glow Skincare Store', productCode: '', pendingOrders: 3, pendingItems: 4, yesterdaySpend: 2200, status: 'Testing' });

  store.upsertCompetitor({ brand: 'NeuroMax', product: 'Memory pills', hook: 'Doctors are shocked!', creativeType: 'video', offer: 'Buy 1 Take 1', cta: 'Shop Now', visualStyle: 'Talking head + captions', screenshotUrl: '', recreateStatus: 'Not Started' });
  store.upsertCompetitor({ brand: 'ClearSkin PH', product: 'Scar gel', hook: 'Goodbye peklat in 2 weeks', creativeType: 'image', offer: '50% OFF today', cta: 'Order Now', visualStyle: 'Before/after split', screenshotUrl: '', recreateStatus: 'Copied' });

  toast('Sample data loaded.', 'success');
  if (window.STRATOS) window.STRATOS.refreshChrome();
  view.innerHTML = '';
  render(view);
}
