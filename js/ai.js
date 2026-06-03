// ai.js — the only module that talks to the model.
//
// generate(systemPrompt, userPrompt, opts) -> Promise<string>
// Two swappable backends behind a config toggle (AI Settings):
//   • direct — browser → https://api.anthropic.com/v1/messages with the
//     `anthropic-dangerous-direct-browser-access` header. Key is client-side
//     (internal-use only / insecure).
//   • proxy  — browser → a local endpoint that holds the key server-side
//     (see /proxy/server.js).
// backend 'auto' uses the proxy if a Proxy URL is set, else direct.

import * as store from './store.js';
import { openModal, textarea, toast, el, button, orbitalMark, skeleton } from './ui.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export function getAiConfig() { return store.getConfig().ai; }

/** Which backend will actually be used right now. */
export function resolveBackend(ai = getAiConfig()) {
  if (ai.backend === 'groq') return 'groq';
  if (ai.backend === 'direct') return 'direct';
  if (ai.backend === 'proxy') return 'proxy';
  // auto: prefer the FREE Groq key, then a configured proxy, then Anthropic direct
  if (ai.groqKey) return 'groq';
  return ai.proxyUrl ? 'proxy' : 'direct';
}

/** Is the resolved backend usable (has the credential/URL it needs)? */
export function isConfigured(ai = getAiConfig()) {
  const b = resolveBackend(ai);
  if (b === 'groq') return !!ai.groqKey;
  if (b === 'proxy') return !!ai.proxyUrl;
  return !!ai.apiKey;
}

/**
 * Core generation call. Returns the model's text. Throws on network/quota/etc.
 * opts: { model, maxTokens, bulk } — bulk:true uses the cheaper bulk model.
 */
export async function generate(systemPrompt, userPrompt, opts = {}) {
  const ai = getAiConfig();
  const model = opts.model || (opts.bulk ? ai.bulkModel : ai.copyModel);
  const maxTokens = opts.maxTokens || ai.maxTokens || 1024;
  const backend = resolveBackend(ai);
  const payload = { model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };

  if (backend === 'groq') {
    if (!ai.groqKey) throw new Error('No Groq key set. Open AI Settings → paste your free key from console.groq.com/keys.');
    return groqCall(ai, payload);
  }
  if (backend === 'direct') {
    if (!ai.apiKey) throw new Error('No Anthropic key set. Open AI Settings → add a key, or use the free Groq mode.');
    return directCall(ai, payload);
  }
  if (!ai.proxyUrl) throw new Error('No proxy URL set. Open AI Settings → use the free Groq mode, or set a proxy URL.');
  return proxyCall(ai, payload);
}

/** Direct browser call to Groq's OpenAI-compatible API (free; CORS-enabled). */
async function groqCall(ai, payload) {
  const messages = [];
  if (payload.system) messages.push({ role: 'system', content: String(payload.system) });
  for (const m of (payload.messages || [])) {
    const content = Array.isArray(m.content) ? m.content.map((c) => c.text || '').join('\n') : String(m.content || '');
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.groqKey}` },
      body: JSON.stringify({ model: ai.groqModel || 'llama-3.3-70b-versatile', messages, max_tokens: payload.max_tokens || 1024, temperature: 0.8 }),
    });
  } catch (err) {
    throw new Error(`Network error reaching Groq. Check your connection. (${err.message})`);
  }
  if (!res.ok) throw new Error(await apiError(res));
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Empty response from Groq.');
  return text.trim();
}

async function directCall(ai, payload) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Network error reaching Anthropic. Check your connection / CORS. (${err.message})`);
  }
  if (!res.ok) throw new Error(await apiError(res));
  return extractText(await res.json());
}

