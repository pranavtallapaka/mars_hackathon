import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sceneKey, scenePrompt, type ReconstructionResult, type SceneVariant } from '../shared/scene';
import type { Scene } from '../shared/plan';

const XAI_IMAGES = 'https://api.x.ai/v1/images/generations';
const TIMEOUT_MS = 90_000;

export const RECON_DIR = path.join(process.cwd(), 'data/reconstructions');

interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string } | string;
}

function cachePath(id: string): string {
  return path.join(RECON_DIR, `${id}.jpg`);
}

export function reconstructionUrl(id: string): string {
  return `/api/reconstructions/${id}`;
}

export function cachedReconstruction(id: string): boolean {
  return existsSync(cachePath(id));
}

/** Generate, or return the on-disk cache. Keys stay on the server. */
export async function reconstructScene(
  scene: Scene,
  apiKey: string | undefined,
  model: string,
  variant: SceneVariant = 'reconstruction',
): Promise<ReconstructionResult> {
  const id = sceneKey(scene, variant);
  if (cachedReconstruction(id)) {
    return { id, url: reconstructionUrl(id), source: 'cache', model };
  }
  if (!apiKey) {
    return { id, source: 'unavailable', model, reason: 'no xAI key on the server' };
  }

  const t0 = Date.now();
  try {
    const res = await fetch(XAI_IMAGES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        prompt: scenePrompt(scene, variant),
        n: 1,
        aspect_ratio: '4:3',
        resolution: '1k',
        quality: 'low',
        response_format: 'b64_json',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as ImageResponse;
    if (!res.ok) {
      const detail = typeof body.error === 'string' ? body.error : body.error?.message;
      return { id, source: 'unavailable', model, ms: Date.now() - t0, reason: `HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) return { id, source: 'unavailable', model, ms: Date.now() - t0, reason: 'no image in response' };
    mkdirSync(RECON_DIR, { recursive: true });
    writeFileSync(cachePath(id), Buffer.from(b64, 'base64'));
    return { id, url: reconstructionUrl(id), source: 'grok', ms: Date.now() - t0, model };
  } catch (err) {
    return { id, source: 'unavailable', model, ms: Date.now() - t0, reason: (err as Error).message };
  }
}
