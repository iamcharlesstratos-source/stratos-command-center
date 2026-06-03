// sync.js — optional shared-team-data sync via Supabase's REST API (pure fetch).
//
// Design: the whole DATA snapshot (products, creatives, metrics, pages,
// competitors, hooks, dailyReports, creativeMetrics) is mirrored to ONE row in
// a `stratos_kv` table (key='state', value=jsonb). On any local change we
// debounce-push; a poll pulls teammates' changes and applies them.
//
// • Conflict model: last-write-wins on the whole snapshot (fine for a small,
//   coordinated team — see README).
// • Privacy: `config` (AI key, thresholds, sync creds) is NEVER synced — it's
//   stripped from the snapshot, so each user keeps their own settings & key.
// • store.js is untouched: this module only uses its public API
//   (subscribe / exportAll / importAll / getConfig).

import * as store from './store.js';

const state = { status: 'off', detail: '', timer: null, applying: false, lastBody: '', lastPulledAt: '' };
let statusCb = null;
let renderRoute = null;

export function onStatus(fn) { statusCb = fn; fn && fn(getStatus()); }
export function getStatus() { return { status: state.status, detail: state.detail }; }
function setStatus(s, detail = '') { state.status = s; state.detail = detail; if (statusCb) statusCb(getStatus()); }

function cfg() { return store.getConfig().sync || {}; }
export function isEnabled() { const c = cfg(); return !!(c.enabled && c.url && c.anonKey); }
function endpoint() { return cfg().url.replace(/\/+$/, '') + '/rest/v1/stratos_kv'; }
function headers(extra) { const c = cfg(); return { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey, 'Content-Type': 'application/json', ...extra }; }

/** DATA-only snapshot (config stripped). */
function snapshotData() { const all = store.exportAll(); const d = { ...all.data }; delete d.config; return d; }

/** (Re)start syncing. Safe no-op when disabled. */
export async function start(renderRouteFn) {
  if (renderRouteFn) renderRoute = renderRouteFn;
  stop();
  if (!isEnabled()) { setStatus('off'); return; }
  setStatus('connecting');
  if (!start._subscribed) { store.subscribe(schedulePush); start._subscribed = true; } // once
  await pull(true);
  const secs = Math.max(3, Number(cfg().pollSeconds) || 5);
  state.timer = setInterval(() => pull(false), secs * 1000);
}
export function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

let pushTimer = null;
function schedulePush() {
  if (state.applying || !isEnabled()) return; // don't echo remote-applied changes
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push().catch(() => {}), 1500);
}

async function push() {
  if (!isEnabled()) return;
  const data = snapshotData();
  const body = JSON.stringify(data);
  if (body === state.lastBody) return; // nothing changed
  setStatus('syncing');
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ key: 'state', value: data, updated_at: new Date().toISOString() }]),
  }).catch((e) => { throw new Error('network: ' + e.message); });
  if (!res.ok) { setStatus('error', `push ${res.status}: ${(await res.text().catch(() => '')).slice(0, 140)}`); return; }
  state.lastBody = body;
  setStatus('synced');
}

async function pull(initial) {
  if (!isEnabled()) return;
  let res;
  try {
    res = await fetch(endpoint() + '?key=eq.state&select=value,updated_at', { headers: headers() });
  } catch (e) { setStatus('error', 'network: ' + e.message); return; }
  if (!res.ok) { setStatus('error', `pull ${res.status}: ${(await res.text().catch(() => '')).slice(0, 140)}`); return; }
  const rows = await res.json().catch(() => []);
  if (!rows.length) { // no shared state yet → seed it from local on first connect
    if (initial) { state.lastBody = ''; await push().catch((e) => setStatus('error', e.message)); }
    else setStatus('synced');
    return;
  }
  const row = rows[0];
  if (!initial && row.updated_at === state.lastPulledAt) { setStatus('synced'); return; }
  state.lastPulledAt = row.updated_at;
  const remoteBody = JSON.stringify(row.value);
  if (remoteBody !== JSON.stringify(snapshotData())) {
    state.applying = true;
    try { store.importAll({ data: row.value }); } finally { state.applying = false; } // config absent → untouched
    state.lastBody = remoteBody;
    if (renderRoute) { try { renderRoute(); } catch (_) {} }
  }
  setStatus('synced');
}

/** Quick connectivity check for the settings modal ("Test connection"). */
export async function test() {
  if (!cfg().url || !cfg().anonKey) return { ok: false, detail: 'URL and anon key required.' };
  try {
    const res = await fetch(endpoint() + '?select=key&limit=1', { headers: headers() });
    if (res.ok) return { ok: true, detail: 'Connected — table reachable.' };
    return { ok: false, detail: `${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}` };
  } catch (e) { return { ok: false, detail: 'network: ' + e.message }; }
}
