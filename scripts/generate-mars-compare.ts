/**
 * One-off: photoreal plates + horizon for the flat /compare scene.
 * Keys stay in .env. Dry-run unless --confirm.
 *
 *   npx tsx scripts/generate-mars-compare.ts
 *   npx tsx scripts/generate-mars-compare.ts --confirm
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const XAI_IMAGES = 'https://api.x.ai/v1/images/generations';
const MODEL = 'grok-imagine-image';
const RESOLUTION = '1k';
const PRICE_PER_IMAGE = 0.02;
const TIMEOUT_MS = 120_000;
const OUT_DIR = path.join(ROOT, 'client/public/assets/mars');
const CONFIRMED = process.argv.includes('--confirm') || process.argv.includes('--yes');

interface Category {
  id: 'plates' | 'horizon' | 'boulder';
  count: number;
  aspectRatio: '16:9' | '1:1';
  prompt: string;
}

const CATEGORIES: Category[] = [
  {
    id: 'plates',
    count: 4,
    aspectRatio: '1:1',
    prompt:
      'Seamless tileable top-down photograph of Jezero crater surface like a Perseverance Navcam still: rust-orange flat sandstone slabs and pavement, thin dust in the cracks, small grey pebbles, even hazy butterscotch daylight, no shadows, no horizon, no hills, no rover, no spacecraft, no people, no text, no watermark, photoreal repeating texture.',
  },
  {
    id: 'horizon',
    count: 3,
    aspectRatio: '16:9',
    prompt:
      'Photoreal Mars landscape photograph like a Perseverance Navcam frame: pale butterscotch sky, empty rust-orange desert of flat sandstone slabs and a few dark boulders, low distant ridges on the horizon, soft hazy daylight, no rover, no spacecraft, no people, no text, no watermark.',
  },
  {
    id: 'boulder',
    count: 2,
    aspectRatio: '1:1',
    prompt:
      'Single dark grey Mars boulder sitting on rust-orange flat sandstone pavement, photoreal Perseverance Navcam color, isolated subject in the center, even hazy light, no rover, no people, no text, no watermark.',
  },
];

const TOTAL_IMAGES = CATEGORIES.reduce((n, c) => n + c.count, 0);
const COST_USD = TOTAL_IMAGES * PRICE_PER_IMAGE;

interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string } | string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function logEstimate(): void {
  console.log('Grok Imagine compare-scene assets (dry-run until --confirm)');
  console.log(`  model:      ${MODEL}`);
  console.log(`  resolution: ${RESOLUTION}`);
  console.log(`  price:      $${PRICE_PER_IMAGE.toFixed(2)} / image`);
  for (const c of CATEGORIES) console.log(`  ${c.id.padEnd(9)} ${c.count} × ${c.aspectRatio}`);
  console.log(`  total:      ${TOTAL_IMAGES} images  →  ~$${COST_USD.toFixed(2)}`);
}

async function generate(category: Category, apiKey: string) {
  const res = await fetch(XAI_IMAGES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      prompt: category.prompt,
      n: category.count,
      aspect_ratio: category.aspectRatio,
      resolution: RESOLUTION,
      response_format: 'b64_json',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as ImageResponse;
  if (!res.ok) {
    const detail = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(`${category.id}: HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const images = body.data ?? [];
  if (images.length < category.count) {
    throw new Error(`${category.id}: expected ${category.count}, got ${images.length}`);
  }
  const dir = path.join(OUT_DIR, category.id);
  mkdirSync(dir, { recursive: true });
  const generatedAt = new Date().toISOString();
  return images.map((image, i) => {
    if (!image.b64_json) throw new Error(`${category.id}: image ${i + 1} had no b64_json`);
    const file = path.posix.join(category.id, `candidate-${pad(i + 1)}.png`);
    writeFileSync(path.join(OUT_DIR, file), Buffer.from(image.b64_json, 'base64'));
    console.log(`  wrote ${file}`);
    return { file, category: category.id, prompt: category.prompt, generatedAt };
  });
}

async function main(): Promise<void> {
  logEstimate();
  if (!CONFIRMED) {
    console.log('\nNo API call made. Re-run with --confirm to generate.');
    return;
  }
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY is missing from .env');
  mkdirSync(OUT_DIR, { recursive: true });
  const assets = [];
  for (const category of CATEGORIES) {
    console.log(`\ngenerating ${category.id} (${category.count})…`);
    assets.push(...(await generate(category, apiKey)));
  }
  writeFileSync(
    path.join(OUT_DIR, 'compare-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: MODEL,
        estimatedCostUsd: COST_USD,
        assets,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('wrote compare-manifest.json');
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