async function proxyCall(ai, payload) {
  let res;
  try {
    res = await fetch(ai.proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Could not reach proxy at ${ai.proxyUrl}. Is it running? (${err.message})`);
  }
  if (!res.ok) throw new Error(await apiError(res));
  return extractText(await res.json());
}

async function apiError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.error || JSON.stringify(body);
  } catch { detail = await res.text().catch(() => ''); }
  if (res.status === 401) return 'Auth failed (401) — check the API key.';
  if (res.status === 429) return 'Rate limited / quota exceeded (429). Try again shortly.';
  return `Request failed (${res.status}): ${String(detail).slice(0, 200)}`;
}

/** Pull text out of an Anthropic Messages response (or a lenient proxy shape). */
function extractText(data) {
  if (data && Array.isArray(data.content)) {
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
  if (typeof data === 'string') return data.trim();
  if (data && typeof data.text === 'string') return data.text.trim();
  if (data && data.error) throw new Error(data.error.message || String(data.error));
  throw new Error('Unexpected AI response shape.');
}

// ---------------------------------------------------------------------------
// Prompt-building helpers (shared by every generator)
// ---------------------------------------------------------------------------
export function languageDirective(language = getAiConfig().language) {
  switch (language) {
    case 'English': return 'Write in clear, natural English.';
    case 'Tagalog': return 'Sumulat sa malinaw na Tagalog (Filipino).';
    case 'Taglish':
    default:
      return 'Write in Taglish — a natural mix of Tagalog and English the way Filipino social-media ads sound. Target a Philippine Type B/C audience: relatable, conversational, persuasive.';
  }
}

export const TONES = {
  doctor: 'Authoritative, clinical, trustworthy — like a doctor or expert explaining benefits.',
  emotional: 'Warm, empathetic, story-driven — speak to feelings and pain points.',
  placebo: 'Reassuring and confidence-building; emphasize how good they will feel.',
  premium: 'Aspirational, polished, high-end; emphasize quality and exclusivity.',
  casual: 'Friendly, casual, barkada-style; light and fun.',
  UGC: 'Authentic user-generated-content style; sounds like a real customer review/testimonial.',
};
export function toneDirective(tone) {
  return tone && TONES[tone] ? `Tone: ${TONES[tone]}` : '';
}

/** Compact product context block for prompts. */
export function productContext(p) {
  if (!p) return '';
  const lines = [
    `Product: ${p.name || p.code} (${p.code})`,
    p.category ? `Category: ${p.category}` : '',
    p.painPoints?.length ? `Customer pain points: ${p.painPoints.join('; ')}` : '',
    p.offer?.mechanism ? `Mechanism: ${p.offer.mechanism}` : '',
    p.offer?.bundle ? `Bundle/offer: ${p.offer.bundle}` : '',
    p.offer?.guarantee ? `Guarantee: ${p.offer.guarantee}` : '',
    p.offer?.bonus ? `Bonus: ${p.offer.bonus}` : '',
    p.offer?.urgency ? `Urgency: ${p.offer.urgency}` : '',
    p.pricing?.srp ? `SRP: ₱${p.pricing.srp}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

/** Parse a model response into a clean list of items (strips bullets/numbers). */
export function parseList(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .map((l) => l.replace(/^["“](.*)["”]$/, '$1').trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Reusable generate → edit → save modal (loading + error + retry handled here)
// ---------------------------------------------------------------------------
/**
 * opts:
 *   title       modal title
 *   system,user prompts
 *   genOpts     passed to generate() (model/bulk/maxTokens)
 *   saveLabel   button label
 *   onSave(text) called with the edited text on Save
 *   asList      if true, show a hint that lines become list items
 */
export function openAiEditor(opts) {
  const ta = textarea({ rows: 12, value: '', placeholder: 'Generating…' });
  const status = el('div', {},
    el('div', { class: 'loading', style: { marginBottom: '12px' } }, orbitalMark(22, { spin: true }), el('span', { text: 'Generating with AI…' })),
    skeleton(4));
  const errBox = el('div', { class: 'field__hint', style: { color: 'var(--bad)' } });
  const body = el('div', { class: 'stack' },
    opts.asList ? el('div', { class: 'field__hint', text: 'Each non-empty line becomes a separate item.' }) : null,
    status, errBox, ta,
  );
  ta.style.display = 'none';

  let modalRef;
  let regenBtn, saveBtn;

  async function run() {
    status.style.display = '';
    errBox.textContent = '';
    ta.style.display = 'none';
    if (regenBtn) regenBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      const text = await generate(opts.system, opts.user, opts.genOpts || {});
      ta.value = text;
      ta.style.display = '';
      status.style.display = 'none';
    } catch (err) {
      status.style.display = 'none';
      errBox.textContent = err.message;
      ta.style.display = '';
      ta.placeholder = 'Generation failed — you can write manually or Regenerate.';
    } finally {
      if (regenBtn) regenBtn.disabled = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  modalRef = openModal({
    title: opts.title || 'AI generation',
    width: 640,
    body,
    actions: [
      { label: 'Cancel', variant: 'ghost', onClick: (close) => close() },
      { label: 'Regenerate', variant: 'ghost', onClick: () => run() },
      { label: opts.saveLabel || 'Save', variant: 'primary', onClick: (close) => {
        const text = ta.value.trim();
        if (!text) { errBox.textContent = 'Nothing to save.'; return; }
        opts.onSave(text);
        close();
      } },
    ],
  });
  // grab button refs for disabling during load
  const footBtns = modalRef.overlay.querySelectorAll('.modal__foot .btn');
  regenBtn = footBtns[1]; saveBtn = footBtns[2];

  run();
  return modalRef;
}
