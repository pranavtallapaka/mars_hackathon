import dotenv from 'dotenv';
import express from 'express';
import { compilePlan } from '../shared/compiler';
import { CACHED_DEMO_PLAN, MARS_DEMO_BRIEFING } from '../shared/missions/mars-demo';
import { MARS_SURFACE } from '../shared/scenario';
import { grokModelCall } from './grok';

// The project's .env wins over stale keys exported in the user's shell.
dotenv.config({ override: true, quiet: true });

const PORT = Number(process.env.PORT ?? 3001);
const XAI_MODEL = process.env.XAI_MODEL ?? 'grok-4.7';
const XAI_REASONING_EFFORT = process.env.XAI_REASONING_EFFORT ?? 'low';
const MAX_INTENT_CHARS = 1000;

const keys = {
  xai: Boolean(process.env.XAI_API_KEY),
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
};

const app = express();
app.use(express.json());

// Reports only whether keys are present; never echo key values.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, keys });
});

app.post('/api/compile', async (req, res) => {
  const intent = typeof req.body?.intent === 'string' ? req.body.intent.trim() : '';
  const useCached = req.body?.useCached === true;
  if (!intent) return res.status(400).json({ error: 'intent is required' });
  if (intent.length > MAX_INTENT_CHARS) return res.status(400).json({ error: `intent is over ${MAX_INTENT_CHARS} characters` });

  const apiKey = process.env.XAI_API_KEY;
  const result = await compilePlan({
    intent,
    scenario: MARS_SURFACE,
    briefing: MARS_DEMO_BRIEFING,
    cachedPlan: CACHED_DEMO_PLAN,
    callModel: apiKey && !useCached ? grokModelCall(apiKey, XAI_MODEL, XAI_REASONING_EFFORT) : null,
    model: XAI_MODEL,
  });
  if (useCached) result.fallbackReason = 'operator chose the cached plan';
  console.log(
    `compile: ${result.source} in ${result.attempts.length} attempt(s)` +
      (result.fallbackReason ? ` (${result.fallbackReason})` : '') +
      result.attempts.flatMap((a) => a.errors.map((e) => `\n  - ${e}`)).join(''),
  );
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  for (const [name, loaded] of Object.entries(keys)) {
    console.log(`  ${name} key: ${loaded ? 'loaded' : 'MISSING'}`);
  }
});
