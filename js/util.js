// util.js — tiny shared primitives used across the app.
// Kept dependency-free so both store.js and ui.js can import it without cycles.

/**
 * Generate a unique id. Prefers crypto.randomUUID (available in secure
 * contexts incl. http://localhost), falls back to a timestamp+random string
 * so the app still works if served from a non-secure-context LAN address.
 */
export function uid(prefix = '') {
  let id;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID();
  } else {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return prefix ? `${prefix}_${id}` : id;
}

/** ISO timestamp for createdAt / decidedAt / append logs. */
export function nowISO() {
  return new Date().toISOString();
}

/** Local YYYY-MM-DD (for <input type="date"> defaults and daily metrics). */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Yesterday as YYYY-MM-DD relative to a given date string or Date. */
export function yesterdayStr(ref = new Date()) {
  const d = ref instanceof Date ? new Date(ref) : new Date(`${ref}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return todayStr(d);
}

/** Clamp n into [min, max]. */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Escape a string for safe insertion into innerHTML. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Coerce a form value to a finite number, or 0 when blank/invalid. */
export function toNum(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Debounce a function (used for live-saving forms without thrashing). */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Format a number with thousands separators; blank/NaN -> em dash. */
export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Format a peso amount. */
export function fmtPeso(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `₱${fmtNum(n, digits)}`;
}

// ---------------------------------------------------------------------------
// Date-range presets (mirrors Meta Ads Manager). Pure date math; week = Sun–Sat
// to match Meta. Dates are local (= Manila time on the team's machines).
// ---------------------------------------------------------------------------
export const RANGE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7d', label: 'Last 7 days' },
  { key: 'last_14d', label: 'Last 14 days' },
  { key: 'last_28d', label: 'Last 28 days' },
  { key: 'last_30d', label: 'Last 30 days' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'all', label: 'All time' },
];

/**
 * Resolve a range descriptor → { preset, since, until, label }.
 * `range` is a string preset key or an object { preset, since, until }.
 * `since`/`until` are inclusive YYYY-MM-DD; 'all' has empty since + far until.
 */
export function resolveRange(range, ref = new Date()) {
  const base = ref instanceof Date
    ? new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
    : new Date(`${ref}T00:00:00`);
  const r = typeof range === 'string' ? { preset: range } : (range || {});
  const preset = r.preset || 'last_7d';
  const shift = (days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };
  const mk = (since, until, label) => ({ preset, since: todayStr(since), until: todayStr(until), label });

  switch (preset) {
    case 'today': return mk(base, base, 'Today');
    case 'yesterday': { const y = shift(-1); return mk(y, y, 'Yesterday'); }
    case 'last_7d': return mk(shift(-6), base, 'Last 7 days');
    case 'last_14d': return mk(shift(-13), base, 'Last 14 days');
    case 'last_28d': return mk(shift(-27), base, 'Last 28 days');
    case 'last_30d': return mk(shift(-29), base, 'Last 30 days');
    case 'this_week': { const s = new Date(base); s.setDate(s.getDate() - s.getDay()); return mk(s, base, 'This week'); }
    case 'last_week': { const s = new Date(base); s.setDate(s.getDate() - s.getDay() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return mk(s, e, 'Last week'); }
    case 'this_month': { const s = new Date(base.getFullYear(), base.getMonth(), 1); return mk(s, base, 'This month'); }
    case 'last_month': { const s = new Date(base.getFullYear(), base.getMonth() - 1, 1); const e = new Date(base.getFullYear(), base.getMonth(), 0); return mk(s, e, 'Last month'); }
    case 'all': return { preset: 'all', since: '', until: '9999-12-31', label: 'All time' };
    case 'custom': {
      const since = r.since || todayStr(base);
      const until = r.until || todayStr(base);
      const [a, b] = since <= until ? [since, until] : [until, since];
      return { preset: 'custom', since: a, until: b, label: a === b ? a : `${a} → ${b}` };
    }
    default: return mk(shift(-6), base, 'Last 7 days');
  }
}

/** Inclusive membership test for a YYYY-MM-DD (or ISO) date against a resolved range. */
export function inRange(dateStr, resolved) {
  if (!dateStr || !resolved) return false;
  // Normalize a full ISO timestamp (UTC) to a LOCAL calendar date so it lines up
  // with resolveRange's local since/until; plain YYYY-MM-DD strings pass through.
  const s = String(dateStr);
  const d = /T.*([Zz]|[+-]\d\d:?\d\d)/.test(s) ? todayStr(new Date(s)) : s.slice(0, 10);
  if (resolved.since && d < resolved.since) return false;
  if (resolved.until && d > resolved.until) return false;
  return true;
}
