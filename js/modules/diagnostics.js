// diagnostics.js — the Ad Diagnostic engine.
//
// Deterministic "symptom → root cause → fix" mapping for every product that has
// spend. Pure rules over the metrics we already track (CTR, CPM, CPP, ROAS vs
// breakeven, profit, fatigue) — no AI needed, instant, explainable. An optional
// "AI deep-dive" turns the computed diagnosis into a tailored action plan.
//
// This is the playbook's "Diagnostic engine": instead of staring at raw numbers,
// the team sees WHAT is wrong, WHY, and the NEXT move — same logic for everyone.

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import * as ai from '../ai.js';
import { el, button, pageHeader, card, pill, toast, dateRangeControl } from '../ui.js';
import { resolveRange, inRange } from '../util.js';

// PH FB COD benchmarks — sensible defaults (read as directional, not gospel).
const CTR_LOW = 1.0;        // % — below this the creative isn't stopping the scroll
const CPM_HIGH = 250;       // ₱ per 1000 impressions — above this reach is expensive
const MIN_IMPRESSIONS = 1000; // enough delivery to trust CTR/CPM
const WINDOW_DAYS = 7;

const SEV = {
  critical: { rank: 0, tone: 'bad', icon: '🔴' },
  warn: { rank: 1, tone: 'warn', icon: '🟡' },
  info: { rank: 2, tone: 'neutral', icon: 'ℹ️' },
  good: { rank: 3, tone: 'good', icon: '🟢' },
};

