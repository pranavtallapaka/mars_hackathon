import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { compilePlan } from '../shared/compiler';
import { CACHED_DEMO_PLAN, MARS_DEMO_BRIEFING } from '../shared/missions/mars-demo';
import { sceneSchema } from '../shared/plan';
import { MARS_SURFACE } from '../shared/scenario';
import type { SceneVariant } from '../shared/scene';
import { loadMissionContext } from '../shared/envelope/context';
import type { SiteId } from '../shared/envelope/types';
import { grokModelCall } from './grok';
import { cachedReconstruction, reconstructScene, RECON_DIR } from './imagine';
import { cachedVoice, readVoiceFile, synthesize, transcribe } from './elevenlabs';
import { runCampaignBatchParallel } from './campaignPool';
import { persistCampaign, persistMissionContext, spacetimeConfig, spacetimeConnected } from './spacetime';

// The project's .env wins over stale keys exported in the user's shell.
dotenv.config({ override: true, quiet: true });

const PORT = Number(process.env.PORT ?? 3001);
const XAI_MODEL = process.env.XAI_MODEL ?? 'grok-4.7';
const XAI_IMAGE_MODEL = process.env.XAI_IMAGE_MODEL ?? 'grok-imagine-image-2.0';
const XAI_REASONING_EFFORT = process.env.XAI_REASONING_EFFORT ?? 'low';
const MAX_INTENT_CHARS = 1000;
const ID_RE = /^[a-f0-9]{8}$/;

const SITE_IDS = new Set<SiteId>(['jezero', 'oxia']);
const HORIZONS_CSV = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../shared/envelope/data/earth-mars-2026-2028.csv'),
  'utf8',
);

const keys = {
  xai: Boolean(process.env.XAI_API_KEY),
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
};

const app = express();
app.use(express.json({ limit: '3mb' }));

// Reports only whether keys are present; never echo key values.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, keys, spacetime: { ...spacetimeConfig(), connected: spacetimeConnected() } });
});

