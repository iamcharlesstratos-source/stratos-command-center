// metrics.js — pure metric math + deterministic ranking/labeling/auto-tag.
//
// Ratios are NEVER stored; they are computed live from raw inputs. Every ratio
// guards against divide-by-zero and returns null (rendered as "—" by fmt()).
//
// This module may read the store for product-level rollups, but the store never
// imports metrics, so there is no import cycle.

import * as store from './store.js';
import { todayStr } from './util.js';

// ---------------------------------------------------------------------------
// Core ratios (pure; null on divide-by-zero)
// ---------------------------------------------------------------------------
export function roas(revenue, spend) { return spend > 0 ? revenue / spend : null; }
export function cpp(spend, purchases) { return purchases > 0 ? spend / purchases : null; }
export function cpm(spend, impressions) { return impressions > 0 ? (spend / impressions) * 1000 : null; }
export function ctr(clicks, impressions) { return impressions > 0 ? (clicks / impressions) * 100 : null; }

/** Compute all four ratios from a raw metrics object. */
export function computeMetrics(m = {}) {
  const spend = num(m.spend), revenue = num(m.revenue), impressions = num(m.impressions),
        clicks = num(m.clicks), purchases = num(m.purchases);
  return {
    spend, revenue, impressions, clicks, purchases,
    roas: roas(revenue, spend),
    cpp: cpp(spend, purchases),
    cpm: cpm(spend, impressions),
    ctr: ctr(clicks, impressions),
  };
}

/** Sum a list of raw metric rows, then compute ratios on the totals. */
export function aggregate(rows = []) {
  const sum = { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 };
  for (const r of rows) {
    sum.spend += num(r.spend); sum.revenue += num(r.revenue);
    sum.impressions += num(r.impressions); sum.clicks += num(r.clicks);
    sum.purchases += num(r.purchases);
  }
  return computeMetrics(sum);
}

// ---------------------------------------------------------------------------
// Formatting (one place so every module shows ratios identically)
// ---------------------------------------------------------------------------
export function fmt(value, kind) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  switch (kind) {
    case 'roas': return value.toFixed(2) + '×';
    case 'cpp': return '₱' + value.toLocaleString('en-PH', { maximumFractionDigits: 0 });
    case 'cpm': return '₱' + value.toLocaleString('en-PH', { maximumFractionDigits: 0 });
    case 'ctr': return value.toFixed(2) + '%';
    case 'peso': return '₱' + value.toLocaleString('en-PH', { maximumFractionDigits: 2 });
    default: return String(value);
  }
}

// ---------------------------------------------------------------------------
// Scale / Observe / Kill labeling (editable thresholds from config)
// ---------------------------------------------------------------------------
/** Returns 'Scale' | 'Observe' | 'Kill' | null (null when ROAS is unknown). */
export function labelForRoas(roasValue, thresholds) {
  if (roasValue === null || roasValue === undefined || !Number.isFinite(roasValue)) return null;
  const { scaleRoas, observeRoas } = thresholds;
  if (roasValue >= scaleRoas) return 'Scale';
  if (roasValue >= observeRoas) return 'Observe';
  return 'Kill';
}

// ---------------------------------------------------------------------------
// Per-product rollups (read store)
// ---------------------------------------------------------------------------
/** The product's most recent daily-metric row (max date), or null. */
export function latestMetric(code) {
  const rows = store.getDailyMetricsByProduct(code);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (a.date >= b.date ? a : b));
}

/** ROAS of the product's most recent metric day (drives Module 1 "Scaling"). */
export function currentRoas(code) {
  const m = latestMetric(code);
  return m ? roas(num(m.revenue), num(m.spend)) : null;
}

/** Scale/Observe/Kill label for the product's current (latest-day) ROAS. */
export function currentLabel(code, config = store.getConfig()) {
  return labelForRoas(currentRoas(code), config.thresholds);
}

// ---------------------------------------------------------------------------
// Pricing helpers (Module 1)
// ---------------------------------------------------------------------------
/**
 * Breakeven ROAS = SRP / (SRP − cost − shipping). Returns null when the
 * contribution margin (SRP − cost − shipping) is <= 0 (no breakeven possible).
 */
export function breakevenRoas(srp, cost, shipping) {
  const margin = num(srp) - num(cost) - num(shipping);
  return margin > 0 ? num(srp) / margin : null;
}
/** Projected margin per unit in pesos (SRP − cost − shipping). */
export function projectedMargin(srp, cost, shipping) {
  return num(srp) - num(cost) - num(shipping);
}
/** Projected margin as a % of SRP, or null. */
export function marginPct(srp, cost, shipping) {
  const s = num(srp);
  return s > 0 ? (projectedMargin(s, cost, shipping) / s) * 100 : null;
}

