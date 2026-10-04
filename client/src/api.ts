import type { CompileResult } from '../../shared/compiler';
import type { Scene } from '../../shared/plan';
import type { ReconstructionResult, SceneVariant } from '../../shared/scene';
import type { SpeakResult, TranscribeResult, VoiceRole } from '../../shared/voice';

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

export async function transcribeIntent(audio: string, mime: string): Promise<TranscribeResult> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mime }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `transcribe failed (HTTP ${res.status})`);
  return body as TranscribeResult;
}

export async function speakText(role: VoiceRole, text: string): Promise<SpeakResult> {
  const res = await fetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `speak failed (HTTP ${res.status})`);
  return body as SpeakResult;
}
