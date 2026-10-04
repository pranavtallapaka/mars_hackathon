import type { ModelCall } from '../shared/compiler';
import type { ProposeFn, ProposeInput, ProposeResult } from '../client/src/sim/agent';
import { localPropose } from '../client/src/sim/agent';
import { validateEnvelope, type Envelope } from '../shared/envelope/schema';

const XAI_URL = 'https://api.x.ai/v1/responses';
const TIMEOUT_MS = 60_000;
const VISION_TIMEOUT_MS = 120_000;

interface ResponsesOutput {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string } | string;
}

const limitsBlock = {
  type: 'object',
  additionalProperties: false,
  properties: {
    batteryFloorPct: { type: 'number', minimum: 20, maximum: 55 },
    noGoZones: { type: 'array', items: { type: 'string' } },
    irreversibleNeedsApproval: { type: 'boolean' },
  },
  required: ['batteryFloorPct', 'noGoZones', 'irreversibleNeedsApproval'],
};

const escalateWhenBlock = {
  type: 'array',
  items: { type: 'string', pattern: '^(no_branch_matches|confidence_below:(0(\\.\\d+)?|1(\\.0+)?))$' },
};

function envelopeAdjustSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['start', 'widen', 'tighten'] },
      change: { type: 'string' },
      defaults: {
        type: 'object',
        additionalProperties: false,
        properties: { limits: limitsBlock, escalateWhen: escalateWhenBlock },
        required: ['limits', 'escalateWhen'],
      },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            terrain: { type: 'string', enum: ['flat', 'sloped', 'rough'] },
            comm: { type: 'string', enum: ['normal', 'long_gap', 'conjunction'] },
            limits: limitsBlock,
            escalateWhen: escalateWhenBlock,
          },
          required: ['terrain', 'comm', 'limits', 'escalateWhen'],
        },
      },
    },
    required: ['action', 'change', 'defaults', 'rules'],
  };
}

/** Grok via the xAI Responses API with a strict JSON schema on the output. */
export function grokModelCall(apiKey: string, model: string, effort: string, schemaName = 'contingency_plan'): ModelCall {
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
        text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
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

export async function grokVisionJson(opts: {
  apiKey: string;
  model: string;
  effort: string;
  prompt: string;
  imageBase64: string;
  mime: string;
  schema: object;
  schemaName: string;
}): Promise<string> {
  const res = await fetch(XAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    body: JSON.stringify({
      model: opts.model,
      input: [
        {
          role: 'system',
          content: 'Return structured JSON only. No prose, no markdown.',
        },
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: `data:${opts.mime};base64,${opts.imageBase64}`, detail: 'high' },
            { type: 'input_text', text: opts.prompt },
          ],
        },
      ],
      reasoning: { effort: opts.effort },
      store: false,
      text: { format: { type: 'json_schema', name: opts.schemaName, schema: opts.schema, strict: true } },
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
}

function proposePrompt(input: ProposeInput): string {
  const last = input.lastScore;
  return [
    `Site: ${input.ctx.site.label}. Sols: ${input.ctx.concept.sols}. Start: ${input.ctx.concept.startDate}.`,
    `Intent: ${input.intent}. Next version: ${input.version}.`,
    input.current ? `Current envelope: ${JSON.stringify(input.current)}` : 'No current envelope. Start from a conservative Jezero/Oxia envelope.',
    last
      ? `Last campaign: accepted=${last.accepted} score=${last.score} unsafe=${last.unsafe} failures=${JSON.stringify(last.failures.slice(0, 8))}`
      : 'No campaign yet.',
    'Return defaults + a full 3×3 rule grid. Keep sand-1, approval true, battery floor ≥ 20. One sentence in change that names what moved and why.',
  ].join('\n');
}

/** Grok proposes the next envelope; invalid output falls back to the local tuner. */
export function grokEnvelopePropose(apiKey: string, model: string, effort: string): ProposeFn {
  const call = grokModelCall(apiKey, model, effort, 'autonomy_envelope');
  return async (input: ProposeInput): Promise<ProposeResult> => {
    try {
      const raw = await call(
        [
          {
            role: 'system',
            content:
              'You are the autonomy envelope agent. Host tools: load_mission_context, propose_envelope, run_campaign, get_failures, validate_envelope. You only output the next envelope. Maximize round trips saved vs baseline, subject to zero unsafe outcomes (hazard/no-go, battery floor, irreversible without approval, stuck). Never say certify. This is a simplified sim.',
          },
          { role: 'user', content: proposePrompt(input) },
        ],
        envelopeAdjustSchema(),
      );
      const parsed = JSON.parse(raw) as {
        action?: string;
        change?: string;
        defaults?: Envelope['defaults'];
        rules?: Envelope['rules'];
      };
      const envelope: Envelope = {
        envelopeId: input.current?.envelopeId ?? `env-agent-${input.ctx.concept.siteId}`,
        version: input.version,
        note: parsed.change ?? input.current?.note,
        defaults: parsed.defaults ?? input.current?.defaults ?? localPropose(input).envelope.defaults,
        rules: parsed.rules ?? input.current?.rules ?? localPropose(input).envelope.rules,
      };
      const checked = validateEnvelope(envelope);
      if (!checked.ok) return localPropose(input);
      const action = parsed.action === 'tighten' || parsed.action === 'widen' ? parsed.action : 'propose_envelope';
      return {
        envelope: checked.envelope,
        change: parsed.change || `Grok ${action} to v${envelope.version}.`,
        action,
        source: 'grok',
      };
    } catch {
      return localPropose(input);
    }
  };
}