// ---------------------------------------------------------------------------
// The engine — pure: code → { state, label, tone, agg, breakeven, profit, items }
// ---------------------------------------------------------------------------
export function diagnose(code, config = store.getConfig(), rr = null) {
  const p = store.getProduct(code);
  let rows = store.getDailyMetricsByProduct(code).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  rows = rr ? rows.filter((r) => inRange(r.date, rr)) : rows.slice(-WINDOW_DAYS);
  const winLabel = rr ? rr.label : `Last ${WINDOW_DAYS} days`;
  const agg = metrics.aggregate(rows);
  const t = config.thresholds || {};

  if (!(agg.spend > 0)) {
    return { state: 'no-data', label: 'No data', tone: 'neutral', agg, breakeven: null, profit: 0, windowLabel: winLabel,
      items: [{ sev: 'info', symptom: 'No spend logged yet', cause: 'Nothing to diagnose until there are results.', fix: 'Add a Daily Metrics row for this product, then re-open Diagnostics.', route: '#/daily', routeLabel: 'Log metrics' }] };
  }

  const pr = (p?.pricing) || {};
  const be = metrics.breakevenRoas(pr.srp, pr.cost, pr.shipping);
  const profitVal = agg.revenue - agg.spend - (agg.purchases * metrics.unitCost(p));
  const items = [];

  // --- Reach / creative signals -------------------------------------------
  if (agg.impressions > 0 && agg.impressions < MIN_IMPRESSIONS) {
    items.push({ sev: 'info', symptom: `Thin delivery (${Math.round(agg.impressions).toLocaleString()} impressions)`,
      cause: 'Not enough delivery yet to judge the creative fairly.', fix: 'Give it a bit more spend/time, or check the budget & audience size before deciding.', route: `#/products/${encodeURIComponent(code)}`, routeLabel: 'Open product' });
  }
  if (agg.ctr !== null && agg.impressions >= 500 && agg.ctr < CTR_LOW) {
    items.push({ sev: 'warn', symptom: `Low CTR (${metrics.fmt(agg.ctr, 'ctr')})`,
      cause: "The hook/thumbnail isn't stopping the scroll — weak creative or wrong audience.", fix: 'Test 3 fresh hooks/angles (Pain, Testimonial, Problem-Solution) and a bolder first frame / thumbnail.', route: '#/content', routeLabel: 'Write new hooks' });
  }
  if (agg.cpm !== null && agg.cpm > CPM_HIGH) {
    items.push({ sev: 'warn', symptom: `High CPM (${metrics.fmt(agg.cpm, 'cpm')})`,
      cause: 'Expensive reach — narrow audience, low ad quality, or heavy competition.', fix: 'Broaden the audience, refresh the creative, and hide/reply to negative comments to lift the quality ranking.', route: '#/creatives', routeLabel: 'New creative' });
  }

  // --- Funnel: clicks but no orders ---------------------------------------
  if (agg.purchases === 0 && agg.clicks >= 20) {
    items.push({ sev: 'critical', symptom: 'Traffic but zero orders',
      cause: 'People click but nobody buys — the offer/price or the message-to-checkout funnel is breaking.', fix: 'Sharpen the offer (bundle, COD reassurance, urgency), speed up page replies/auto-reply, and add a retargeting set for clickers.', route: `#/products/${encodeURIComponent(code)}`, routeLabel: 'Open product' });
  }

  // --- Profitability (ROAS vs breakeven) ----------------------------------
  if (agg.roas !== null) {
    if (be !== null) {
      const beTxt = `breakeven ${metrics.fmt(be, 'roas')}`;
      if (agg.roas >= (t.scaleRoas || 2)) {
        items.push({ sev: 'good', symptom: `Profitable & scalable (ROAS ${metrics.fmt(agg.roas, 'roas')} vs ${beTxt})`,
          cause: 'The economics work — this is a winner.', fix: 'Duplicate the winning ad set, raise budget ~20–30%/day, and build a lookalike from buyers.', route: '#/creatives', routeLabel: 'Scale it' });
      } else if (agg.roas >= be) {
        items.push({ sev: 'info', symptom: `Profitable but thin (ROAS ${metrics.fmt(agg.roas, 'roas')} vs ${beTxt})`,
          cause: 'Above breakeven but not enough cushion to scale safely.', fix: 'Lift AOV (upsell/bundle) and push CPP down with stronger creative before scaling hard.', route: `#/products/${encodeURIComponent(code)}`, routeLabel: 'Open product' });
      } else {
        items.push({ sev: 'critical', symptom: `Below breakeven (ROAS ${metrics.fmt(agg.roas, 'roas')} vs ${beTxt}) — losing ₱${Math.round(Math.abs(profitVal)).toLocaleString()}`,
          cause: 'Selling but unprofitable — CPP too high, or the price/cost economics are off.', fix: 'Cut CPP (kill the weak ads, tighten the audience), raise SRP or bundle to lift AOV, or renegotiate supplier cost.', route: `#/products/${encodeURIComponent(code)}`, routeLabel: 'Fix economics' });
      }
    } else {
      // No breakeven possible — pricing not filled in. Fall back to ROAS thresholds.
      const scale = t.scaleRoas || 2, observe = t.observeRoas || 1;
      const sev = agg.roas >= scale ? 'good' : agg.roas >= observe ? 'info' : 'critical';
      items.push({ sev, symptom: `ROAS ${metrics.fmt(agg.roas, 'roas')} (no breakeven set)`,
        cause: 'Set the product cost & SRP to get a profit-accurate diagnosis.', fix: 'Open the product → Pricing and fill in cost, shipping and SRP, then re-diagnose.', route: `#/products/${encodeURIComponent(code)}`, routeLabel: 'Set pricing' });
    }
  }

  // --- Fatigue ------------------------------------------------------------
  const f = metrics.detectFatigue(code);
  if (f.fatiguing) {
    items.push({ sev: 'warn', symptom: 'Audience fatiguing', cause: f.reason || 'CTR is falling while CPM rises — the audience is saturating.', fix: 'Refresh with a new creative/angle and rotate in a fresh hook before performance slides further.', route: '#/daily', routeLabel: 'See trend' });
  }

  items.sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank);

  const worst = items.reduce((w, it) => Math.min(w, SEV[it.sev].rank), 3);
  const hasWinner = items.some((it) => it.sev === 'good');
  let label = 'Healthy', tone = 'good';
  if (worst === 0) { label = 'Action needed'; tone = 'bad'; }
  else if (worst === 1) { label = 'Watch'; tone = 'warn'; }
  else if (hasWinner) { label = 'Winner'; tone = 'good'; }
  else { label = 'Stable'; tone = 'neutral'; }

  return { state: 'ok', label, tone, agg, breakeven: be, profit: profitVal, windowLabel: winLabel, items };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export function render(view) {
  const range = store.getDateRange();
  const rr = resolveRange(range);
  const picker = dateRangeControl({ value: range, onChange: (resolved, raw) => { store.setDateRange(raw); if (window.STRATOS) window.STRATOS.renderRoute(); } });

  view.appendChild(pageHeader(
    'Diagnostics',
    `Every product with spend, turned into what is wrong, why, and the next move. Window: ${rr.label}.`,
    [picker],
  ));

  const config = store.getConfig();
  const active = store.getProducts()
    .map((p) => ({ p, d: diagnose(p.code, config, rr) }))
    .filter((x) => x.d.state === 'ok')
    .sort((a, b) => {
      const ra = a.d.items[0] ? SEV[a.d.items[0].sev].rank : 9;
      const rb = b.d.items[0] ? SEV[b.d.items[0].sev].rank : 9;
      return ra - rb;
    });

  if (!active.length) {
    view.appendChild(card('No diagnosable products yet',
      el('p', { class: 'muted', style: { margin: 0 }, text: 'Once a product has at least one Daily Metrics row with spend, its diagnosis shows up here.' }),
      el('div', { style: { marginTop: '10px' } }, el('a', { href: '#/daily', class: 'btn btn--primary btn--sm', text: 'Go to Daily Metrics' })),
    ));
    return;
  }

  // Summary line
  const crit = active.filter((x) => x.d.tone === 'bad').length;
  const watch = active.filter((x) => x.d.tone === 'warn').length;
  const healthy = active.length - crit - watch;
  view.appendChild(el('div', { class: 'row', style: { gap: '14px', margin: '0 0 4px', flexWrap: 'wrap', fontSize: '13px' } },
    el('span', {}, el('b', { style: { color: 'var(--bad)' }, text: String(crit) }), document.createTextNode(' need action')),
    el('span', {}, el('b', { style: { color: 'var(--warn)' }, text: String(watch) }), document.createTextNode(' to watch')),
    el('span', {}, el('b', { style: { color: 'var(--good)' }, text: String(healthy) }), document.createTextNode(' healthy')),
  ));

  for (const { p, d } of active) view.appendChild(productCard(p, d));
}

