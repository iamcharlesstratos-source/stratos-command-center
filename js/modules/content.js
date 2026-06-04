// content.js — Module 5: AI Content & Caption Generator.
//
// Pick a product (loads its context) + platform + tone + framework + output type
// + language, then generate copy. Outputs are editable and appended (with
// timestamps) into the product's `copy` buckets — never silently overwritten.
// Each saved item can be iterated on, turned into a Creative, or compliance-checked.

import * as store from '../store.js';
import * as ai from '../ai.js';
import {
  el, clear, button, field, select, pageHeader, card, toast, emptyState, openModal,
} from '../ui.js';

const PLATFORMS = ['Facebook', 'TikTok', 'Shopee', 'Lazada'];
const TONES = ['doctor', 'emotional', 'placebo', 'premium', 'casual', 'UGC'];
const LANGS = ['Taglish', 'English', 'Tagalog'];

// Proven direct-response copy frameworks.
const FRAMEWORKS = {
  None: '',
  PAS: 'Structure with PAS: call out the Problem, Agitate it, then present the Solution.',
  AIDA: 'Structure with AIDA: grab Attention, build Interest, spark Desire, drive Action.',
  'Before-After-Bridge': 'Use Before-After-Bridge: the painful before, the dream after, then the product as the bridge.',
  'Curiosity gap': 'Open with a curiosity gap that forces the reader to keep reading.',
  'UGC testimonial': 'Write as a believable first-person customer testimonial (UGC).',
  'Doctor / expert': 'Frame as an authoritative doctor/expert explaining why it works.',
  '3 reasons why': 'Use a punchy "3 reasons why" listicle structure.',
};

// output type -> { bucket (in product.copy), label, limit (char soft-cap or null) }
const OUTPUT_TYPES = {
  hook: { bucket: 'hooks', label: 'scroll-stopping hooks', limit: 80 },
  caption: { bucket: 'captions', label: 'ad captions', limit: 150 },
  headline: { bucket: 'headlines', label: 'headlines', limit: 40 },
  'primary text': { bucket: 'primaryText', label: 'primary text variations', limit: 125 },
  CTA: { bucket: 'ctas', label: 'calls-to-action', limit: 25 },
  script: { bucket: 'scripts', label: 'short video scripts', limit: null },
  'objection-buster': { bucket: 'objections', label: 'objection-busting replies', limit: null },
  FAQ: { bucket: 'faqs', label: 'FAQ Q&A', limit: null },
  'chatbot reply': { bucket: 'chatbot', label: 'chatbot replies', limit: null },
};
const BUCKETS = ['hooks', 'captions', 'headlines', 'primaryText', 'adSets', 'ctas', 'scripts', 'objections', 'faqs', 'chatbot'];
function bucketLimit(bucket) { const e = Object.values(OUTPUT_TYPES).find((o) => o.bucket === bucket); return e ? e.limit : null; }

const PLATFORM_NOTE = {
  Facebook: 'Platform: Facebook feed ad — hook fast, conversational, emoji-light. Primary text truncates ~125 chars; headline ~40.',
  TikTok: 'Platform: TikTok — native, punchy, trend-aware, very casual. The hook must land in the first line.',
  Shopee: 'Platform: Shopee listing — benefit bullets, keywords, promo-driven.',
  Lazada: 'Platform: Lazada listing — benefit bullets, keywords, promo-driven.',
};

// Image-gen styles → descriptive cues appended to the prompt.
const IMAGE_STYLES = {
  'Studio product': 'professional studio product photography, clean seamless background, soft diffused lighting, sharp detail, commercial quality',
  'UGC lifestyle': 'authentic user-generated content style, a real Filipino person holding/using the product, natural daylight, casual phone-photo look',
  'Flat-lay': 'top-down flat-lay arrangement with tasteful props, bright and airy, minimal aesthetic',
  'Home lifestyle': 'product in a cozy real-life Filipino home setting, warm relatable mood, lifestyle photography',
  'Bold promo': 'bold promotional ad creative, vibrant high-contrast colors, strong central product, clean space for a text overlay',
};

const state = { code: '', platform: 'Facebook', tone: 'emotional', framework: 'None', output: 'caption', language: 'Taglish' };

