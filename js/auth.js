// auth.js — real login via Supabase Auth (GoTrue REST, no SDK).
//
// Reuses the same Supabase project configured for Cloud Sync (config.sync.url +
// anonKey), so login and shared data share one workspace. Session (JWT) is kept
// in localStorage and refreshed automatically. Roles come from the account's
// user_metadata: 'Advertiser' = admin, 'Graphic Artist' = limited.

import * as store from './store.js';

const SKEY = 'stratos:auth';
let session = null;                 // { access_token, refresh_token, expires_at, user:{id,email,role,name} }
const listeners = new Set();

function creds() { const s = store.getConfig().sync || {}; return { url: (s.url || '').replace(/\/+$/, ''), anonKey: s.anonKey || '' }; }
export function isConfigured() { const c = creds(); return !!(c.url && c.anonKey); }
function base() { return creds().url + '/auth/v1'; }
function headers(extra) { return { apikey: creds().anonKey, 'Content-Type': 'application/json', ...extra }; }

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
    user: { id: u.id, email: u.email, role: meta.role === 'Graphic Artist' ? 'Graphic Artist' : 'Advertiser', name: meta.name || (u.email || '').split('@')[0] },
  };
}

export function current() { return session ? session.user : null; }
export function isAuthed() { return !!(session && session.access_token); }
export function isAdmin() { return isAuthed() && session.user.role === 'Advertiser'; }
export function role() { return session ? session.user.role : null; }
export function token() { return session ? session.access_token : null; }

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
  if (data.access_token) { save(shape(data)); return current(); }
  throw new Error('CONFIRM_EMAIL');
}

export async function signIn(email, password) {
  const data = await call('/token?grant_type=password', { email, password });
  save(shape(data));
  return current();
}

export async function signOut() {
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
  return current();
}