// ---------------------------------------------------------------------------
// Deterministic product auto-tag (Module 1)
//   Failed  : approval rejected OR score.total < failScore
//   Scaling : product's current-day ROAS >= scaleRoas
//   Ready   : approved AND fbPageReady AND creativeReqReady AND >=1 Approved creative
//   Pending : otherwise
// Precedence: Failed > Scaling > Ready > Pending.
// ---------------------------------------------------------------------------
export function computeStatus(product, config = store.getConfig()) {
  const t = config.thresholds;
  const rejected = product.approval && product.approval.decision === 'rejected';
  const lowScore = (product.score?.total ?? 0) < t.failScore;
  if (rejected || lowScore) return 'Failed';

  const cr = currentRoas(product.code);
  if (cr !== null && cr >= t.scaleRoas) return 'Scaling';

  const approved = product.approval && product.approval.decision === 'approved';
  const hasApprovedCreative = store.getCreativesByProduct(product.code)
    .some((c) => ['Approved', 'Launched', 'Winner'].includes(c.status));
  if (approved && product.fbPageReady && product.creativeReqReady && hasApprovedCreative) return 'Ready';

  return 'Pending';
}

/** Recompute a product's status from current data and persist if it changed. */
export function recomputeStatus(code, config = store.getConfig()) {
  const p = store.getProduct(code);
  if (!p) return null;
  const next = computeStatus(p, config);
  if (next !== p.status) {
    store.upsertProduct({ ...p, status: next });
  }
  return next;
}

/** Recompute every product's status (used after bulk changes / imports). */
export function recomputeAllStatuses() {
  const config = store.getConfig();
  for (const p of store.getProducts()) recomputeStatus(p.code, config);
}

/**
 * Launch-readiness as a 0–100% gauge + checklist of gates. Independent of the
 * status tag — it shows how close a product is to being launch-ready.
 */
export function launchReadiness(product) {
  const cfg = store.getConfig();
  const gates = [
    { label: 'Approved', ok: product.approval?.decision === 'approved' },
    { label: 'Score ≥ ' + cfg.thresholds.failScore, ok: (product.score?.total ?? 0) >= cfg.thresholds.failScore },
    { label: 'FB Page ready', ok: !!product.fbPageReady },
    { label: 'Creative req ready', ok: !!product.creativeReqReady },
    { label: '≥1 approved creative', ok: store.getCreativesByProduct(product.code).some((c) => ['Approved', 'Launched', 'Winner'].includes(c.status)) },
  ];
  const done = gates.filter((g) => g.ok).length;
  return { gates, done, total: gates.length, pct: Math.round((done / gates.length) * 100) };
}

