// store.js — THE shared data layer.
//
// This is the ONLY module that touches localStorage. Every other module goes
// through these typed CRUD helpers, so entities stay consistent and linkable by
// `productCode`. All collections are stored as JSON arrays under namespaced
// keys. Config is stored as a single object merged over DEFAULT_CONFIG.
//
// A tiny pub/sub (subscribe/emit) lets the shell keep header chips live when
// data changes. Modules generally re-render themselves after their own writes;
// navigation always re-renders a view fresh from the store.

import { DEFAULT_CONFIG, mergeConfig, structuredCloneSafe } from './config.js';
import { uid, nowISO } from './util.js';

const NS = 'stratos';
export const KEYS = {
  products: `${NS}:products`,
  creatives: `${NS}:creatives`,
  creativeMetrics: `${NS}:creativeMetrics`, // per-creative daily rows (creativeId + date)
  dailyMetrics: `${NS}:dailyMetrics`,
  pages: `${NS}:pages`,
  competitors: `${NS}:competitors`,
  hooks: `${NS}:hooks`,        // Module 2 reusable hook bank
  experiments: `${NS}:experiments`, // A/B tests / experiment log
  briefs: `${NS}:briefs`,      // War Room daily brief, keyed by date
  dailyReports: `${NS}:dailyReports`, // Module 3 AI daily reports, keyed by date
  config: `${NS}:config`,
};

// ---------------------------------------------------------------------------
// Low-level read/write (private)
// ---------------------------------------------------------------------------

function readRaw(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[store] failed to parse ${key}:`, err);
    return fallback;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[store] failed to write ${key}:`, err);
    // Most likely quota exceeded — surface to caller.
    throw err;
  }
}

