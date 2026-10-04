/**
 * One-off: generate Mars backdrop / texture candidates with Grok Imagine.
 * Keys stay in .env. The app only loads the saved files — this script is the
 * only caller. Dry-run (default) prints the cost and exits; pass --confirm to spend.
 *
 *   npx tsx scripts/generate-mars-assets.ts
 *   npx tsx scripts/generate-mars-assets.ts --confirm
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
  id: 'sky' | 'regolith' | 'rocks' | 'dust';
  count: number;
  aspectRatio: '16:9' | '1:1';
  prompt: string;
}

const CATEGORIES: Category[] = [
  {
    id: 'sky',
    count: 4,
    aspectRatio: '16:9',
    prompt:
      'Wide photoreal Mars horizon backdrop, butterscotch dusty sky, pale orange-pink atmospheric haze near the horizon, low sun, empty rocky desert, no rover, no spacecraft, no people, no text, no watermark, cinematic landscape photograph.',
  },
  {
    id: 'regolith',
    count: 4,
    aspectRatio: '1:1',
    prompt:
      'Seamless tileable top-down photograph of fine Mars regolith, rust-orange dust and sand grains, evenly lit studio lighting, no shadows, no horizon, no large rocks, no rover, no people, no text, repeating texture.',
  },
  {
    id: 'rocks',
    count: 4,
    aspectRatio: '1:1',
    prompt:
      'Seamless tileable top-down photograph of Mars rocks and pebbles on red soil, evenly lit studio lighting, no cast shadows, no horizon, no rover, no people, no text, repeating texture.',
  },
  {
    id: 'dust',
    count: 2,
    aspectRatio: '1:1',
    prompt:
      'Soft Mars dust overlay texture, pale orange haze and fine airborne particles, evenly lit, no horizon, no rocks, no rover, no people, no text, usable as a translucent overlay.',
  },
];

const TOTAL_IMAGES = CATEGORIES.reduce((n, c) => n + c.count, 0);
const COST_USD = TOTAL_IMAGES * PRICE_PER_IMAGE;

interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string } | string;
}

interface ManifestEntry {
  file: string;
  category: Category['id'];
  prompt: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  generatedAt: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function logEstimate(): void {
  console.log('Grok Imagine asset generation (dry-run until --confirm)');
  console.log(`  model:      ${MODEL}`);
  console.log(`  resolution: ${RESOLUTION}`);
  console.log(`  price:      $${PRICE_PER_IMAGE.toFixed(2)} / image (text input free)`);
  for (const c of CATEGORIES) {
    console.log(`  ${c.id.padEnd(9)} ${c.count} × ${c.aspectRatio}`);
  }
  console.log(`  total:      ${TOTAL_IMAGES} images  →  ~$${COST_USD.toFixed(2)}`);
  console.log(`  output:     ${OUT_DIR}`);
}

async function generate(category: Category, apiKey: string): Promise<ManifestEntry[]> {
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
    throw new Error(`${category.id}: expected ${category.count} images, got ${images.length}`);
  }

  const dir = path.join(OUT_DIR, category.id);
  mkdirSync(dir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const entries: ManifestEntry[] = [];

  images.forEach((image, i) => {
    if (!image.b64_json) throw new Error(`${category.id}: image ${i + 1} had no b64_json`);
    const file = path.posix.join(category.id, `candidate-${pad(i + 1)}.png`);
    writeFileSync(path.join(OUT_DIR, file), Buffer.from(image.b64_json, 'base64'));
    entries.push({
      file,
      category: category.id,
      prompt: category.prompt,
      model: MODEL,
      resolution: RESOLUTION,
      aspectRatio: category.aspectRatio,
      generatedAt,
    });
    console.log(`  wrote ${file}`);
  });
  return entries;
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
  const assets: ManifestEntry[] = [];
  for (const category of CATEGORIES) {
    console.log(`\ngenerating ${category.id} (${category.count})…`);
    assets.push(...(await generate(category, apiKey)));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    resolution: RESOLUTION,
    pricePerImageUsd: PRICE_PER_IMAGE,
    estimatedCostUsd: COST_USD,
    note: 'Candidates only. After you pick, rename the chosen files to sky.png, regolith.png, rocks.png, dust.png in this folder.',
    assets,
  };
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nwrote ${path.join(OUT_DIR, 'manifest.json')}`);
  console.log('Pick one candidate per category, then rename to sky.png, regolith.png, rocks.png, dust.png.');
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