// ---------------------------------------------------------------------------
// Creative composite ranking (Module 2) — ROAS↑ CPP↓ CTR↑ CPM↓, editable weights
// Min-max normalizes each metric across the candidate set so weights compose.
// ---------------------------------------------------------------------------
export function rankCreatives(creatives, weights) {
  const withMetrics = creatives
    .map((c) => ({ creative: c, m: computeMetrics(c.metrics || {}) }))
    .filter((x) => x.m.spend > 0 || x.m.revenue > 0 || x.m.impressions > 0); // skip un-run creatives

  if (!withMetrics.length) return [];

  const dims = [
    { key: 'roas', dir: 1, w: weights.roas },
    { key: 'cpp', dir: -1, w: weights.cpp },  // lower is better
    { key: 'ctr', dir: 1, w: weights.ctr },
    { key: 'cpm', dir: -1, w: weights.cpm },  // lower is better
  ];

  const ranges = {};
  for (const d of dims) {
    const vals = withMetrics.map((x) => x.m[d.key]).filter((v) => v !== null && Number.isFinite(v));
    ranges[d.key] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  const totalW = dims.reduce((s, d) => s + (d.w || 0), 0) || 1;

  for (const x of withMetrics) {
    let score = 0;
    for (const d of dims) {
      const v = x.m[d.key];
      if (v === null || !Number.isFinite(v)) continue;
      const { min, max } = ranges[d.key];
      let norm = max > min ? (v - min) / (max - min) : 1; // 0..1, higher=bigger value
      if (d.dir < 0) norm = 1 - norm;                     // invert when lower-is-better
      score += (d.w || 0) * norm;
    }
    x.score = (score / totalW) * 100; // 0..100 composite
  }

  withMetrics.sort((a, b) => b.score - a.score);
  return withMetrics.map((x, i) => ({ ...x.creative, _metrics: x.m, _score: x.score, _rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Profit (margin-aware) — uses the product's landed unit cost
// ---------------------------------------------------------------------------
/** Landed unit cost = product cost + shipping (from pricing). */
export function unitCost(product) {
  const p = (product && product.pricing) || {};
  return num(p.cost) + num(p.shipping);
}
/** Estimated profit for a raw metric row: revenue − spend − purchases×(cost+shipping). */
export function profit(metricRow, product) {
  const m = computeMetrics(metricRow || {});
  return m.revenue - m.spend - (m.purchases * unitCost(product));
}
/**
 * Margin label from profit relative to ad spend:
 *   Profitable (>+5% of spend) | Breakeven (±5%) | Bleeding (<−5%) | null (no spend).
 */
export function profitLabel(profitValue, spend) {
  if (!Number.isFinite(profitValue) || num(spend) <= 0) return null;
  const ratio = profitValue / num(spend);
  if (ratio > 0.05) return 'Profitable';
  if (ratio >= -0.05) return 'Breakeven';
  return 'Bleeding';
}

// ---------------------------------------------------------------------------
// Time series + fatigue (Module 3 trends)
// ---------------------------------------------------------------------------
/** A product's daily metrics oldest→newest (computed + profit), last `days`, up to endDate. */
export function productSeries(code, days = 7, endDate = null) {
  const product = store.getProduct(code);
  let rows = store.getDailyMetricsByProduct(code).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  if (endDate) rows = rows.filter((r) => r.date <= endDate);
  return rows.slice(-days).map((r) => ({ date: r.date, ...computeMetrics(r), profit: profit(r, product) }));
}
/**
 * Creative/product fatigue heuristic: over the last 3+ logged days, CTR
 * net-declines >=20% AND CPM net-rises >=15% (audience saturating).
 */
export function detectFatigue(code) {
  const s = productSeries(code, 4).filter((d) => d.ctr !== null && d.cpm !== null);
  if (s.length < 3) return { fatiguing: false, reason: '' };
  const first = s[0], last = s[s.length - 1];
  const ctrDrop = first.ctr > 0 ? (first.ctr - last.ctr) / first.ctr : 0;
  const cpmRise = first.cpm > 0 ? (last.cpm - first.cpm) / first.cpm : 0;
  const fatiguing = ctrDrop >= 0.2 && cpmRise >= 0.15;
  return { fatiguing, reason: fatiguing ? `CTR ↓${Math.round(ctrDrop * 100)}% · CPM ↑${Math.round(cpmRise * 100)}% over ${s.length}d` : '' };
}

// ---------------------------------------------------------------------------
// Deterministic alerts (Dashboard card + header chip)
// ---------------------------------------------------------------------------
export function computeAlerts() {
  const out = [];
  const today = todayStr();

  // overdue creatives
  const overdue = store.getCreatives().filter((c) => c.deadline && c.deadline < today && !['Approved', 'Launched', 'Winner'].includes(c.status));
  if (overdue.length) out.push({ level: 'bad', icon: '⏰', text: `${overdue.length} creative${overdue.length > 1 ? 's' : ''} overdue`, route: '#/creatives' });

  // creatives the Graphic Artist submitted, waiting for review
  const forReview = store.getCreatives().filter((c) => c.status === 'For Review');
  if (forReview.length) out.push({ level: 'warn', icon: '🎨', text: `${forReview.length} creative${forReview.length > 1 ? 's' : ''} for review`, route: '#/creatives' });

  // scheduled launches due today or overdue (not yet launched)
  const dueLaunch = store.getCreatives().filter((c) => c.launchDate && c.launchDate <= today && !['Launched', 'Winner'].includes(c.status));
  if (dueLaunch.length) out.push({ level: 'warn', icon: '🚀', text: `${dueLaunch.length} creative${dueLaunch.length > 1 ? 's' : ''} due to launch`, route: '#/creatives' });

  // per-product: bleeding (latest day) + fatigue
  for (const p of store.getProducts()) {
    const m = latestMetric(p.code);
    if (m && num(m.spend) > 0) {
      const pr = profit(m, p);
      if (profitLabel(pr, m.spend) === 'Bleeding') {
        out.push({ level: 'bad', icon: '💸', text: `${p.code} bleeding ₱${Math.round(Math.abs(pr))} (${m.date})`, route: `#/products/${encodeURIComponent(p.code)}` });
      }
    }
    const f = detectFatigue(p.code);
    if (f.fatiguing) out.push({ level: 'warn', icon: '🔻', text: `${p.code} fatiguing — ${f.reason}`, route: '#/daily' });
  }

  // unmapped pages
  const unmapped = store.getPages().filter((pg) => !pg.productCode).length;
  if (unmapped) out.push({ level: 'warn', icon: '🗺️', text: `${unmapped} page${unmapped > 1 ? 's' : ''} need mapping`, route: '#/pages' });

  return out;
}

// ---------------------------------------------------------------------------
// Per-creative metrics rollups (Module 2 — daily rows if present, else the blob)
// ---------------------------------------------------------------------------
/** Effective RAW metrics for a creative: sum of its daily rows if any, else its stored blob. */
export function creativeRawMetrics(creative) {
  const rows = store.getCreativeMetricsByCreative(creative.id);
  if (rows.length) {
    const a = aggregate(rows);
    return { spend: a.spend, revenue: a.revenue, impressions: a.impressions, clicks: a.clicks, purchases: a.purchases };
  }
  return creative.metrics || { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 };
}
/** A creative's daily metrics oldest→newest (computed), last `days`. */
export function creativeSeries(creativeId, days = 7) {
  const rows = store.getCreativeMetricsByCreative(creativeId).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows.slice(-days).map((r) => ({ date: r.date, ...computeMetrics(r) }));
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
