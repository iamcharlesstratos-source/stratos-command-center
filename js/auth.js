// auth.js — real login via Supabase Auth (GoTrue REST, no SDK).
//
// Reuses the same Supabase project configured for Cloud Sync (config.sync.url +
// anonKey), so login and shared data share one workspace. Session (JWT) is kept
// in localStorage and refreshed automatically. Roles come from the account's
// user_metadata: 'Advertiser' = admin, 'Graphic Artist' = limited.

import * as store from './store.js';
import { DEFAULT_CONFIG } from './config.js';

const SKEY = 'stratos:auth';
let session = null;                 // { access_token, refresh_token, expires_at, user:{id,email,role,name} }
const listeners = new Set();

// Roles. Marketing Head + Advertiser are admins (full access); Graphic Artist is limited.
export const ROLES = ['Marketing Head', 'Advertiser', 'Graphic Artist'];
const ADMIN_ROLES = ['Marketing Head', 'Advertiser'];
function normRole(r, fallback = 'Graphic Artist') { return ROLES.includes(r) ? r : fallback; }

// Fall back to the baked-in workspace when a stored config has empty sync creds
// (older stored configs persisted url:'' which would otherwise mask the default).
function creds() {
  const s = store.getConfig().sync || {};
  const d = DEFAULT_CONFIG.sync || {};
  return { url: (s.url || d.url || '').replace(/\/+$/, ''), anonKey: s.anonKey || d.anonKey || '' };
}
export function isConfigured() { const c = creds(); return !!(c.url && c.anonKey); }
function base() { return creds().url + '/auth/v1'; }
function rest() { return creds().url + '/rest/v1'; }
function headers(extra) { return { apikey: creds().anonKey, 'Content-Type': 'application/json', ...extra }; }
// PostgREST calls authenticated as the logged-in user (JWT), falling back to anon.
function authedHeaders(extra) { return { apikey: creds().anonKey, Authorization: 'Bearer ' + (token() || creds().anonKey), 'Content-Type': 'application/json', ...extra }; }

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(session); } catch (e) { console.error(e); } } }

function load() { try { session = JSON.parse(localStorage.getItem(SKEY)); } catch { session = null; } return session; }
function save(s) { session = s; if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); emit(); }

function shape(data) {
  const u = data.user || {};
  const meta = u.user_metadata || {};
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: u.id, email: u.email, role: normRole(meta.role, 'Advertiser'), name: meta.name || (u.email || '').split('@')[0], avatar: meta.avatar || '' },
  };
}

export function current() { return session ? session.user : null; }
export function isAuthed() { return !!(session && (session.access_token || session.local)); }
export function isLocal() { return !!(session && session.local); }
export function isAdmin() { return isAuthed() && ADMIN_ROLES.includes(session.user.role); }
export function role() { return session ? session.user.role : null; }
export function token() { return session ? session.access_token : null; }
export function hasStoredSession() { return !!localStorage.getItem(SKEY); }

/** Escape hatch: sign in locally as admin on THIS device (no Supabase account).
 *  Cloud Sync still works via the anon key, so shared team data still loads. */
export function signInLocal(name = 'Admin') {
  save({ access_token: null, refresh_token: null, expires_at: 0, local: true,
    user: { id: 'local-admin', email: '', role: 'Advertiser', name: (name || 'Admin').trim() || 'Admin' } });
  return current();
}

