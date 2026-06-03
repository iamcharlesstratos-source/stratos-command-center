// STRATOS AI proxy — keeps the Anthropic API key server-side.
// Run:  ANTHROPIC_API_KEY=sk-ant-... node server.js   (Node 18+ for global fetch)
// Then in the app's AI Settings set backend = proxy, Proxy URL = http://localhost:8787/ai
//
// The app POSTs an Anthropic Messages payload ({model, max_tokens, system, messages});
// this forwards it with the key attached and returns Anthropic's JSON verbatim.

const express = require('express');

const PORT = process.env.PORT || 8787;
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('Set ANTHROPIC_API_KEY in the environment first.'); process.exit(1); }

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS so the statically-served app (e.g. http://localhost:8000) can call us.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'content-type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/ai', async (req, res) => {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: String(err) } });
  }
});

app.listen(PORT, () => console.log(`STRATOS AI proxy on http://localhost:${PORT}/ai`));
