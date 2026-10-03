import type { ModelCall } from '../shared/compiler';

const XAI_URL = 'https://api.x.ai/v1/responses';
const TIMEOUT_MS = 60_000;

interface ResponsesOutput {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string } | string;
}

/** Grok via the xAI Responses API with a strict JSON schema on the output. */
export function grokModelCall(apiKey: string, model: string, effort: string): ModelCall {
  return async (messages, schema) => {
    const res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        input: messages,
        reasoning: { effort },
        store: false,
        text: { format: { type: 'json_schema', name: 'contingency_plan', schema, strict: true } },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as ResponsesOutput & { code?: string };
    if (!res.ok) {
      const detail = typeof body.error === 'string' ? body.error : body.error?.message;
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const message = body.output?.find((o) => o.type === 'message');
    const text = message?.content?.find((c) => c.type === 'output_text')?.text;
    if (!text) throw new Error('no output text in response');
    return text;
  };
}
