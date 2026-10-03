import type { CompileResult } from '../../shared/compiler';
import type { Scene } from '../../shared/plan';
import type { ReconstructionResult, SceneVariant } from '../../shared/scene';

export async function compileIntent(intent: string, useCached = false): Promise<CompileResult> {
  const res = await fetch('/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, useCached }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `compile failed (HTTP ${res.status})`);
  return body as CompileResult;
}

export async function reconstructScene(scene: Scene, variant: SceneVariant = 'reconstruction'): Promise<ReconstructionResult> {
  const res = await fetch('/api/reconstruct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, variant }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `reconstruct failed (HTTP ${res.status})`);
  return body as ReconstructionResult;
}
