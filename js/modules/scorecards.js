// scorecards.js — Team Scorecards.
//
// Turns the work the team already logs into weekly KPIs per person:
// creatives produced, usable (Approved+), winners, win rate, output vs quota,
// and the average ROAS of the work they shipped. Plus an account-wide card for
// the advertiser group (CTR/ROAS/profit), since campaigns aren't attributed to
// one person. Read-only, deterministic — the playbook's "Team Scorecards".

import * as store from '../store.js';
import * as metrics from '../metrics.js';
import { el, button, pageHeader, card, statTile, sortableTable, input, field, toast, dateRangeControl } from '../ui.js';
import { resolveRange, inRange } from '../util.js';

const APPROVED_SET = ['Approved', 'Launched', 'Winner'];
const isAdmin = () => !window.STRATOS || window.STRATOS.isAdmin();

export function render(view) {
  const cfg = store.getConfig();
  const quota = Number(cfg.creativeQuota) > 0 ? Number(cfg.creativeQuota) : 10;
  const range = store.getDateRange();
  const rr = resolveRange(range);
  const label = rr.label;

  const picker = dateRangeControl({ value: range, onChange: (resolved, raw) => { store.setDateRange(raw); rerender(view); } });

  view.appendChild(pageHeader('Team Scorecards', 'Who shipped what — creatives, winners, win rate & output vs quota.', [picker]));

  const allCreatives = store.getCreatives();
  const inWindow = (c) => inRange(c.createdAt, rr);
  const creatives = allCreatives.filter(inWindow);

  // Build the roster: configured team + anyone actually assigned work.
  const names = new Set((cfg.team || []).filter((n) => n && n !== 'Unassigned'));
  allCreatives.forEach((c) => { if (c.assignee && c.assignee !== 'Unassigned') names.add(c.assignee); });

  const rows = [...names].map((name) => {
    const produced = creatives.filter((c) => c.assignee === name);
    const usable = produced.filter((c) => APPROVED_SET.includes(c.status));
    const winners = produced.filter((c) => c.status === 'Winner');
    const agg = metrics.aggregate(usable.map((c) => metrics.creativeRawMetrics(c)));
    return {
      name,
      produced: produced.length,
      usable: usable.length,
      winners: winners.length,
      winRate: produced.length ? Math.round((winners.length / produced.length) * 100) : 0,
      roas: agg.roas,
      quotaPct: Math.min(100, Math.round((produced.length / quota) * 100)),
    };
  }).sort((a, b) => b.winners - a.winners || b.usable - a.usable || b.produced - a.produced);

  // Team totals
  const tProduced = rows.reduce((s, r) => s + r.produced, 0);
  const tUsable = rows.reduce((s, r) => s + r.usable, 0);
  const tWinners = rows.reduce((s, r) => s + r.winners, 0);
  view.appendChild(el('div', { class: 'grid grid-4', style: { marginBottom: 'var(--gap)' } },
    statTile(`Produced (${label.toLowerCase()})`, String(tProduced)),
    statTile('Usable (Approved+)', String(tUsable), { tone: 'good' }),
    statTile('Winners', String(tWinners), { tone: tWinners ? 'good' : undefined }),
    statTile('Team win rate', tProduced ? Math.round((tWinners / tProduced) * 100) + '%' : '—'),
  ));

  // Quota control (admin)
  if (isAdmin()) {
    const qIn = input({ type: 'number', min: 1, value: quota, style: { width: '90px' } });
    const save = button('Save', { variant: 'ghost', onClick: () => { store.updateConfig({ creativeQuota: Math.max(1, Number(qIn.value) || 10) }); toast('Quota saved.', 'success'); rerender(view); } });
    view.appendChild(card('Output quota',
      el('div', { class: 'row', style: { gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' } },
        field('Target creatives / person', qIn),
        save,
        el('span', { class: 'field__hint', text: 'Drives the output bar below. Compare against the selected window.' }))));
  }

  // Per-person scorecard table
  if (!rows.length) {
    view.appendChild(card('No team members yet',
      el('p', { class: 'muted', style: { margin: 0 }, text: 'Add team members in Creative Testing → Manage team, then assign creatives to them.' }),
      el('div', { style: { marginTop: '10px' } }, el('a', { href: '#/creatives', class: 'btn btn--primary btn--sm', text: 'Go to Creatives' }))));
  } else {
    const columns = [
      { key: 'name', label: 'Person', render: (r) => el('strong', { text: r.name }) },
      { key: 'produced', label: 'Produced', align: 'right', sortValue: (r) => r.produced, render: (r) => String(r.produced) },
      { key: 'usable', label: 'Usable', align: 'right', sortValue: (r) => r.usable, render: (r) => String(r.usable) },
      { key: 'winners', label: 'Winners', align: 'right', sortValue: (r) => r.winners, render: (r) => el('strong', { style: { color: r.winners ? 'var(--good)' : 'inherit' }, text: String(r.winners) }) },
      { key: 'winRate', label: 'Win %', align: 'right', sortValue: (r) => r.winRate, render: (r) => r.produced ? r.winRate + '%' : '—' },
      { key: 'roas', label: 'Avg ROAS', align: 'right', sortValue: (r) => r.roas ?? -1, render: (r) => metrics.fmt(r.roas, 'roas') },
      { key: 'output', label: 'Output vs quota', sortable: false, render: (r) => el('div', { style: { minWidth: '130px' } },
        el('div', { style: { fontSize: '11px', marginBottom: '3px' }, text: `${r.produced} / ${quota}` }),
        el('div', { class: 'gauge__track' }, el('div', { class: 'gauge__fill', style: { width: r.quotaPct + '%' } }))) },
    ];
    view.appendChild(card(`Scorecards — ${label}`, sortableTable(columns, rows, { sort: { key: 'winners', dir: 'desc' } })));
  }

  // Account-wide card (advertiser group) — campaigns aren't per-person attributable
  view.appendChild(renderAccountCard(rr));
}

function rerender(view) { while (view.firstChild) view.removeChild(view.firstChild); render(view); }

function renderAccountCard(rr) {
  const rows = store.getDailyMetrics().filter((r) => inRange(r.date, rr));
  const agg = metrics.aggregate(rows);
  let profit = 0;
  for (const r of rows) profit += metrics.profit(r, store.getProduct(r.productCode));
  const c = el('section', { class: 'card' });
  c.appendChild(el('h3', { class: 'card__title', text: `📈 Account — advertisers (${rr.label.toLowerCase()})` }));
  c.appendChild(el('p', { class: 'field__hint', style: { marginTop: 0 }, text: 'Account-wide totals from Daily Metrics. Campaigns aren’t attributed to one advertiser, so this is the shared advertiser KPI.' }));
  if (!rows.length) { c.appendChild(el('p', { class: 'muted', style: { margin: 0 }, text: 'No daily metrics in this window yet.' })); return c; }
  c.appendChild(el('div', { class: 'grid grid-4' },
    statTile('Spend', metrics.fmt(agg.spend, 'peso')),
    statTile('Revenue', metrics.fmt(agg.revenue, 'peso')),
    statTile('ROAS', metrics.fmt(agg.roas, 'roas'), { tone: agg.roas >= 2 ? 'good' : agg.roas >= 1 ? 'warn' : 'bad' }),
    statTile('Profit', metrics.fmt(profit, 'peso'), { tone: profit > 0 ? 'good' : profit < 0 ? 'bad' : undefined }),
  ));
  c.appendChild(el('div', { class: 'grid grid-4', style: { marginTop: 'var(--gap)' } },
    statTile('Orders', String(agg.purchases)),
    statTile('CTR', metrics.fmt(agg.ctr, 'ctr')),
    statTile('CPP', metrics.fmt(agg.cpp, 'cpp')),
    statTile('CPM', metrics.fmt(agg.cpm, 'cpm')),
  ));
  return c;
}