function metricChip(label, value) {
  return el('span', { class: 'chip', style: { fontSize: '12px' } }, el('b', { text: value }), document.createTextNode(' ' + label));
}

function productCard(p, d) {
  const c = el('section', { class: 'card' });
  c.appendChild(el('div', { class: 'spread', style: { alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' } },
    el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
      el('h3', { class: 'card__title', style: { margin: 0 }, text: `${p.code} — ${p.name || ''}` }),
      pill(d.label, { tone: d.tone })),
    el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
      metricChip('ROAS', metrics.fmt(d.agg.roas, 'roas')),
      metricChip('CPP', metrics.fmt(d.agg.cpp, 'cpp')),
      metricChip('CPM', metrics.fmt(d.agg.cpm, 'cpm')),
      metricChip('CTR', metrics.fmt(d.agg.ctr, 'ctr')),
      metricChip('profit', metrics.fmt(d.profit, 'peso')),
    ),
  ));

  const list = el('div', { class: 'stack', style: { gap: '10px' } });
  for (const it of d.items) {
    const s = SEV[it.sev];
    list.appendChild(el('div', { class: 'diag-item', style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' } },
      el('span', { style: { fontSize: '15px', lineHeight: '1.3' }, text: s.icon }),
      el('div', { style: { flex: 1 } },
        el('div', { style: { fontWeight: '600', marginBottom: '2px' }, text: it.symptom }),
        el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '4px' }, text: it.cause }),
        el('div', { style: { fontSize: '13px' } }, el('b', { text: 'Fix: ' }), document.createTextNode(it.fix)),
      ),
      it.route ? el('a', { href: it.route, class: 'btn btn--ghost btn--sm', style: { whiteSpace: 'nowrap' }, text: it.routeLabel || 'Open' }) : null,
    ));
  }
  c.appendChild(list);

  c.appendChild(el('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } },
    button('🧠 AI deep-dive', { variant: 'ghost', onClick: () => aiDeepDive(p, d) }),
  ));
  return c;
}

function aiDeepDive(p, d) {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  const found = d.items.map((it) => `- ${it.symptom}: ${it.cause}`).join('\n');
  const stats = `ROAS ${metrics.fmt(d.agg.roas, 'roas')}, CPP ${metrics.fmt(d.agg.cpp, 'cpp')}, CPM ${metrics.fmt(d.agg.cpm, 'cpm')}, CTR ${metrics.fmt(d.agg.ctr, 'ctr')}, spend ${metrics.fmt(d.agg.spend, 'peso')}, ${d.agg.purchases} orders, profit ${metrics.fmt(d.profit, 'peso')}${d.breakeven !== null ? `, breakeven ROAS ${metrics.fmt(d.breakeven, 'roas')}` : ''}.`;

  ai.openAiEditor({
    title: `AI deep-dive — ${p.code}`,
    system: `${ai.languageDirective()} You are a senior Philippine FB/TikTok COD performance marketer doing a focused diagnosis. Be specific and prioritized — no fluff, no generic advice.`,
    user: `${ai.productContext(p)}\n\n${d.windowLabel || 'Recent'} numbers: ${stats}\n\nThe deterministic engine flagged:\n${found}\n\nWrite a tight action plan with these exact sections:\n🔎 ROOT CAUSE — the single most likely reason performance looks like this.\n✅ DO THIS NEXT (24–48h) — 3 concrete actions in priority order.\n🧪 TEST — 2 specific creative/offer tests to run.\n📈 SCALE OR KILL — the rule: at what number do we scale, and at what number do we kill.\n\nFormat as plain readable text — no markdown symbols (no **, no ##, no backticks). Keep the emoji headers exactly, blank line between sections, start each item with "• ".`,
    genOpts: { maxTokens: 1100 },
    saveLabel: 'Save to product brief',
    onSave: (text) => {
      const fresh = store.getProduct(p.code);
      if (!fresh) return;
      fresh.brief = (fresh.brief ? fresh.brief + '\n\n' : '') + 'DIAGNOSIS:\n' + text;
      store.upsertProduct(fresh);
      toast('Saved to product brief.', 'success');
    },
  });
}
