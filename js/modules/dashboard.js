// dashboard.js — landing page. Summary of the whole command center +
// quick links into each module. Includes a one-click sample-data loader so the
// app is explorable end-to-end before you enter real data.

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import { el, button, pageHeader, statTile, card, pill, toast, confirmDialog } from '../ui.js';
import { todayStr, yesterdayStr } from '../util.js';

const MODULES = [
  { route: 'products', title: 'Product Testing', desc: 'R&D, scoring, offers, pricing & launch readiness — the hub.' },
  { route: 'creatives', title: 'Creative Testing', desc: 'Brief, assign & rank image/video creatives.' },
  { route: 'daily', title: 'Daily Dashboard', desc: 'Daily spend/revenue → ROAS, CPP, CPM, CTR & scale calls.' },
  { route: 'pages', title: 'Page Status', desc: 'Per-Facebook-Page performance & product mapping.' },
  { route: 'content', title: 'AI Content', desc: 'Captions, hooks, headlines & scripts in Taglish.' },
  { route: 'competitors', title: 'Competitor Ads', desc: 'Track competitor ads & recreate / improve them.' },
];

export function render(view) {
  const s = store.getSummary();
  view.appendChild(pageHeader(
    'Dashboard',
    'STRATOS Marketing Command Center — your product-testing & scaling pipeline.',
    store.getProducts().length ? [button('+ New product', { variant: 'primary', onClick: () => { location.hash = '#/products'; } })] : [],
  ));

  // ---- action-needed alerts ----
  const alerts = metrics.computeAlerts();
  if (alerts.length) {
    const c = el('section', { class: 'card', style: { borderLeft: '3px solid var(--warn)', marginBottom: 'var(--gap)' } });
    c.appendChild(el('h3', { class: 'card__title', text: `Action needed (${alerts.length})` }));
    const list = el('div', { class: 'stack', style: { gap: '6px' } });
    alerts.forEach((a) => list.appendChild(el('a', { href: a.route, class: 'spread', style: { padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' } },
      el('span', { text: `${a.icon}  ${a.text}` }),
      el('span', { class: `pill pill--${a.level === 'bad' ? 'bad' : 'warn'}`, text: a.level === 'bad' ? 'urgent' : 'review' }))));
    c.appendChild(list);
    view.appendChild(c);
  }

  // ---- top-level stats ----
  const stats = el('div', { class: 'grid grid-4' },
    statTile('Products', String(s.products), { sub: statusLine(s.byStatus) }),
    statTile('Creatives', String(s.creatives)),
    statTile('Pages', String(s.pages)),
    statTile('Competitor ads', String(s.competitors)),
  );
  view.appendChild(stats);

  // ---- empty state with sample loader ----
  if (s.products === 0 && s.creatives === 0 && s.competitors === 0) {
    const actions = el('div', { class: 'row', style: { marginTop: '8px' } },
      button('Load sample data', { variant: 'primary', onClick: () => loadSample(view) }),
      button('Start with a product', { variant: 'ghost', onClick: () => { location.hash = '#/products'; } }),
    );
    view.appendChild(card('Get started',
      el('p', { class: 'muted', text: 'No data yet. Load a small sample dataset (2 products with creatives, daily metrics, pages & competitors) to explore every module, or jump straight into adding your first product.' }),
      actions,
    ));
  }

  // ---- module quick links ----
  const links = el('div', { class: 'grid grid-3', style: { marginTop: 'var(--gap)' } });
  for (const m of MODULES) {
    const c = el('a', { class: 'card', href: `#/${m.route}`, style: { cursor: 'pointer', textDecoration: 'none' } },
      el('h3', { class: 'card__title', text: m.title }),
      el('p', { class: 'muted', style: { margin: 0 }, text: m.desc }),
    );
    links.appendChild(c);
  }
  view.appendChild(el('h3', { class: 'card__title', style: { marginTop: 'var(--gap-lg)' }, text: 'Modules' }));
  view.appendChild(links);

  // ---- recent products ----
  const recent = store.getProducts().slice(-6).reverse();
  if (recent.length) {
    const list = el('div', { class: 'stack' });
    for (const p of recent) {
      list.appendChild(el('a', { class: 'spread card', href: `#/products/${encodeURIComponent(p.code)}`, style: { padding: '12px 16px' } },
        el('div', {}, el('span', { class: 'code-badge', text: p.code }), el('span', { text: '  ' + (p.name || ''), style: { marginLeft: '8px' } })),
        pill(p.status),
      ));
    }
    view.appendChild(el('h3', { class: 'card__title', style: { marginTop: 'var(--gap-lg)' }, text: 'Recent products' }));
    view.appendChild(list);
  }
}

function statusLine(byStatus) {
  const parts = [];
  for (const k of ['Scaling', 'Ready', 'Pending', 'Failed']) {
    if (byStatus[k]) parts.push(`${byStatus[k]} ${k}`);
  }
  return parts.join(' · ') || 'none yet';
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

  // --- Products ---
  const cfg = store.getConfig();
  const allChecked = (arr) => Object.fromEntries(arr.map((i) => [i, true]));

  const ginkgo = store.blankProduct('GINKGO-01', 'Ginkgo Memory Boost');
  Object.assign(ginkgo, {
    category: 'Supplements',
    status: 'Scaling',
    rnd: { source: '1688', supplier: 'Shenzhen Herba Co.', cost: 85, moq: 100, notes: 'Capsule form, 60ct bottle.', sampleStatus: 'Received' },
    score: { demand: 5, margin: 4, uniqueness: 3, problemSolving: 5, repeatPurchase: 4, total: 21 },
    painPoints: ['Nakakalimot agad (forgetfulness)', 'Hindi makapag-focus sa trabaho', 'Brain fog tuwing hapon'],
    offer: { mechanism: 'Ginkgo + Vitamin B complex', bundle: 'Buy 2 Take 1', guarantee: '30-day money back', bonus: 'Free ebook: Memory Hacks', urgency: 'Promo ends this week' },
    pricing: { srp: 499, cost: 85, shipping: 60, targetCpp: 250, breakevenRoas: 0, projectedMargin: 0 },
    approval: { decision: 'approved', decidedBy: 'You', decidedAt: today, reason: 'Strong demand + solid margin' },
    // checklists fully ticked → fbPageReady / creativeReqReady derive to true
    fbPageChecklist: allChecked(cfg.fbPageChecklist),
    creativeReqChecklist: allChecked(cfg.creativeReqChecklist),
    fbPageReady: true, creativeReqReady: true,
  });
  store.upsertProduct(ginkgo);

  const scar = store.blankProduct('SCAR-02', 'Scar Remover Gel');
  Object.assign(scar, {
    category: 'Skincare',
    status: 'Pending',
    rnd: { source: 'Local distributor', supplier: 'Manila Beauty Supply', cost: 70, moq: 50, notes: 'Tube 30g.', sampleStatus: 'Ordered' },
    score: { demand: 4, margin: 4, uniqueness: 2, problemSolving: 4, repeatPurchase: 3, total: 17 },
    painPoints: ['Pangit ang peklat (scars)', 'Hindi nawawala ang stretch marks'],
    offer: { mechanism: 'Onion extract + Vitamin E', bundle: '', guarantee: 'Visible results in 4 weeks', bonus: '', urgency: '' },
    pricing: { srp: 349, cost: 70, shipping: 55, targetCpp: 180, breakevenRoas: 0, projectedMargin: 0 },
    approval: { decision: 'pending', decidedBy: '', decidedAt: '', reason: '' },
    fbPageReady: false, creativeReqReady: false,
  });
  store.upsertProduct(scar);

  // --- Creatives (linked to GINKGO-01) ---
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'video', title: 'Lola testimonial UGC', hook: 'Nakakalimutan mo na ba ang mga pangalan?', script: 'Open on lola forgetting...', assignee: 'Unassigned', deadline: today, status: 'Winner', metrics: { spend: 4200, revenue: 14800, impressions: 120000, clicks: 2600, purchases: 41 } });
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'image', title: 'Before/After focus chart', hook: 'Brain fog? Subukan mo \'to.', script: '', assignee: 'Unassigned', deadline: today, status: 'Approved', metrics: { spend: 1800, revenue: 3900, impressions: 65000, clicks: 900, purchases: 11 } });
  store.upsertCreative({ productCode: 'GINKGO-01', type: 'video', title: 'Doctor explainer', hook: 'Ito ang sinasabi ng mga doktor...', script: '', assignee: 'Unassigned', deadline: yday, status: 'In Progress', metrics: { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 } });

  // --- Daily metrics (today + yesterday) ---
  store.upsertDailyMetric({ productCode: 'GINKGO-01', date: today, spend: 6000, revenue: 18600, impressions: 185000, clicks: 3500, purchases: 52 }); // ROAS 3.1 -> Scale
  store.upsertDailyMetric({ productCode: 'GINKGO-01', date: yday, spend: 5200, revenue: 13520, impressions: 160000, clicks: 3000, purchases: 40 });
  store.upsertDailyMetric({ productCode: 'SCAR-02', date: today, spend: 2500, revenue: 4250, impressions: 90000, clicks: 1400, purchases: 14 }); // ROAS 1.7 -> Observe
  store.upsertDailyMetric({ productCode: 'SCAR-02', date: yday, spend: 2200, revenue: 2640, impressions: 80000, clicks: 1200, purchases: 9 });  // ROAS 1.2 -> Kill

  // --- Pages ---
  store.upsertPage({ name: 'GINKGO-01 Memory PH', productCode: 'GINKGO-01', pendingOrders: 12, pendingItems: 18, yesterdaySpend: 5200, status: 'Scaling' });
  store.upsertPage({ name: 'Glow Skincare Store', productCode: '', pendingOrders: 3, pendingItems: 4, yesterdaySpend: 2200, status: 'Testing' });

  // --- Competitors ---
  store.upsertCompetitor({ brand: 'NeuroMax', product: 'Memory pills', hook: 'Doctors are shocked!', creativeType: 'video', offer: 'Buy 1 Take 1', cta: 'Shop Now', visualStyle: 'Talking head + captions', screenshotUrl: '', recreateStatus: 'Not Started' });
  store.upsertCompetitor({ brand: 'ClearSkin PH', product: 'Scar gel', hook: 'Goodbye peklat in 2 weeks', creativeType: 'image', offer: '50% OFF today', cta: 'Order Now', visualStyle: 'Before/after split', screenshotUrl: '', recreateStatus: 'Copied' });

  toast('Sample data loaded.', 'success');
  if (window.STRATOS) window.STRATOS.refreshChrome();
  // re-render dashboard
  view.innerHTML = '';
  render(view);
}
