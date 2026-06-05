// research.js — AI Marketing Research.
//
// Surfaces trending hook formulas, viral content formats and angles for a
// niche/keyword (AI synthesis grounded in the product context), plus one-click
// deep links into the REAL FB Ad Library + TikTok Creative Center so you can
// scroll live ads. No scraping — the app stays a static client.

import * as store from '../store.js';
import * as ai from '../ai.js';
import { el, button, field, input, select, pageHeader, card, toast } from '../ui.js';

const PLATFORMS = ['Facebook', 'TikTok', 'Both'];
const state = { code: '', niche: '', platform: 'Facebook' };

function seg(values, current, onPick) {
  const wrap = el('div', { class: 'segmented' });
  values.forEach((v) => {
    const b = el('button', { type: 'button', text: v, class: v === current ? 'active' : '' });
    b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); onPick(v); });
    wrap.appendChild(b);
  });
  return wrap;
}

export function render(view) {
  const products = store.getProducts();
  view.appendChild(pageHeader(
    'Marketing Research',
    'Trending hooks, content formats & angles for your niche — plus one-click to real ads.',
  ));

  const nicheInput = input({ value: state.niche, placeholder: 'e.g. nerve supplement, scar gel, keto coffee' });
  nicheInput.addEventListener('input', (e) => { state.niche = e.target.value; });

  const productSel = select([{ value: '', label: '— free text —' }, ...products.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }))], {
    value: state.code,
    onChange: (e) => {
      state.code = e.target.value;
      const p = store.getProduct(state.code);
      if (p) { state.niche = [p.name, p.category].filter(Boolean).join(' '); nicheInput.value = state.niche; }
    },
  });

  const platSeg = seg(PLATFORMS, state.platform, (v) => { state.platform = v; });

  const openFb = () => {
    const q = encodeURIComponent((state.niche || '').trim());
    window.open(`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=PH&media_type=all${q ? '&q=' + q : ''}`, '_blank', 'noopener');
  };
  const openTt = () => {
    window.open('https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en', '_blank', 'noopener');
  };

  view.appendChild(card('Research',
    el('div', { class: 'form-grid' },
      field('From product (optional)', productSel),
      field('Niche / keyword', nicheInput),
    ),
    field('Platform', platSeg),
    el('div', { class: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
      button('🔎 Research trends (AI)', { variant: 'primary', onClick: research }),
      button('🔗 FB Ad Library', { variant: 'ghost', onClick: openFb }),
      button('🔗 TikTok Creative Center', { variant: 'ghost', onClick: openTt }),
    ),
    el('p', { class: 'field__hint', style: { margin: '12px 0 0' }, text: 'AI surfaces trending hook formulas, viral formats & angles. The 🔗 links open the REAL Ad Library / Creative Center (pre-searched in PH) so you can scroll live ads.' }),
  ));

  view.appendChild(card('How to use it',
    el('ul', { class: 'muted', style: { margin: 0, paddingLeft: '18px', lineHeight: '1.8', fontSize: '13px' } },
      el('li', { text: '1) Pick a product or type a niche/keyword.' }),
      el('li', { text: '2) “Research trends” → AI gives hook formulas, viral formats & angles for that niche.' }),
      el('li', { text: '3) Tap a 🔗 link to scroll the real trending ads, then recreate the best in Creative Testing.' }),
      el('li', { text: '4) Save the brief to the product, or generate hooks/scripts in AI Content.' }),
    ),
  ));
}

function research() {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  const niche = (state.niche || '').trim();
  if (!niche) { toast('Enter a niche / keyword.', 'warn'); return; }
  const product = store.getProduct(state.code);
  const plat = state.platform;
  const where = plat === 'Both' ? 'Facebook and TikTok' : plat;

  ai.openAiEditor({
    title: `Trend research — ${niche}`,
    system: `${ai.languageDirective()} You are a senior Philippine social-media marketing researcher who studies what is currently working on ${where} for direct-response e-commerce. Be concrete, current and usable — real patterns, not fluff.`,
    user: `${product ? ai.productContext(product) + '\n\n' : ''}Niche / keyword: "${niche}". Platform: ${plat}.\n\nWrite a punchy research brief with these exact sections:\n🔥 TRENDING HOOK FORMULAS — 6–8 hook templates working now, each with a 1-line example tailored to this niche.\n🎬 VIRAL CONTENT FORMATS — 5–6 formats (e.g. POV, street interview, before/after, day-in-the-life, "things I wish I knew", unboxing) and when to use each.\n🎯 ANGLES THAT CONVERT — 4–5 angles for this niche.\n📅 CONTENT IDEAS — 5 specific post/video ideas.\n🧲 SCROLL-STOPPERS — 3 pattern-interrupt opening lines.\nKeep it scannable with bullets.`,
    genOpts: { maxTokens: 1500 },
    saveLabel: product ? 'Save to product brief' : 'Done',
    onSave: (text) => {
      if (!product) return;
      const p = store.getProduct(product.code);
      if (!p) return;
      p.brief = (p.brief ? p.brief + '\n\n' : '') + 'RESEARCH:\n' + text;
      store.upsertProduct(p);
      toast('Saved to product brief.', 'success');
    },
  });
}
