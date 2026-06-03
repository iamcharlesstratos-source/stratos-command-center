# STRATOS — Marketing Command Center

An internal, single-page ops tool for running Facebook/TikTok product-testing and
scaling for a PH e-commerce brand. **Vanilla HTML/CSS/JS, ES modules, no build step.**
All data lives in the browser's `localStorage`; the only external runtime dependency
is the Anthropic API (for the AI generation features).

> ⚠️ Internal-use tool. In **direct** AI mode the API key is stored client-side in
> `localStorage` — never deploy this publicly. Use the **proxy** mode for anything
> shared (see [Optional AI proxy](#optional-ai-proxy)).

---

## Running the app

Because it uses ES modules (`<script type="module">`), it must be served over HTTP —
opening `index.html` from `file://` will not work. Any static server is fine:

```bash
# from the project root (the folder containing index.html)
python3 -m http.server 8000
#   → open http://localhost:8000

# or, with Node:
npx serve .
#   → open the URL it prints
```

On Windows PowerShell:

```powershell
python -m http.server 8000
```

Then open the printed URL. The **Dashboard** has a **Load sample data** button so you
can explore every module immediately.

---

## Modules

1. **Product Testing Command Center** — R&D, 1–5 scoring, pain points, offer builder,
   pricing (live breakeven ROAS), FB-page & creative checklists, launch readiness, and
   deterministic status auto-tagging. *(the hub — everything links to a product)*
2. **Creative Testing Machine** — creative briefs, hook bank, status workflow, artist
   assignment, deadline/overdue tracking, and a winning-creative leaderboard.
3. **Daily Marketing Dashboard** — daily raw inputs → computed ROAS/CPP/CPM/CTR, product
   & page performance tables, and Scale/Observe/Kill recommendations.
4. **Page Status Manager** — per-Facebook-Page status, auto product-code detection from
   page names, and per-page ROAS pulled from Module 3.
5. **AI Content & Caption Generator** — platform/tone/language-aware captions, hooks,
   headlines, primary text, CTAs and scripts, saved back onto the product.
6. **Competitor Ads Library Tracker** — log competitor ads, generate recreate/improve
   prompts, and hand off to the Creative Machine.

### Decision & speed features

- **Profit-aware decisions** (Module 3) — beyond ROAS: estimated daily profit (`revenue −
  spend − purchases × (cost + shipping)`) and a **Profitable / Breakeven / Bleeding** label
  per product, so a "good ROAS" that's actually losing money is obvious.
- **Paste / CSV import** (Module 3 → "⇪ Paste import") — paste an Ads Manager or spreadsheet
  export (tab- or comma-separated). Header row auto-detected via aliases ("Amount spent",
  "Link clicks", "Results", "Purchases conversion value", …); otherwise column order is
  `product, spend, revenue, impressions, clicks, purchases`. Each row is matched to a product
  by code, embedded code, or name; unmatched rows can be assigned in the preview.
- **Trends + fatigue** (Module 3) — a 7-day ROAS sparkline per product, plus an automatic
  **🔻 fatigue flag** when CTR net-declines ≥20% while CPM net-rises ≥15% over recent days.
- **Action-needed alerts** — the Dashboard and header surface overdue creatives, bleeding
  products, fatiguing products, and pages needing mapping (all deterministic).
- **AI diagnosis** — Module 3 "Diagnose & next steps" explains why losers are losing and what
  to test next; Module 2 "Winner patterns" extracts repeatable traits from your winning creatives.

### Creative & content features

- **Copy frameworks** (Module 5) — generate with proven DR structures (PAS, AIDA,
  Before-After-Bridge, Curiosity gap, UGC testimonial, Doctor/expert, "3 reasons why").
- **Iterate on any output** — per saved item: *more like this / punch up / shorter / re-tone*.
- **Platform char limits** — live character counts + over-limit warnings (FB headline ~40,
  primary text ~125, etc.).
- **More output types** — objection-busters, FAQ Q&A, and chatbot replies (each with its own
  saved bucket); copy items store `{ text, at, … }` with provenance.
- **Compliance checker** 🛡️ — flags risky health/beauty claims (cure/treat/guaranteed/FDA-PH)
  and suggests safer rewrites before you ship — protects the ad account.
- **Content → creative** — "→" on any saved copy spawns a Creative pre-filled with it.
- **Per-creative daily metrics** (Module 2) — log a creative's spend/revenue per day; the
  leaderboard ranks on the daily sum when present (else the aggregate blob), with a 7-day
  ROAS sparkline per creative.
- **AI variants** — "⎘" on a creative generates 3 new hook variations as linked creatives
  (`sourceCreativeId`), so you can A/B against a winner and trace lineage.
- **Winning-hook feedback** — marking a creative **Winner** auto-stars its hook (★) into the
  Hook Bank, so your bank compounds.

> **Asset generation (image/video):** the app generates the *prompt/brief*; producing the actual
> image/video needs an image API behind your proxy (Anthropic's API is text-only), or pasting the
> generated prompt into your media tool.

Navigation is hash-based: `#/dashboard`, `#/products`, `#/creatives`, `#/daily`,
`#/pages`, `#/content`, `#/competitors`.

---

## Backup: export / import

The header has **Export** (downloads all data as `stratos-backup-YYYYMMDD.json`) and
**Import** (restores from such a file, replacing all current data). Since everything is
`localStorage`-only, export regularly.

---

## Deploying (live, auto-updating)

The app is a no-build static site, so it deploys to any static host. It ships with a
**GitHub Pages** workflow (`.github/workflows/deploy.yml`) for continuous deploy:

1. One-time: `winget install --id GitHub.cli -e` then `gh auth login` (GitHub.com → web browser).
2. `gh repo create stratos-command-center --public --source=. --remote=origin --push`
3. In the repo: **Settings → Pages → Source = "GitHub Actions"** (the workflow does the rest).

After that, **every `git push` to `main` redeploys automatically** → `https://<user>.github.io/stratos-command-center/`.
(Netlify/Vercel/Cloudflare Pages also work — point them at the repo; no build command, publish dir = root.)

> Static hosts can't run the Node AI proxy, so on Pages use **direct** AI mode (each person's
> own key, stored only in their browser) or host `proxy/server.js` separately (Render/Railway/Worker).

## Shared team data (Cloud Sync via Supabase)

By default data is per-browser `localStorage`. To make the **whole team share one dataset**, the
app has an opt-in **Cloud Sync** (header → ☁ **Sync**) backed by Supabase's REST API — no SDK, no
server to run. It mirrors your data collections to one cloud record; teammates poll and stay in sync.

**Setup (≈1 minute, free):**
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → run:
   ```sql
   create table if not exists stratos_kv (
     key text primary key,
     value jsonb,
     updated_at timestamptz default now()
   );
   alter table stratos_kv enable row level security;
   create policy "stratos anon access" on stratos_kv
     for all using (true) with check (true);
   ```
3. **Project Settings → API** → copy the **Project URL** and the **anon public** key.
4. In the app: header **☁ Sync** → paste URL + key → toggle **On** → **Test connection** → **Save & connect**.
5. Do step 4 once per teammate's browser (same URL + key) → everyone shares the same data.

**Trade-offs (by design):**
- **Last-write-wins** on the whole snapshot — great for a small, coordinated team; if two people
  edit at the exact same time, the later save wins. Poll interval is configurable (default 5 s).
- **Config stays local** — your AI key, thresholds, team list and sync creds are *never* uploaded,
  so the key never reaches teammates. Only the data collections sync.
- **Security:** the anon-all RLS policy means anyone with the URL + anon key can read/write that
  table — fine for an internal team tool. For stricter control, add Supabase Auth + tighter RLS.

## Configurable thresholds (set during build, editable in-app)

| Setting | Default | Where it's used |
| --- | --- | --- |
| Product **fail score** | total `< 15` / 25 | Module 1 auto-tags `Failed` |
| **Scale** ROAS | `≥ 2.5` | Module 3 label + Module 1 `Scaling` tag |
| **Observe** ROAS | `1.5 – 2.49` | Module 3 label |
| **Kill** ROAS | `< 1.5` | Module 3 label |
| Creative rank weights | ROAS 40 · CPP 30 · CTR 20 · CPM 10 | Module 2 leaderboard |

---

## Computed metrics (never stored — derived live)

```
ROAS = revenue / spend
CPP  = spend / purchases          (cost per purchase)
CPM  = (spend / impressions) * 1000
CTR  = (clicks / impressions) * 100
```

Any divide-by-zero renders as `—`.

---

## Optional AI proxy

Two AI backends, chosen in **AI Settings**:

- **Direct** — browser calls `https://api.anthropic.com/v1/messages` directly with the
  `anthropic-dangerous-direct-browser-access` header. Key stored client-side. Internal use only.
- **Proxy** — the app POSTs to a local endpoint that holds the key server-side. A ~30-line
  Express scaffold lives in `proxy/server.js`.

`auto` uses the proxy if a Proxy URL is configured, otherwise falls back to direct.

### Running the proxy

```bash
cd proxy
npm install
ANTHROPIC_API_KEY=sk-ant-... node server.js   # Node 18+ (global fetch)
#   → STRATOS AI proxy on http://localhost:8787/ai
```

On Windows PowerShell:

```powershell
cd proxy
npm install
$env:ANTHROPIC_API_KEY = "sk-ant-..."
node server.js
```

Then in **AI Settings**: backend = `proxy` (or `auto`), Proxy URL = `http://localhost:8787/ai`.
The key never reaches the browser. **Where the key lives:** direct mode → browser
`localStorage` (`stratos:config` → `ai.apiKey`); proxy mode → the proxy process's
environment (`ANTHROPIC_API_KEY`), never sent to the client.

### Models & language

Default copy model `claude-sonnet-4-6`; bulk hook generation can use a cheaper model
(default `claude-haiku-4-5-20251001`). Both are editable in AI Settings, along with
`max_tokens` and the default output language (**Taglish** | English | Tagalog). Every
generator also has its own language toggle.

---

## Architecture / where things live

```
index.html            App shell (sidebar, header, #view)
css/styles.css        Design tokens + all component styles
js/
  app.js              Entry: hash router, header chips, export/import, AI settings modal
  store.js            THE data layer — the ONLY file that touches localStorage
  config.js           DEFAULT_CONFIG (thresholds, weights, AI settings) + merge helper
  metrics.js          Pure metric/ranking/labeling functions
  ai.js               AIService.generate() — direct + proxy backends
  ui.js               Shared DOM helpers: el(), pills, sortable tables, modal, toast
  util.js             uid, date helpers, number formatting, escapeHtml
  modules/            One file per module view (products, creatives, daily, pages, content, competitors)
proxy/
  server.js           Optional Express proxy (holds the API key server-side)
```

**Rule:** only `store.js` reads/writes `localStorage`; every module goes through its
typed CRUD helpers. Everything links by `productCode`.

### localStorage schema

All keys are namespaced `stratos:*` and hold a JSON array (or, for `config`, an object):

| Key | Shape |
| --- | --- |
| `stratos:products` | `Product[]` — keyed by `code` (e.g. `GINKGO-01`). The hub object. |
| `stratos:creatives` | `Creative[]` — keyed by `id`, linked via `productCode`. |
| `stratos:dailyMetrics` | `DailyMetric[]` — one row per `(productCode, date)`. |
| `stratos:pages` | `Page[]` — keyed by `id`, linked via `productCode`. |
| `stratos:competitors` | `Competitor[]` — keyed by `id`. |
| `stratos:hooks` | reusable hook-bank entries (Module 2). |
| `stratos:dailyReports` | `{ "YYYY-MM-DD": "report text" }` — Module 3 AI daily reports. |
| `stratos:config` | persisted config **overrides** (merged over `DEFAULT_CONFIG`). |

Generated copy items in `product.copy.*` are stored as `{ text, at, … }` objects (so
timestamps & provenance survive); older string entries are still rendered fine.

See `js/store.js` (`blankProduct()` and the entity sections) for the exact field list of
each entity.