function readCollection(key) {
  const v = readRaw(key, []);
  return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------------------
// Pub/sub — modules can subscribe to data changes
// ---------------------------------------------------------------------------

const listeners = new Set();

/** Subscribe to store changes. Returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(type, detail) {
  for (const fn of listeners) {
    try { fn(type, detail); } catch (err) { console.error('[store] listener error', err); }
  }
}

// Keep tabs in sync: another tab writing localStorage fires a 'storage' event.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && Object.values(KEYS).includes(e.key)) {
      emit('external', { key: e.key });
    }
  });
}

// ---------------------------------------------------------------------------
// Generic collection upsert/delete by a key field
// ---------------------------------------------------------------------------

function upsertInto(key, item, idField, eventType) {
  const list = readCollection(key);
  const idx = list.findIndex((x) => x[idField] === item[idField]);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...item };
  } else {
    list.push(item);
  }
  writeRaw(key, list);
  emit(eventType, item);
  return item;
}

function deleteFrom(key, idValue, idField, eventType) {
  const list = readCollection(key);
  const next = list.filter((x) => x[idField] !== idValue);
  writeRaw(key, next);
  emit(eventType, { [idField]: idValue, deleted: true });
  return list.length - next.length; // count removed
}

// ===========================================================================
// PRODUCTS (hub entity — keyed by `code`)
// ===========================================================================

/** Build a fully-formed Product with all nested objects defaulted. */
export function blankProduct(code = '', name = '') {
  return {
    code,
    name,
    category: '',
    createdAt: nowISO(),
    status: 'Pending', // "Pending" | "Ready" | "Failed" | "Scaling"
    rnd: { source: '', supplier: '', cost: 0, moq: 0, notes: '', sampleStatus: 'Not ordered' },
    score: { demand: 3, margin: 3, uniqueness: 3, problemSolving: 3, repeatPurchase: 3, total: 15 },
    painPoints: [],
    offer: { mechanism: '', bundle: '', guarantee: '', bonus: '', urgency: '' },
    pricing: { srp: 0, cost: 0, shipping: 0, targetCpp: 0, breakevenRoas: 0, projectedMargin: 0 },
    approval: { decision: 'pending', decidedBy: '', decidedAt: '', reason: '' }, // pending|approved|rejected
    fbPageReady: false,
    creativeReqReady: false,
    fbPageChecklist: {},      // { itemText: bool }
    creativeReqChecklist: {}, // { itemText: bool }
    brief: '',                // AI-generated
    angles: [],               // AI-generated
    copy: { hooks: [], captions: [], headlines: [], primaryText: [], ctas: [], scripts: [], objections: [], faqs: [], chatbot: [] }, // AI
  };
}

export function getProducts() {
  return readCollection(KEYS.products);
}

export function getProduct(code) {
  return getProducts().find((p) => p.code === code) || null;
}

/** Insert or update a product (keyed by code). Recomputes score.total. */
export function upsertProduct(product) {
  const p = { ...product };
  if (!p.createdAt) p.createdAt = nowISO();
  if (p.score) {
    const s = p.score;
    s.total = (s.demand || 0) + (s.margin || 0) + (s.uniqueness || 0)
      + (s.problemSolving || 0) + (s.repeatPurchase || 0);
  }
  return upsertInto(KEYS.products, p, 'code', 'products');
}

/**
 * Rename a product's code, cascading the new code to all linked entities
 * (creatives, dailyMetrics, pages). Returns false if newCode collides.
 */
export function renameProductCode(oldCode, newCode) {
  if (oldCode === newCode) return true;
  if (getProduct(newCode)) return false; // collision
  const product = getProduct(oldCode);
  if (!product) return false;

  // product
  deleteFrom(KEYS.products, oldCode, 'code', 'products');
  upsertProduct({ ...product, code: newCode });

  // cascade to children
  cascadeCodeChange(KEYS.creatives, oldCode, newCode);
  cascadeCodeChange(KEYS.dailyMetrics, oldCode, newCode);
  cascadeCodeChange(KEYS.pages, oldCode, newCode);

  emit('products', { code: newCode, renamedFrom: oldCode });
  return true;
}

function cascadeCodeChange(key, oldCode, newCode) {
  const list = readCollection(key);
  let touched = false;
  for (const row of list) {
    if (row.productCode === oldCode) { row.productCode = newCode; touched = true; }
  }
  if (touched) writeRaw(key, list);
}

/**
 * Delete a product. mode:
 *   'cascade'  -> also delete its creatives, dailyMetrics, pages (default)
 *   'orphan'   -> keep children but clear/flag their productCode
 * Returns a summary of what changed.
 */
export function deleteProduct(code, mode = 'cascade') {
  const summary = { code, creatives: 0, dailyMetrics: 0, pages: 0, mode };
  deleteFrom(KEYS.products, code, 'code', 'products');

  if (mode === 'cascade') {
    summary.creatives = readCollection(KEYS.creatives).filter((c) => c.productCode === code).length;
    summary.dailyMetrics = readCollection(KEYS.dailyMetrics).filter((m) => m.productCode === code).length;
    summary.pages = readCollection(KEYS.pages).filter((p) => p.productCode === code).length;
    writeRaw(KEYS.creatives, readCollection(KEYS.creatives).filter((c) => c.productCode !== code));
    writeRaw(KEYS.dailyMetrics, readCollection(KEYS.dailyMetrics).filter((m) => m.productCode !== code));
    writeRaw(KEYS.pages, readCollection(KEYS.pages).filter((p) => p.productCode !== code));
  } else {
    // orphan: flag children so the UI can show "unlinked product"
    orphanChildren(KEYS.creatives, code, summary, 'creatives');
    orphanChildren(KEYS.dailyMetrics, code, summary, 'dailyMetrics');
    orphanChildren(KEYS.pages, code, summary, 'pages');
  }

  emit('products', { code, deleted: true });
  emit('creatives'); emit('dailyMetrics'); emit('pages');
  return summary;
}

function orphanChildren(key, code, summary, label) {
  const list = readCollection(key);
  let n = 0;
  for (const row of list) {
    if (row.productCode === code) { row.orphaned = true; n++; }
  }
  if (n) writeRaw(key, list);
  summary[label] = n;
}

/** Known product codes (used by Module 4 page-code detection). */
export function getProductCodes() {
  return getProducts().map((p) => p.code);
}

const COPY_BUCKETS = ['hooks', 'captions', 'headlines', 'primaryText', 'ctas', 'scripts', 'objections', 'faqs', 'chatbot'];

/**
 * Append AI-generated copy items to a product's copy bucket WITHOUT overwriting
 * existing items. Each item is stored as { text, at, meta? } so timestamps and
 * provenance survive. Returns the updated product.
 */
export function appendProductCopy(code, bucket, items, meta = {}) {
  const p = getProduct(code);
  if (!p) return null;
  if (!p.copy) p.copy = Object.fromEntries(COPY_BUCKETS.map((b) => [b, []]));
  if (!Array.isArray(p.copy[bucket])) p.copy[bucket] = [];
  const at = nowISO();
  (Array.isArray(items) ? items : [items]).forEach((t) => {
    p.copy[bucket].push({ text: typeof t === 'string' ? t : t.text, at, ...meta });
  });
  return upsertProduct(p);
}

// ===========================================================================
// CREATIVES (Module 2 — keyed by `id`)
// ===========================================================================

export function getCreatives() {
  return readCollection(KEYS.creatives);
}
export function getCreative(id) {
  return getCreatives().find((c) => c.id === id) || null;
}
export function getCreativesByProduct(code) {
  return getCreatives().filter((c) => c.productCode === code);
}
export function upsertCreative(creative) {
  const c = { ...creative };
  if (!c.id) c.id = uid('cr');
  if (!c.createdAt) c.createdAt = nowISO();
  c.updatedAt = nowISO(); // stamp every write — powers "new since last seen" review alerts
  if (!c.metrics) c.metrics = { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 };
  return upsertInto(KEYS.creatives, c, 'id', 'creatives');
}
export function deleteCreative(id) {
  // cascade per-creative daily metrics
  writeRaw(KEYS.creativeMetrics, readCollection(KEYS.creativeMetrics).filter((m) => m.creativeId !== id));
  emit('creativeMetrics');
  return deleteFrom(KEYS.creatives, id, 'id', 'creatives');
}

// ---- per-creative daily metrics (one row per creativeId + date) ----
export function getCreativeMetrics() {
  return readCollection(KEYS.creativeMetrics);
}
export function getCreativeMetricsByCreative(creativeId) {
  return getCreativeMetrics().filter((m) => m.creativeId === creativeId);
}
export function getCreativeMetric(creativeId, date) {
  return getCreativeMetrics().find((m) => m.creativeId === creativeId && m.date === date) || null;
}
export function upsertCreativeMetric(metric) {
  const m = { ...metric };
  if (!m.id) { const existing = getCreativeMetric(m.creativeId, m.date); m.id = existing ? existing.id : uid('cm'); }
  return upsertInto(KEYS.creativeMetrics, m, 'id', 'creativeMetrics');
}
export function deleteCreativeMetric(id) {
  return deleteFrom(KEYS.creativeMetrics, id, 'id', 'creativeMetrics');
}

// ===========================================================================
// DAILY METRICS (Module 3 — one row per product per date, keyed by `id`)
// ===========================================================================

export function getDailyMetrics() {
  return readCollection(KEYS.dailyMetrics);
}
export function getDailyMetricsByProduct(code) {
  return getDailyMetrics().filter((m) => m.productCode === code);
}
export function getDailyMetricsByDate(date) {
  return getDailyMetrics().filter((m) => m.date === date);
}
/** Get the single metric row for a product on a date (or null). */
export function getDailyMetric(code, date) {
  return getDailyMetrics().find((m) => m.productCode === code && m.date === date) || null;
}
/**
 * Upsert a daily metric. Uniqueness is (productCode, date): if a row already
 * exists for that pair we update it rather than creating a duplicate.
 */
export function upsertDailyMetric(metric) {
  const m = { ...metric };
  if (!m.id) {
    const existing = getDailyMetric(m.productCode, m.date);
    m.id = existing ? existing.id : uid('dm');
  }
  return upsertInto(KEYS.dailyMetrics, m, 'id', 'dailyMetrics');
}
export function deleteDailyMetric(id) {
  return deleteFrom(KEYS.dailyMetrics, id, 'id', 'dailyMetrics');
}

// ===========================================================================
// PAGES (Module 4 — keyed by `id`)
// ===========================================================================

export function getPages() {
  return readCollection(KEYS.pages);
}
export function upsertPage(page) {
  const p = { ...page };
  if (!p.id) p.id = uid('pg');
  return upsertInto(KEYS.pages, p, 'id', 'pages');
}
export function deletePage(id) {
  return deleteFrom(KEYS.pages, id, 'id', 'pages');
}

// ===========================================================================
// COMPETITORS (Module 6 — keyed by `id`)
// ===========================================================================

export function getCompetitors() {
  return readCollection(KEYS.competitors);
}
export function getCompetitor(id) {
  return getCompetitors().find((c) => c.id === id) || null;
}
export function upsertCompetitor(comp) {
  const c = { ...comp };
  if (!c.id) c.id = uid('cp');
  if (!c.recreateStatus) c.recreateStatus = 'Not Started';
  return upsertInto(KEYS.competitors, c, 'id', 'competitors');
}
export function deleteCompetitor(id) {
  return deleteFrom(KEYS.competitors, id, 'id', 'competitors');
}

// ===========================================================================
// HOOK BANK (Module 2 reusable hooks — keyed by `id`)
// ===========================================================================

export function getHooks() {
  return readCollection(KEYS.hooks);
}
export function upsertHook(hook) {
  const h = { ...hook };
  if (!h.id) h.id = uid('hk');
  if (!h.createdAt) h.createdAt = nowISO();
  return upsertInto(KEYS.hooks, h, 'id', 'hooks');
}
export function deleteHook(id) {
  return deleteFrom(KEYS.hooks, id, 'id', 'hooks');
}

// ===========================================================================
// EXPERIMENTS — A/B test & experiment log (keyed by `id`)
// ===========================================================================

/** A fresh experiment with two empty variants (A/B). */
export function blankExperiment() {
  return {
    id: uid('ex'),
    name: '',
    productCode: '',
    type: 'Creative',          // Creative | Audience | Offer | Price | Landing | Other
    hypothesis: '',
    status: 'Running',         // Planned | Running | Done
    variants: [
      { label: 'A', desc: '', spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 },
      { label: 'B', desc: '', spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 },
    ],
    winner: '',                // '' | variant label
    verdict: '',               // AI analysis text
    notes: '',
    createdAt: nowISO(),
  };
}

export function getExperiments() {
  return readCollection(KEYS.experiments);
}
export function getExperiment(id) {
  return getExperiments().find((e) => e.id === id) || null;
}
export function upsertExperiment(exp) {
  const e = { ...exp };
  if (!e.id) e.id = uid('ex');
  if (!e.createdAt) e.createdAt = nowISO();
  e.updatedAt = nowISO();
  return upsertInto(KEYS.experiments, e, 'id', 'experiments');
}
export function deleteExperiment(id) {
  return deleteFrom(KEYS.experiments, id, 'id', 'experiments');
}

// ===========================================================================
// DAILY REPORTS (Module 3 — AI-generated text keyed by date)
// ===========================================================================

export function getDailyReport(date) {
  const all = readRaw(KEYS.dailyReports, {});
  return (all && all[date]) || '';
}
export function saveDailyReport(date, text) {
  const all = readRaw(KEYS.dailyReports, {}) || {};
  all[date] = text;
  writeRaw(KEYS.dailyReports, all);
  emit('dailyReports', { date });
}

// ---- War Room daily brief (keyed by date): { focusCode, angle, targetVideos, targetImages, note } ----
export function getBrief(date) {
  const all = readRaw(KEYS.briefs, {});
  return (all && all[date]) || null;
}
export function saveBrief(date, patch) {
  const all = readRaw(KEYS.briefs, {}) || {};
  all[date] = { ...(all[date] || {}), ...patch };
  writeRaw(KEYS.briefs, all);
  emit('briefs', { date });
  return all[date];
}

// ---- Date-range view preference (PERSONAL — not synced, not in export) -------
const DATE_RANGE_KEY = `${NS}:dateRange`;
export function getDateRange() {
  const v = readRaw(DATE_RANGE_KEY, null);
  return v && typeof v === 'object' ? v : { preset: 'last_7d' };
}
export function setDateRange(range) {
  writeRaw(DATE_RANGE_KEY, range || { preset: 'last_7d' });
  emit('dateRange', range);
  return range;
}

// ===========================================================================
// CONFIG (thresholds, weights, team, AI settings)
// ===========================================================================

/** Returns DEFAULT_CONFIG with any persisted overrides merged on top. */
export function getConfig() {
  const stored = readRaw(KEYS.config, {});
  return mergeConfig(DEFAULT_CONFIG, stored || {});
}
/** Persist a (possibly partial) config patch, deep-merged over current config. */
export function updateConfig(patch) {
  const next = mergeConfig(getConfig(), patch);
  writeRaw(KEYS.config, next);
  emit('config', next);
  return next;
}
/** Reset config back to defaults. */
export function resetConfig() {
  writeRaw(KEYS.config, structuredCloneSafe(DEFAULT_CONFIG));
  emit('config', DEFAULT_CONFIG);
  return getConfig();
}

// ===========================================================================
// EXPORT / IMPORT (full backup & restore)
// ===========================================================================

/** Snapshot of every collection + config for JSON download. */
export function exportAll() {
  return {
    app: 'STRATOS Marketing Command Center',
    schemaVersion: 1,
    exportedAt: nowISO(),
    data: {
      products: getProducts(),
      creatives: getCreatives(),
      creativeMetrics: getCreativeMetrics(),
      dailyMetrics: getDailyMetrics(),
      pages: getPages(),
      competitors: getCompetitors(),
      hooks: getHooks(),
      experiments: getExperiments(),
      briefs: readRaw(KEYS.briefs, {}),
      dailyReports: readRaw(KEYS.dailyReports, {}),
      config: readRaw(KEYS.config, {}), // store only the overrides, not merged defaults
    },
  };
}

/**
 * Restore from an exportAll() payload. Replaces all collections.
 * Returns a summary of counts imported. Throws on malformed input.
 */
export function importAll(payload) {
  if (!payload || typeof payload !== 'object' || !payload.data) {
    throw new Error('Invalid backup file: missing "data" object.');
  }
  const d = payload.data;
  const collections = ['products', 'creatives', 'creativeMetrics', 'dailyMetrics', 'pages', 'competitors', 'hooks', 'experiments'];
  for (const name of collections) {
    if (d[name] !== undefined && !Array.isArray(d[name])) {
      throw new Error(`Invalid backup: "${name}" must be an array.`);
    }
  }
  const summary = {};
  for (const name of collections) {
    const arr = Array.isArray(d[name]) ? d[name] : [];
    writeRaw(KEYS[name], arr);
    summary[name] = arr.length;
  }
  if (d.briefs && typeof d.briefs === 'object') {
    writeRaw(KEYS.briefs, d.briefs);
  }
  if (d.dailyReports && typeof d.dailyReports === 'object') {
    writeRaw(KEYS.dailyReports, d.dailyReports);
  }
  if (d.config && typeof d.config === 'object') {
    writeRaw(KEYS.config, d.config);
  }
  // Notify everything
  for (const name of collections) emit(name);
  emit('config');
  return summary;
}

/** Wipe all app data (used by tests / "reset everything"). */
export function wipeAll() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
  for (const name of Object.keys(KEYS)) emit(name);
}

/** Aggregate counts + product status breakdown for the header summary chips. */
export function getSummary() {
  const products = getProducts();
  const byStatus = { Pending: 0, Ready: 0, Failed: 0, Scaling: 0 };
  for (const p of products) {
    if (byStatus[p.status] === undefined) byStatus[p.status] = 0;
    byStatus[p.status]++;
  }
  return {
    products: products.length,
    creatives: getCreatives().length,
    pages: getPages().length,
    competitors: getCompetitors().length,
    byStatus,
  };
}
