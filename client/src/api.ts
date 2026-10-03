import type { CompileResult } from '../../shared/compiler';

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