app.post('/api/mission-context', async (req, res) => {
  const siteId = typeof req.body?.siteId === 'string' ? req.body.siteId : '';
  const startDate = typeof req.body?.startDate === 'string' ? req.body.startDate : '';
  const sols = Number(req.body?.sols);
  if (!SITE_IDS.has(siteId as SiteId)) return res.status(400).json({ error: 'siteId must be jezero or oxia' });
  if (!startDate) return res.status(400).json({ error: 'startDate is required' });
  if (!Number.isInteger(sols)) return res.status(400).json({ error: 'sols must be an integer' });

  let context;
  try {
    context = loadMissionContext({ siteId: siteId as SiteId, startDate, sols }, HORIZONS_CSV);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  try {
    const contextId = await persistMissionContext(context);
    console.log(`mission-context: wrote ${contextId} (${context.sols.length} sols) to SpacetimeDB`);
    res.json({ context, persisted: true, contextId });
  } catch (err) {
    const persistError = (err as Error).message;
    console.warn(`mission-context: computed ${siteId} ${startDate} ${sols} but persist failed: ${persistError}`);
    res.json({ context, persisted: false, persistError });
  }
});

app.post('/api/campaign', async (req, res) => {
  const siteId = typeof req.body?.siteId === 'string' ? req.body.siteId : '';
  const startDate = typeof req.body?.startDate === 'string' ? req.body.startDate : '';
  const sols = Number(req.body?.sols);
  const runs = Number(req.body?.runs ?? 50);
  const seed = Number(req.body?.seed ?? 2000);
  const iteration = Number(req.body?.iteration ?? 0);
  if (!SITE_IDS.has(siteId as SiteId)) return res.status(400).json({ error: 'siteId must be jezero or oxia' });
  if (!startDate) return res.status(400).json({ error: 'startDate is required' });
  if (!Number.isInteger(sols)) return res.status(400).json({ error: 'sols must be an integer' });
  if (!Number.isInteger(runs) || runs < 1 || runs > 200) return res.status(400).json({ error: 'runs must be 1–200' });
  if (!Number.isInteger(seed) || seed < 0) return res.status(400).json({ error: 'seed must be a non-negative integer' });
  if (!Number.isInteger(iteration) || iteration < 0) return res.status(400).json({ error: 'iteration must be a non-negative integer' });

  let context;
  try {
    context = loadMissionContext({ siteId: siteId as SiteId, startDate, sols }, HORIZONS_CSV);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }

  try {
    const report = await runCampaignBatchParallel(context, { runs, baseSeed: seed, iteration });
    try {
      await persistCampaign(report);
      console.log(
        `campaign: ${report.contextId} ${runs} runs in ${report.elapsedMs.toFixed(0)} ms (${report.runsPerMin.toFixed(0)} sols/min)`,
      );
      res.json({ report, persisted: true });
    } catch (err) {
      const persistError = (err as Error).message;
      console.warn(`campaign: computed ${report.contextId} but persist failed: ${persistError}`);
      res.json({ report, persisted: false, persistError });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

app.post('/api/reconstruct', async (req, res) => {
  const parsed = sceneSchema.safeParse(req.body?.scene);
  if (!parsed.success) return res.status(400).json({ error: 'scene is required' });
  const variant: SceneVariant = req.body?.variant === 'frame' ? 'frame' : 'reconstruction';
  const result = await reconstructScene(parsed.data, process.env.XAI_API_KEY, XAI_IMAGE_MODEL, variant);
  console.log(
    `reconstruct (${variant}): ${result.source}` +
      (result.ms !== undefined ? ` in ${(result.ms / 1000).toFixed(1)} s` : '') +
      (result.reason ? ` (${result.reason})` : ''),
  );
  res.json(result);
});

app.get('/api/reconstructions/:id', (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).end();
  const file = path.join(RECON_DIR, `${id}.jpg`);
  if (!existsSync(file) || !cachedReconstruction(id)) return res.status(404).end();
  res.type('image/jpeg').send(readFileSync(file));
});

app.post('/api/transcribe', async (req, res) => {
  const audioB64 = typeof req.body?.audio === 'string' ? req.body.audio : '';
  const mime = typeof req.body?.mime === 'string' ? req.body.mime : 'audio/webm';
  if (!audioB64) return res.status(400).json({ error: 'audio is required' });
  let buf: Buffer;
  try {
    buf = Buffer.from(audioB64, 'base64');
  } catch {
    return res.status(400).json({ error: 'audio must be base64' });
  }
  const result = await transcribe(buf, mime, process.env.ELEVENLABS_API_KEY);
  console.log(
    `transcribe: ${result.source}` +
      (result.ms !== undefined ? ` in ${(result.ms / 1000).toFixed(1)} s` : '') +
      (result.reason ? ` (${result.reason})` : ''),
  );
  res.json(result);
});

app.post('/api/speak', async (req, res) => {
  const role = req.body?.role === 'rover' ? 'rover' : req.body?.role === 'ground' ? 'ground' : null;
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!role) return res.status(400).json({ error: 'role must be ground or rover' });
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  const result = await synthesize(role, text, process.env.ELEVENLABS_API_KEY);
  console.log(
    `speak (${role}): ${result.source}` +
      (result.ms !== undefined ? ` in ${(result.ms / 1000).toFixed(1)} s` : '') +
      (result.reason ? ` (${result.reason})` : ''),
  );
  res.json(result);
});

app.get('/api/voice/:id', (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).end();
  const buf = cachedVoice(id) ? readVoiceFile(id) : null;
  if (!buf) return res.status(404).end();
  res.type('audio/mpeg').send(buf);
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  for (const [name, loaded] of Object.entries(keys)) {
    console.log(`  ${name} key: ${loaded ? 'loaded' : 'MISSING'}`);
  }
});