async function call(path, body, extraHeaders) {
  let res;
  try { res = await fetch(base() + path, { method: 'POST', headers: headers(extraHeaders), body: JSON.stringify(body) }); }
  catch (e) { throw new Error('Cannot reach the server. Check the Supabase URL / internet. (' + e.message + ')'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.error || `Failed (${res.status})`);
  return data;
}

/** Create an account. Returns user, or throws 'CONFIRM_EMAIL' if email confirmation is on. */
export async function signUp(email, password, { role: r = 'Advertiser', name = '' } = {}) {
  const data = await call('/signup', { email, password, data: { role: r, name } });
  if (data.access_token) { save(shape(data)); await syncProfile(); return current(); }
  throw new Error('CONFIRM_EMAIL');
}

export async function signIn(email, password) {
  const data = await call('/token?grant_type=password', { email, password });
  save(shape(data));
  await syncProfile();
  return current();
}

export async function signOut() {
  if (session && session.local) { save(null); return; }
  try { await fetch(base() + '/logout', { method: 'POST', headers: headers({ Authorization: 'Bearer ' + token() }) }); } catch { /* ignore */ }
  save(null);
}

async function refresh() {
  if (!session || !session.refresh_token) return false;
  try {
    const data = await call('/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    save(shape(data));
    return true;
  } catch { save(null); return false; }
}

/** Restore a session on boot (refreshing if near expiry). Returns the user or null. */
export async function init() {
  load();
  if (!session) return null;
  if (session.expires_at && session.expires_at < Date.now() + 60000) {
    const ok = await refresh();
    if (!ok) return null;
  }
  await syncProfile();
  return current();
}

// ---------------------------------------------------------------------------
// Team profiles — role lives in a `stratos_profiles` table so Advertisers can
// manage it (JWT user_metadata can only be changed by the user or a service
// key). All calls are best-effort: if the table/policies aren't set up yet we
// silently fall back to the signup role, so login never breaks.
// ---------------------------------------------------------------------------
async function fetchProfile(id) {
  try {
    const res = await fetch(rest() + '/stratos_profiles?select=*&id=eq.' + encodeURIComponent(id), { headers: authedHeaders() });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return rows[0] || null;
  } catch { return null; }
}
async function putProfile(row) {
  try {
    await fetch(rest() + '/stratos_profiles', {
      method: 'POST',
      headers: authedHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([row]),
    });
  } catch { /* ignore */ }
}

/** Reconcile the logged-in user with the profiles table (table role wins). */
async function syncProfile() {
  if (!session || session.local || !session.user || !session.user.id) return;
  const u = session.user;
  const prof = await fetchProfile(u.id);
  if (!prof) {
    // First time we see this user → seed the row from their signup metadata.
    await putProfile({ id: u.id, email: u.email, name: u.name, role: u.role });
    return;
  }
  const role = normRole(prof.role);
  session.user.role = role;
  if (prof.name) session.user.name = prof.name;
  if (prof.avatar) session.user.avatar = prof.avatar;
  save(session);
  if (prof.email !== u.email) await putProfile({ id: u.id, email: u.email, name: prof.name || u.name, role });
}

/** Admin: list every team member. `select=*` so it works whether or not an
 *  optional `avatar` column exists. Throws if the profiles table isn't set up. */
export async function listUsers() {
  const res = await fetch(rest() + '/stratos_profiles?select=*&order=role.asc,email.asc', { headers: authedHeaders() });
  if (!res.ok) throw new Error('Cannot load users (' + res.status + '). Make sure the stratos_profiles table + policies exist in Supabase.');
  return res.json();
}

/** Update the current user's display name + avatar (data URL). Reflected locally
 *  immediately; best-effort to the profiles table (avatar needs an `avatar` column). */
export async function updateProfile({ name, avatar } = {}) {
  if (!isAuthed()) throw new Error('Not logged in.');
  if (typeof name === 'string' && name.trim()) session.user.name = name.trim();
  if (typeof avatar === 'string') session.user.avatar = avatar; // '' clears it
  save(session);
  try { store.updateConfig({ ui: { userName: session.user.name, avatar: session.user.avatar || '' } }); } catch (e) { /* ignore */ }
  if (!session.local) {
    await putProfile({ id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role });
    try {
      await fetch(rest() + '/stratos_profiles?id=eq.' + encodeURIComponent(session.user.id), {
        method: 'PATCH', headers: authedHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ avatar: session.user.avatar || null }),
      });
    } catch (e) { /* avatar column may not exist — fine */ }
  }
  return current();
}

/** Admin: change a member's role (takes effect on their next login/refresh). */
export async function setUserRole(id, role) {
  const r = normRole(role);
  const res = await fetch(rest() + '/stratos_profiles?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: authedHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ role: r, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error('Update failed (' + res.status + '): ' + (await res.text().catch(() => '')).slice(0, 140));
  return true;
}

/** Change the current user's password (GoTrue). */
export async function updatePassword(newPassword) {
  if (isLocal()) throw new Error('Local mode — no Supabase password. Set up a real account to use this.');
  if (!isAuthed()) throw new Error('Not logged in.');
  let res;
  try {
    res = await fetch(base() + '/user', { method: 'PUT', headers: headers({ Authorization: 'Bearer ' + token() }), body: JSON.stringify({ password: newPassword }) });
  } catch (e) { throw new Error('Cannot reach the server. (' + e.message + ')'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.error_description || data.error || ('Failed (' + res.status + ')'));
  return true;
}
