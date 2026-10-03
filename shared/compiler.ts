import type { MissionBriefing } from './missions/mars-demo';
import { createPlanSchema, formatIssues, type Plan } from './plan';
import type { ScenarioDef } from './scenario';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** One model call constrained to `schema`; returns the raw text. Injected so tests and the server differ only here. */
export type ModelCall = (messages: ChatMessage[], schema: object) => Promise<string>;

export type CompileSource = 'grok' | 'grok_retry' | 'cached';

export interface CompileAttempt {
  ok: boolean;
  errors: string[];
  ms: number;
}

export interface CompileResult {
  plan: Plan;
  source: CompileSource;
  attempts: CompileAttempt[];
  /** Why the cached plan was used, when it was. */
  fallbackReason?: string;
  model?: string;
}

export interface CompileRequest {
  intent: string;
  scenario: ScenarioDef;
  briefing: MissionBriefing;
  cachedPlan: unknown;
  callModel: ModelCall | null;
  model?: string;
  planId?: string;
}

const MAX_ATTEMPTS = 2;

/**
 * JSON schema Grok must fill. It mirrors the plan schema but is tighter where the model needs help:
 * enums for actions, conditions and map ids. planId, version and intent are set by the ground, not the model.
 */
export function planJsonSchema(scenario: ScenarioDef, briefing: MissionBriefing): object {
  const featureIds = briefing.features.map((f) => f.id);
  const targetIds = briefing.features.filter((f) => f.kind === 'target').map((f) => f.id);
  return {
    type: 'object',
    properties: {
      limits: {
        type: 'object',
        properties: {
          batteryFloorPct: { type: 'number', minimum: 0, maximum: 100 },
          noGoZones: { type: 'array', items: { type: 'string', enum: briefing.noGoZones.map((z) => z.id) } },
          irreversibleNeedsApproval: { type: 'boolean' },
        },
        required: ['batteryFloorPct', 'noGoZones', 'irreversibleNeedsApproval'],
      },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: '[A-Za-z0-9_-]+' },
            action: { type: 'string', enum: [...scenario.actions] },
            args: {
              type: 'object',
              properties: {
                target: { type: 'string', enum: featureIds },
                site: { type: 'string', enum: targetIds },
                depthCm: { type: 'number', minimum: 1, maximum: 20 },
                minutes: { type: 'number', minimum: 1, maximum: 120 },
              },
            },
            irreversible: { type: 'boolean' },
            approved: { type: 'boolean' },
            branches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  if: { type: 'string', enum: [...scenario.conditions] },
                  then: { type: 'string', pattern: 'goto:[A-Za-z0-9_-]+|skip|escalate|abort' },
                },
                required: ['if', 'then'],
              },
            },
          },
          required: ['id', 'action', 'args', 'branches'],
        },
      },
      escalateWhen: { type: 'array', items: { type: 'string', pattern: 'no_branch_matches|confidence_below:0\\.\\d+' } },
      abort: {
        type: 'object',
        properties: {
          behavior: { type: 'string', const: 'stop_and_return' },
          to: { type: 'string' },
        },
        required: ['behavior', 'to'],
      },
      whileWaiting: { type: 'array', items: { type: 'string', enum: [...scenario.whileWaitingTasks] } },
    },
    required: ['limits', 'steps', 'escalateWhen', 'abort', 'whileWaiting'],
  };
}

export function compilerSystemPrompt(scenario: ScenarioDef, briefing: MissionBriefing): string {
  const features = briefing.features.map((f) => `- ${f.id} (${f.kind}): ${f.label} at (${f.pos.x}, ${f.pos.y})`);
  const zones = briefing.noGoZones.map(
    (z) => `- ${z.id}: ${z.label}, cells x ${z.rect.x}..${z.rect.x + z.rect.w - 1}, y ${z.rect.y}..${z.rect.y + z.rect.h - 1}`,
  );
  return [
    'You are the ground compiler for a Mars rover. Mission control states an intent; you compile it into one contingency plan that the rover runs on its own across a 3 to 22 minute light delay.',
    'Every call home costs a full round trip, so anticipate the likely surprises with branches. The rover must never improvise: every action is a step or a branch.',
    '',
    'Map (grid, x east, y south; y = 0 is north):',
    `- rover starts at (${briefing.roverStart.x}, ${briefing.roverStart.y})`,
    ...features,
    'No-go zones:',
    ...zones,
    'Notes from orbital imagery:',
    ...briefing.notes.map((n) => `- ${n}`),
    '',
    'Actions:',
    ...briefing.actionGuide.map((a) => `- ${a}`),
    '',
    `Conditions a branch can test: ${scenario.conditions.join(', ')}.`,
    'Branch outcomes: goto:<stepId>, skip, escalate, abort.',
    '',
    'Execution rules:',
    '- Steps run in list order. A step reached only by a goto branch is a contingency step: normal flow skips it, and after it finishes, flow resumes at the next regular step. Put a contingency step right after the step whose branch jumps to it.',
    '- If no branch matches a condition, the rover escalates and holds. Escalate on purpose only where a human decision is genuinely needed.',
    `- Irreversible actions (${scenario.irreversibleActions.join(', ')}) need irreversible: true. Set approved: true only when the intent clearly asks for that action at that target.`,
    '- Put every no-go zone the intent asks to avoid in limits.noGoZones. Set limits.irreversibleNeedsApproval to true.',
    '- escalateWhen should include "no_branch_matches" and a confidence threshold such as "confidence_below:0.6".',
    '- abort: { behavior: "stop_and_return", to: "last_safe_waypoint" }.',
    `- whileWaiting: safe tasks while holding (${scenario.whileWaitingTasks.join(', ')}).`,
    '- Step ids: s1, s2, ... with a letter suffix for contingency steps (s1b).',
    '- Keep it minimal: only the steps the intent needs.',
  ].join('\n');
}