export function render(view) {
  const products = store.getProducts();
  view.appendChild(pageHeader('AI Content & Caption Generator', 'On-brand captions, hooks, headlines, scripts, objection-busters & chatbot replies — in Taglish.'));

  if (!products.length) {
    view.appendChild(emptyState('Add a product first (Module 1) — content is generated from a product\'s context.',
      button('Go to products', { variant: 'primary', onClick: () => { location.hash = '#/products'; } })));
    return;
  }
  if (!state.code || !store.getProduct(state.code)) state.code = products[0].code;

  // ---- controls ----
  const productSel = select(products.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` })), { value: state.code, onChange: (e) => { state.code = e.target.value; rerender(view); } });
  const toneSel = select(TONES, { value: state.tone, onChange: (e) => state.tone = e.target.value });
  const frameworkSel = select(Object.keys(FRAMEWORKS), { value: state.framework, onChange: (e) => state.framework = e.target.value });
  const outputSel = select(Object.keys(OUTPUT_TYPES), { value: state.output, onChange: (e) => state.output = e.target.value });
  const countInput = el('input', { class: 'input', type: 'number', min: 1, max: 20, value: 5 });
  const platformSeg = seg(PLATFORMS, state.platform, (v) => state.platform = v);
  const langSeg = seg(LANGS, state.language, (v) => state.language = v);

  const controls = el('div', { class: 'stack' },
    el('div', { class: 'form-grid' },
      field('Product', productSel),
      field('Tone', toneSel),
      field('Framework', frameworkSel),
      field('Output type', outputSel),
      field('How many', countInput),
    ),
    field('Platform', platformSeg),
    field('Language', langSeg),
  );

  const genBtn = button('✨ Generate', { variant: 'primary', onClick: () => generate(view, state.output, toNumSafe(countInput.value, 5)) });
  const complianceBtn = button('🛡️ Compliance check', { variant: 'ghost', onClick: () => complianceCheck(view) });
  const quick = el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
    button('10 hooks', { variant: 'ghost', onClick: () => generate(view, 'hook', 10, true) }),
    button('5 captions', { variant: 'ghost', onClick: () => generate(view, 'caption', 5) }),
    button('3 CTAs', { variant: 'ghost', onClick: () => generate(view, 'CTA', 3) }),
    button('3 video scripts', { variant: 'ghost', onClick: () => generate(view, 'script', 3) }),
    button('5 objection-busters', { variant: 'ghost', onClick: () => generate(view, 'objection-buster', 5) }),
  );

  // Facebook / Meta ad-copy fields — the two most-used + matched pairs.
  const fbCopy = el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
    button('5 Primary Texts', { variant: 'ghost', onClick: () => generate(view, 'primary text', 5) }),
    button('5 Headlines', { variant: 'ghost', onClick: () => generate(view, 'headline', 5) }),
    button('📣 3 Full Ad Sets (Primary + Headline)', { variant: 'primary', onClick: () => generateAdSet(view, 3) }),
  );

  view.appendChild(card('Generator',
    controls,
    el('hr', { class: 'divider' }),
    el('div', { class: 'spread' }, el('span', { class: 'field__label', text: 'Quick generate' }), el('div', { class: 'row', style: { gap: '8px' } }, complianceBtn, genBtn)),
    el('div', { style: { marginTop: '10px' } }, quick),
    el('div', { class: 'field__label', style: { marginTop: '14px' } }, 'Facebook ad copy'),
    el('div', { style: { marginTop: '6px' } }, fbCopy),
    el('div', { class: 'field__label', style: { marginTop: '14px' } }, 'Creative image'),
    el('div', { style: { marginTop: '6px' } }, button('🎨 Generate ad image (AI)', { variant: 'primary', onClick: () => openImageGen(view) })),
  ));

  view.appendChild(renderSavedCopy(view));
}

function rerender(view) { clear(view); render(view); }
function toNumSafe(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; }

function seg(values, current, onPick) {
  const wrap = el('div', { class: 'segmented' });
  values.forEach((v) => { const b = el('button', { type: 'button', text: v, class: v === current ? 'active' : '' }); b.addEventListener('click', () => { wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); onPick(v); }); wrap.appendChild(b); });
  return wrap;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
function buildSystem() {
  return [ai.languageDirective(state.language), ai.toneDirective(state.tone), FRAMEWORKS[state.framework], PLATFORM_NOTE[state.platform],
    'You are a top Filipino direct-response copywriter.'].filter(Boolean).join(' ');
}

function generate(view, outputType, count, bulk) {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  const product = store.getProduct(state.code);
  if (!product) { toast('Pick a product.', 'warn'); return; }
  const spec = OUTPUT_TYPES[outputType];
  const limitNote = spec.limit ? ` Keep each under ~${spec.limit} characters.` : '';
  const user = `${ai.productContext(product)}\n\nWrite ${count} ${spec.label} for the platform above.${limitNote} One per line, no numbering.`;

  ai.openAiEditor({
    title: `Generate ${count} ${spec.label} — ${product.code}`,
    asList: true, system: buildSystem(), user, genOpts: { bulk: !!bulk },
    saveLabel: spec.bucket ? `Append to ${spec.bucket}` : 'Done',
    onSave: (text) => {
      const items = ai.parseList(text);
      store.appendProductCopy(product.code, spec.bucket, items, { platform: state.platform, tone: state.tone, lang: state.language, framework: state.framework });
      toast(`Appended ${items.length} → ${product.code}.copy.${spec.bucket}`, 'success');
      rerender(view);
    },
  });
}

// Complete Facebook ad copy: matched Primary Text + Headline pairs (one full ad each).
function generateAdSet(view, count) {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  const product = store.getProduct(state.code);
  if (!product) { toast('Pick a product.', 'warn'); return; }
  const user = `${ai.productContext(product)}\n\nWrite ${count} complete Facebook ad-copy variations for this product. Each variation has:\n• Primary Text — a hook-first body, ~125 characters, conversational and emoji-light.\n• Headline — punchy, max ~40 characters.\n\nFormat EXACTLY like this and separate each variation with a line of three dashes:\nPrimary Text: <text>\nHeadline: <text>\n---\nPrimary Text: <text>\nHeadline: <text>\n\nNo numbering, no extra commentary.`;

  ai.openAiEditor({
    title: `Generate ${count} Facebook ad sets — ${product.code}`,
    system: buildSystem(), user,
    saveLabel: 'Append to adSets',
    onSave: (text) => {
      const sets = text.split(/^\s*-{3,}\s*$/m).map((s) => s.trim()).filter(Boolean);
      const items = sets.length ? sets : [text.trim()];
      store.appendProductCopy(product.code, 'adSets', items, { platform: state.platform, tone: state.tone, lang: state.language });
      toast(`Appended ${items.length} ad set(s) → ${product.code}`, 'success');
      rerender(view);
    },
  });
}

// Iterate on a single saved item ------------------------------------------------
function openIterateModal(view, bucket, text) {
  let ref;
  const mk = (label, mode) => button(label, { variant: 'ghost', onClick: () => { ref.close(); iterate(view, bucket, text, mode); } });
  ref = openModal({
    title: 'Iterate on this', width: 520,
    body: el('div', { class: 'stack' },
      el('p', { class: 'muted', style: { margin: 0 }, text: `"${text}"` }),
      el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
        mk('More like this', 'more'), mk('Punch up', 'punch'), mk('Shorter', 'shorter'), mk(`Re-tone (${state.tone})`, 'tone'))),
    actions: [{ label: 'Close', variant: 'ghost', onClick: (c) => c() }],
  });
}
function iterate(view, bucket, text, mode) {
  const product = store.getProduct(state.code);
  if (!product) { toast('Product not found.', 'warn'); return; }
  const instr = {
    more: 'Write 3 fresh variations in the same style and angle.',
    punch: 'Rewrite into 3 punchier, higher-energy versions with stronger hooks.',
    shorter: 'Rewrite into 3 shorter, tighter versions.',
    tone: `Rewrite into 3 versions in a ${state.tone} tone.`,
  }[mode];
  ai.openAiEditor({
    title: `Iterate — ${mode}`, asList: true,
    system: `${ai.languageDirective(state.language)} ${ai.toneDirective(state.tone)} You refine high-converting ad copy.`,
    user: `Original ${bucket} item:\n"${text}"\n\n${instr} One per line, no numbering.`,
    saveLabel: `Append to ${bucket}`,
    onSave: (t) => { store.appendProductCopy(product.code, bucket, ai.parseList(t), { iteratedFrom: text.slice(0, 40) }); toast('Variations added.', 'success'); rerender(view); },
  });
}

// Compliance check --------------------------------------------------------------
function complianceCheck(view) {
  if (!ai.isConfigured()) { toast('Set up AI first (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
  const product = store.getProduct(state.code);
  if (!product) { toast('Product not found.', 'warn'); return; }
  const copy = product.copy || {};
  const texts = [];
  for (const b of BUCKETS) (copy[b] || []).forEach((it) => texts.push(`[${b}] ${typeof it === 'string' ? it : it.text}`));
  if (product.brief) texts.push(`[brief] ${product.brief}`);
  if (!texts.length) { toast('No saved copy to check yet — generate some first.', 'warn'); return; }
  ai.openAiEditor({
    title: `Compliance check — ${product.code}`,
    system: 'You are an ad-compliance reviewer for Philippine Facebook/TikTok ads in health & beauty. Flag claims that violate Meta advertising policy or FDA-Philippines rules: disease/cure/treatment claims, "guaranteed"/"100%"/"no side effects", unverified before/after, and medical claims for supplements (PH requires "No Approved Therapeutic Claims").',
    user: `Review this marketing copy. List ONLY the risky items as: ⚠️ "<phrase>" — why it's risky — ✅ safer rewrite. If something is fine, skip it. Be concise.\n\n${texts.join('\n')}`,
    saveLabel: 'Close', onSave: () => {},
  });
}

