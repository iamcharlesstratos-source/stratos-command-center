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
