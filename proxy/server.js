// STRATOS AI proxy — FREE backend via Groq (no paid Anthropic key needed).
//
// Get a FREE key (no credit card) at:  https://console.groq.com/keys
// Then either:
//   • double-click  start-ai-proxy.bat   (reads the key from the .ai_key file), or
//   • run:  GROQ_API_KEY=gsk_... node server.js     (Node 18+)
//
// In the app's AI Settings keep backend = proxy (or auto) and
// Proxy URL = http://localhost:8787/ai
//
// The app POSTs an Anthropic-style payload ({model, max_tokens, system, messages}python).
// We translate it to Groq's OpenAI-compatible Chat API and translate the reply
// back into an Anthropic-shaped response so the rest of the app works unchanged.

const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 8787;

// Key resolution order: env var -> .ai_key file next to this script.
function readKey() {
  let k = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  if (!k) {
    try { k = fs.readFileSync(path.join(__dirname, '.ai_key'), 'utf8').trim(); } catch {}
  }
  return k;
}
const KEY = readKey();
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

if (!KEY) {
  console.error('\n  No API key found.');
  console.error('  Get a FREE Groq key (no credit card): https://console.groq.com/keys');
  console.error('  Then paste it into a file named  .ai_key  in this folder.\n');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS so the statically-served app can call us from the browser.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'content-type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/ai', async (req, res) => {
  try {
    const body = req.body || {};

    // ---- Translate Anthropic payload -> Groq (OpenAI chat) format ----
    const messages = [];
    if (body.system) messages.push({ role: 'system', content: String(body.system) });
    for (const m of (body.messages || [])) {
      const content = Array.isArray(m.content)
        ? m.content.map((c) => c.text || '').join('\n')
        : String(m.content || '');
      messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
    }

    const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        max_tokens: body.max_tokens || 1024,
        temperature: 0.8,
      }),
    });

    const data = await gr.json();
    if (!gr.ok) {
      const msg = (data && data.error && data.error.message) || JSON.stringify(data);
      return res.status(gr.status).json({ error: { message: `Groq: ${String(msg).slice(0, 300)}` } });
    }

    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    // ---- Return an Anthropic-shaped response so the app parses it unchanged ----
    res.json({ content: [{ type: 'text', text }] });
  } catch (err) {
    res.status(500).json({ error: { message: String(err) } });
  }
});

app.listen(PORT, () => {
  console.log(`\n  STRATOS AI proxy (FREE via Groq) running on http://localhost:${PORT}/ai`);
  console.log(`  Model: ${GROQ_MODEL}`);
  console.log('  Leave this window open while you use the app. Close it to stop.\n');
});