// Turn a saved item into a Creative ---------------------------------------------
function makeCreative(bucket, text) {
  const product = store.getProduct(state.code);
  if (!product) { toast('Product not found.', 'warn'); return; }
  const isScript = bucket === 'scripts';
  store.upsertCreative({
    productCode: product.code,
    type: isScript ? 'video' : 'image',
    title: `From ${bucket}: ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}`,
    hook: isScript ? '' : text,
    script: isScript ? text : '',
    status: 'To Do',
  });
  toast(`Creative created for ${product.code}. Opening Creative Machine…`, 'success');
  location.hash = '#/creatives';
}

// ---------------------------------------------------------------------------
// Real AI image creative — free in-browser generation via Pollinations.ai
// (just an <img> URL: no API key, renders on load). Save sticks the image URL
// + prompt onto a new Creative.
// ---------------------------------------------------------------------------
function defaultImagePrompt(product, styleKey) {
  return [product.name || product.code, product.category, IMAGE_STYLES[styleKey], 'advertising photo, no text, no watermark']
    .filter(Boolean).join(', ');
}

function openImageGen(view) {
  const product = store.getProduct(state.code);
  if (!product) { toast('Pumili muna ng product.', 'warn'); return; }

  let seed = Math.floor(Math.random() * 1e6);
  let currentUrl = '';

  const styleSel = select(Object.keys(IMAGE_STYLES), { value: 'Studio product' });
  const ratioSel = select(['1:1 (feed)', '4:5 (feed)', '9:16 (story/reel)'], { value: '1:1 (feed)' });
  const promptTa = textarea({ rows: 3, value: defaultImagePrompt(product, 'Studio product') });
  const status = el('div', { class: 'field__hint' });
  const imgWrap = el('div', { style: { marginTop: '10px' } });

  styleSel.addEventListener('change', () => { promptTa.value = defaultImagePrompt(product, styleSel.value); });

  function dims() {
    const r = ratioSel.value;
    if (r.startsWith('4:5')) return [896, 1120];
    if (r.startsWith('9:16')) return [768, 1344];
    return [1024, 1024];
  }
  function buildUrl() {
    const [w, h] = dims();
    const p = encodeURIComponent(promptTa.value.trim().slice(0, 800));
    return `https://image.pollinations.ai/prompt/${p}?width=${w}&height=${h}&nologo=true&seed=${seed}&model=flux`;
  }
  function generate() {
    if (!promptTa.value.trim()) { toast('Magsulat ng prompt.', 'warn'); return; }
    currentUrl = buildUrl();
    clear(imgWrap);
    status.style.color = 'var(--text-dim)';
    status.textContent = 'Gumagawa ng larawan… (mga 10–25 segundo)';
    const img = el('img', { alt: 'AI ad creative', style: { width: '100%', maxWidth: '340px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'block' } });
    img.addEventListener('load', () => { status.style.color = 'var(--good)'; status.textContent = '✅ Tapos. I-regenerate para sa ibang bersyon, o i-save.'; });
    img.addEventListener('error', () => { status.style.color = 'var(--bad)'; status.textContent = 'Hindi ma-generate. Subukan ulit o palitan ang prompt.'; });
    imgWrap.appendChild(img);
    img.src = currentUrl;
  }
  function autoPrompt() {
    if (!ai.isConfigured()) { toast('I-set up muna ang AI (AI Settings).', 'warn'); window.STRATOS.openAiSettings(); return; }
    const prev = promptTa.value;
    promptTa.value = 'Writing prompt…';
    ai.generate(
      'You are an expert at writing prompts for an AI image generator. Output ONE single-line English image prompt only — no preamble, no quotes, no markdown.',
      `${ai.productContext(product)}\n\nWrite an image-generation prompt for a "${styleSel.value}" style advertising photo of this product. Be specific about subject, setting, lighting, mood and colors. Under 60 words. End with: no text, no watermark.`,
    ).then((t) => { promptTa.value = (t || '').trim().replace(/^["']|["']$/g, '') || prev; })
     .catch((e) => { promptTa.value = prev; toast('AI prompt failed: ' + e.message, 'error'); });
  }

  const body = el('div', { class: 'stack' },
    el('div', { class: 'form-grid' }, field('Style', styleSel), field('Ratio', ratioSel)),
    field('Prompt', promptTa, { hint: 'Auto-filled mula sa product — pwede i-edit. English ang pinakaok para sa image AI.' }),
    el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      button('✨ Auto-write prompt', { variant: 'ghost', onClick: autoPrompt }),
      button('🎨 Generate', { variant: 'primary', onClick: generate }),
      button('🔁 Regenerate', { variant: 'ghost', onClick: () => { seed = Math.floor(Math.random() * 1e6); generate(); } }),
    ),
    status,
    imgWrap,
    el('p', { class: 'field__hint', text: 'Pang-concept / mockup / brief ito sa graphic artist — hindi pang-final na ad.' }),
  );

  openModal({
    title: `AI ad image — ${product.code}`, width: 600, body,
    actions: [
      { label: 'Close', variant: 'ghost', onClick: (c) => c() },
      { label: 'Open full', variant: 'ghost', onClick: () => { if (currentUrl) window.open(currentUrl, '_blank'); else toast('Generate muna.', 'warn'); } },
      { label: 'Save as creative', variant: 'primary', onClick: (c) => {
        if (!currentUrl) { toast('Generate muna ng image.', 'warn'); return; }
        store.upsertCreative({ productCode: product.code, type: 'image', title: `AI image: ${promptTa.value.slice(0, 36)}…`, brief: promptTa.value, imageUrl: currentUrl, status: 'To Do' });
        toast('Na-save sa Creatives (may image).', 'success'); c();
      } },
    ],
  });
}

// ---------------------------------------------------------------------------
// Saved copy viewer (per product, with char counts, iterate, → creative, delete)
// ---------------------------------------------------------------------------
function renderSavedCopy(view) {
  const product = store.getProduct(state.code);
  if (!product) return el('section', { class: 'card' }, el('p', { class: 'muted', text: 'Product not found.' }));
  const copy = product.copy || {};
  const c = el('section', { class: 'card' });
  c.appendChild(el('div', { class: 'spread' },
    el('h3', { class: 'card__title', style: { margin: 0 }, text: `Saved copy — ${product.code}` }),
    el('a', { href: `#/products/${encodeURIComponent(product.code)}`, class: 'btn btn--ghost btn--sm', text: 'Open product →' })));

  const total = BUCKETS.reduce((s, b) => s + (copy[b]?.length || 0), 0);
  if (!total) { c.appendChild(el('p', { class: 'muted', style: { margin: '8px 0 0' }, text: 'No saved copy yet. Generate above — outputs append here and onto the product.' })); return c; }

  BUCKETS.forEach((b) => {
    const items = copy[b] || [];
    if (!items.length) return;
    const limit = bucketLimit(b);
    c.appendChild(el('div', { class: 'field__label', style: { marginTop: '14px' } }, `${b} (${items.length})`));
    const list = el('div', { class: 'stack', style: { gap: '6px' } });
    items.forEach((it, idx) => {
      const txt = typeof it === 'string' ? it : it.text;
      const at = typeof it === 'object' && it.at ? new Date(it.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const over = limit && txt.length > limit;
      const meta = el('div', { class: 'muted', style: { fontSize: '10px', marginTop: '3px' } },
        el('span', { style: { color: over ? 'var(--bad)' : 'inherit' }, text: `${txt.length} chars${limit ? ` / ${limit}` : ''}${over ? ` · over by ${txt.length - limit}` : ''}` }),
        at ? document.createTextNode('  ·  ' + at) : null);
      const actions = el('div', { class: 'row', style: { gap: '4px' } },
        button('↻', { variant: 'subtle', title: 'Iterate (more like this / punch up / shorter / re-tone)', onClick: () => openIterateModal(view, b, txt) }),
        button('→', { variant: 'subtle', title: 'Make this a creative', onClick: () => makeCreative(b, txt) }),
        button('✕', { variant: 'subtle', title: 'Delete', onClick: () => { const p = store.getProduct(product.code); p.copy[b].splice(idx, 1); store.upsertProduct(p); rerender(view); } }));
      list.appendChild(el('div', { class: 'spread', style: { padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', alignItems: 'flex-start' } },
        el('div', {}, el('div', { text: txt, style: { whiteSpace: 'pre-wrap' } }), meta), actions));
    });
    c.appendChild(list);
  });
  return c;
}