/** Checks the schema can't express: ids that must exist on this map and args each action needs. */
export function missionIssues(plan: Plan, scenario: ScenarioDef, briefing: MissionBriefing): string[] {
  const issues: string[] = [];
  const features = new Set(briefing.features.map((f) => f.id));
  const targets = new Set(briefing.features.filter((f) => f.kind === 'target').map((f) => f.id));
  const zones = new Set(briefing.noGoZones.map((z) => z.id));
  const irreversible = new Set<string>(scenario.irreversibleActions);

  for (const z of plan.limits.noGoZones) if (!zones.has(z)) issues.push(`limits.noGoZones: unknown zone ${z}`);
  plan.steps.forEach((s, i) => {
    const at = `steps.${i} (${s.id})`;
    const { target, site } = s.args;
    if ((s.action === 'drive_to' || s.action === 'image') && !features.has(String(target))) {
      issues.push(`${at}: ${s.action} needs args.target to be a known waypoint or target`);
    }
    if ((s.action === 'drill' || s.action === 'collect_sample') && !targets.has(String(site))) {
      issues.push(`${at}: ${s.action} needs args.site to be a known science target`);
    }
    if (irreversible.has(s.action) && !s.irreversible) issues.push(`${at}: ${s.action} is irreversible and must say so`);
  });
  return issues;
}

function parsePlan(raw: string, req: CompileRequest): { plan: Plan | null; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { plan: null, errors: ['response was not valid JSON'] };
  }
  const withIds = { ...(json as object), planId: req.planId ?? 'p-001', version: 1, intent: req.intent };
  const parsed = createPlanSchema(req.scenario).safeParse(withIds);
  if (!parsed.success) return { plan: null, errors: formatIssues(parsed.error) };
  const issues = missionIssues(parsed.data, req.scenario, req.briefing);
  return issues.length ? { plan: null, errors: issues } : { plan: parsed.data, errors: [] };
}

/** Intent → validated plan. One retry with the errors fed back, then the cached known-good plan (Build decisions §4). */
export async function compilePlan(req: CompileRequest): Promise<CompileResult> {
  const cached = (fallbackReason: string, attempts: CompileAttempt[]): CompileResult => ({
    plan: createPlanSchema(req.scenario).parse(req.cachedPlan),
    source: 'cached',
    attempts,
    fallbackReason,
    model: req.model,
  });
  if (!req.callModel) return cached('no Grok API key on the server', []);

  const schema = planJsonSchema(req.scenario, req.briefing);
  const messages: ChatMessage[] = [
    { role: 'system', content: compilerSystemPrompt(req.scenario, req.briefing) },
    { role: 'user', content: `Intent: ${req.intent}` },
  ];
  const attempts: CompileAttempt[] = [];

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const t0 = Date.now();
    let raw: string;
    try {
      raw = await req.callModel(messages, schema);
    } catch (err) {
      attempts.push({ ok: false, errors: [`Grok call failed: ${(err as Error).message}`], ms: Date.now() - t0 });
      return cached('Grok call failed', attempts);
    }
    const { plan, errors } = parsePlan(raw, req);
    attempts.push({ ok: plan !== null, errors, ms: Date.now() - t0 });
    if (plan) return { plan, source: i === 0 ? 'grok' : 'grok_retry', attempts, model: req.model };
    messages.push(
      { role: 'assistant', content: raw },
      { role: 'user', content: `That plan failed validation:\n${errors.map((e) => `- ${e}`).join('\n')}\nReturn the corrected full plan.` },
    );
  }
  return cached(`Grok's plan failed validation after ${MAX_ATTEMPTS} attempts`, attempts);
}
