// meta.js — talks DIRECTLY to the Meta Graph API from the browser.
//
// The static app has no server, so the team's own access token (ads_read) is
// pasted once and kept device-local (store.getMetaConfig — never synced, never
// exported). We pull campaign-level Insights for a given day and map each
// campaign to a STRATOS product by finding the product CODE inside the campaign
// name (longest match wins — so name your campaigns with the code, e.g.
// "GINKGO-01 - Senior - ABO").
//
// Graph API supports CORS for these GET calls, so no proxy is required for read.
// Token expiry / scope errors are surfaced verbatim so the user can re-paste.

const GRAPH = 'https://graph.facebook.com/v19.0';

/** List the ad accounts the token can see → [{ accountId, name, currency }]. */
export async function listAccounts(token) {
  const url = `${GRAPH}/me/adaccounts?fields=account_id,name,currency,account_status&limit=200&access_token=${encodeURIComponent(token)}`;
  const data = await getJSON(url);
  return (data.data || []).map((a) => ({ accountId: a.account_id, name: a.name || a.account_id, currency: a.currency || '', status: a.account_status }));
}

/**
 * Pull campaign-level insights for a single day (since == until == dateStr).
 * Returns raw rows: [{ campaignName, spend, impressions, clicks, purchases, revenue }].
 */
export async function pullDay(token, accountId, dateStr) {
  const tr = encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }));
  const fields = 'campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas';
  let url = `${GRAPH}/act_${accountId}/insights?level=campaign&time_range=${tr}&fields=${fields}&limit=200&access_token=${encodeURIComponent(token)}`;
  const out = [];
  let guard = 0;
  while (url && guard++ < 25) {
    const data = await getJSON(url);
    for (const r of (data.data || [])) {
      const spend = num(r.spend);
      const purchases = pickAction(r.actions, PURCHASE_TYPES);
      let revenue = pickAction(r.action_values, PURCHASE_TYPES);
      if (!revenue && r.purchase_roas) revenue = roasValue(r.purchase_roas) * spend;
      out.push({
        campaignName: r.campaign_name || '',
        spend,
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        purchases,
        revenue,
      });
    }
    url = data.paging && data.paging.next ? data.paging.next : null;
  }
  return out;
}

/**
 * Aggregate raw campaign rows onto STRATOS products by matching the product code
 * inside the campaign name. → { byCode: {code:{spend,...}}, unmapped:[names] }.
 */
export function mapRowsToProducts(rows, products) {
  const byCode = {};
  const unmapped = [];
  for (const row of rows) {
    const code = matchCode(row.campaignName, products);
    if (!code) { if (row.spend > 0 || row.impressions > 0) unmapped.push(row.campaignName || '(unnamed)'); continue; }
    const a = byCode[code] || { spend: 0, revenue: 0, impressions: 0, clicks: 0, purchases: 0 };
    a.spend += row.spend; a.revenue += row.revenue; a.impressions += row.impressions; a.clicks += row.clicks; a.purchases += row.purchases;
    byCode[code] = a;
  }
  return { byCode, unmapped: [...new Set(unmapped)] };
}

// --- helpers ---------------------------------------------------------------
const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'onsite_conversion.purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase', 'web_in_store_purchase'];

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Network/CORS error reaching Meta. (${err.message})`);
  }
  let data;
  try { data = await res.json(); } catch { throw new Error(`Meta returned a non-JSON response (HTTP ${res.status}).`); }
  if (data && data.error) {
    const e = data.error;
    throw new Error(e.message || `Meta error (code ${e.code || res.status}).`);
  }
  if (!res.ok) throw new Error(`Meta request failed (HTTP ${res.status}).`);
  return data;
}

function pickAction(arr, types) {
  if (!Array.isArray(arr)) return 0;
  for (const t of types) {
    const hit = arr.find((x) => x.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

function roasValue(roas) {
  if (Array.isArray(roas)) return num(roas[0] && roas[0].value);
  return num(roas);
}

function matchCode(name, products) {
  const up = String(name || '').toUpperCase();
  let best = '';
  for (const p of products) {
    const code = String(p.code || '').toUpperCase();
    if (code && up.includes(code) && code.length > best.length) best = code;
  }
  if (!best) return null;
  const hit = products.find((p) => String(p.code || '').toUpperCase() === best);
  return hit ? hit.code : null;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
