// config.js — default configuration + pure config helpers.
//
// DEFAULT_CONFIG holds every editable threshold/weight/setting. The store
// merges any persisted overrides on top of these defaults (deep-ish merge) so
// new config fields added in future versions appear automatically for existing
// users. This file imports nothing from store.js to avoid a circular import —
// store.js owns persistence and reads DEFAULT_CONFIG from here.

export const DEFAULT_CONFIG = {
  // ---- Module 1: product auto-tag thresholds ----
  thresholds: {
    // Product auto-tags "Failed" if score.total < failScore (score range 5–25).
    failScore: 15,
    // ROAS bands (Module 3 Scale/Observe/Kill; scaleRoas also drives Module 1 "Scaling").
    scaleRoas: 2.5,     // Scale  if ROAS >= scaleRoas
    observeRoas: 1.5,   // Observe if observeRoas <= ROAS < scaleRoas ; Kill if ROAS < observeRoas
  },

  // ---- Module 2: winning-creative leaderboard weighting ----
  // Composite of ROAS (higher better), CPP (lower better), CTR (higher better),
  // CPM (lower better). Weights should sum to ~1 but the ranker normalizes anyway.
  creativeWeights: { roas: 0.40, cpp: 0.30, ctr: 0.20, cpm: 0.10 },

  // ---- Module 2: editable team list (graphic artists / video editors) ----
  team: ['Unassigned'],

  // ---- Module 1 / 2 checklist templates (toggle items) ----
  fbPageChecklist: [
    'Page created & named with product code',
    'Profile + cover image uploaded',
    'About / bio filled out',
    'Page username (vanity URL) set',
    'Messaging / auto-reply enabled',
    'Linked to Business Manager & ad account',
  ],
  creativeReqChecklist: [
    'Product photos / raw footage gathered',
    'Hooks & angles defined',
    'Primary text + headline drafted',
    'At least one image creative briefed',
    'At least one video creative briefed',
    'Landing page / Shopee-Lazada link ready',
  ],

  // ---- AI settings (consumed by ai.js in Phase 4) ----
  ai: {
    backend: 'auto',                          // 'auto' | 'direct' | 'proxy'
    apiKey: '',                               // client-side, internal-use only (direct mode)
    proxyUrl: 'http://localhost:8787/ai',     // server-side key (proxy mode)
    copyModel: 'claude-sonnet-4-6',           // default model for copy
    bulkModel: 'claude-haiku-4-5-20251001',   // cheaper model for bulk hook generation
    maxTokens: 1024,
    language: 'Taglish',                      // default output language: Taglish | English | Tagalog
  },

  // ---- meta ----
  version: 1,
};

/** Deep-merge persisted overrides on top of defaults (objects only; arrays/scalars replace). */
export function mergeConfig(base, override) {
  if (!override || typeof override !== 'object') return structuredCloneSafe(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const b = base ? base[key] : undefined;
    const o = override[key];
    if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)) {
      out[key] = mergeConfig(b, o);
    } else {
      out[key] = o;
    }
  }
  return out;
}

/** structuredClone with a JSON fallback for older runtimes. */
export function structuredCloneSafe(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}
