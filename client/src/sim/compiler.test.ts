import { describe, expect, it } from 'vitest';
import { compilePlan, planJsonSchema, type ChatMessage, type ModelCall } from '../../../shared/compiler';
import { CACHED_DEMO_PLAN, DEMO_INTENT, MARS_DEMO_BRIEFING } from '../../../shared/missions/mars-demo';
import { MARS_SURFACE } from '../../../shared/scenario';
import { Sim } from './sim';

// What a model might plausibly return: different ids and layout from the cached plan, same shape.
const MODEL_PLAN = {
  limits: { batteryFloorPct: 30, noGoZones: ['sand-1'], irreversibleNeedsApproval: true },
  steps: [
    {
      id: 's1',
      action: 'drive_to',
      args: { target: 'wp-A' },
      branches: [
        { if: 'path_blocked', then: 'goto:s1a' },
        { if: 'battery_below_floor', then: 'abort' },
      ],
    },
    { id: 's1a', action: 'drive_to', args: { target: 'wp-A-alt' }, branches: [] },
    { id: 's2', action: 'drive_to', args: { target: 'outcrop-1' }, branches: [{ if: 'battery_below_floor', then: 'abort' }] },
    { id: 's3', action: 'image', args: { target: 'outcrop-1' }, branches: [{ if: 'confidence_below', then: 'escalate' }] },
    {
      id: 's4',
      action: 'drill',
      args: { site: 'outcrop-1', depthCm: 5 },
      irreversible: true,
      approved: true,
      branches: [{ if: 'rock_too_hard', then: 'escalate' }],
    },
    { id: 's5', action: 'collect_sample', args: { site: 'outcrop-1' }, irreversible: true, approved: true, branches: [] },
  ],
  escalateWhen: ['no_branch_matches', 'confidence_below:0.6'],
  abort: { behavior: 'stop_and_return', to: 'last_safe_waypoint' },
  whileWaiting: ['image_surroundings'],
};

function scripted(...replies: (string | Error)[]): ModelCall & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const fn = async (messages: ChatMessage[]) => {
    calls.push([...messages]);
    const reply = replies[calls.length - 1];
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return Object.assign(fn, { calls });
}

const compile = (callModel: ModelCall | null) =>
  compilePlan({
    intent: DEMO_INTENT,
    scenario: MARS_SURFACE,
    briefing: MARS_DEMO_BRIEFING,
    cachedPlan: CACHED_DEMO_PLAN,
    callModel,
    model: 'test-model',
  });

describe('Batch 4: ground compiler', () => {
  it('done when: the demo intent compiles to a valid plan that runs end to end in both panes', async () => {
    const result = await compile(scripted(JSON.stringify(MODEL_PLAN)));
    expect(result.source).toBe('grok');
    expect(result.plan.intent).toBe(DEMO_INTENT);
    expect(result.plan.planId).toBe('p-001');

    const ours = new Sim({ mode: 'contingency', autoOperator: true });
    const base = new Sim({ mode: 'baseline', autoOperator: true });
    expect(ours.start(result.plan).ok).toBe(true);
    expect(base.start(result.plan).ok).toBe(true);
    for (let t = 1; t <= 400; t++) {
      ours.stepTo(t);
      base.stepTo(t);
    }
    expect(ours.metrics.complete).toBe(true);
    expect(base.metrics.complete).toBe(true);
    expect(ours.roverLog.some((l) => l.text.includes('goto:s1a'))).toBe(true);
    expect(ours.metrics.roundTrips).toBeLessThan(base.metrics.roundTrips);
  });

  it('retries once with the validation errors, then succeeds', async () => {
    const bad = { ...MODEL_PLAN, steps: [{ id: 's1', action: 'drive_to', args: { target: 'crater-9' }, branches: [] }] };
    const model = scripted(JSON.stringify(bad), JSON.stringify(MODEL_PLAN));
    const result = await compile(model);
    expect(result.source).toBe('grok_retry');
    expect(result.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(model.calls[1].at(-1)!.content).toContain('known waypoint or target');
  });

  it('falls back to the cached plan after two invalid plans', async () => {
    const result = await compile(scripted('not json', JSON.stringify({ steps: [] })));
    expect(result.source).toBe('cached');
    expect(result.attempts).toHaveLength(2);
    expect(result.plan.steps.map((s) => s.id)).toEqual(['s1', 's1b', 's2', 's3', 's4', 's5']);
  });

  it('falls back immediately when Grok is unreachable or there is no key', async () => {
    const failed = await compile(scripted(new Error('HTTP 401: Incorrect API key')));
    expect(failed.source).toBe('cached');
    expect(failed.attempts[0].errors[0]).toContain('401');
    expect((await compile(null)).fallbackReason).toContain('no Grok API key');
  });

  it("constrains the model's output to this scenario's enums and this map's ids", () => {
    const text = JSON.stringify(planJsonSchema(MARS_SURFACE, MARS_DEMO_BRIEFING));
    for (const id of [...MARS_SURFACE.actions, ...MARS_SURFACE.conditions, 'wp-A-alt', 'outcrop-2', 'sand-1']) {
      expect(text).toContain(`"${id}"`);
    }
  });
});
