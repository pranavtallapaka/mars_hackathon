import type { EscalationPacket, Plan, PlanStep } from '../../../../shared/plan';
import { contingencySteps } from '../executor';
import { parseOptionLabel } from './options';

/** Steps the executor would run starting at `fromId` if nothing went wrong: contingency steps are skipped. */
export function nominalFlow(plan: Plan, fromId?: string): PlanStep[] {
  const contingency = contingencySteps(plan);
  const start = fromId === undefined ? 0 : plan.steps.findIndex((s) => s.id === fromId);
  if (start < 0) return [];
  return plan.steps.filter((s, i) => i === start || (i > start && !contingency.has(s.id)));
}

/** A conventional sequence: same steps and limits, no branches, nothing to do while waiting. */
export function toConventional(plan: Plan, steps: PlanStep[], planId: string, version: number): Plan {
  return {
    ...plan,
    planId,
    version,
    steps: steps.map((s) => ({ ...s, args: { ...s.args }, branches: [] })),
    escalateWhen: [],
    whileWaiting: [],
  };
}

function siteSteps(site: string, depthCm: number, version: number): PlanStep[] {
  const id = (n: number) => `v${version}s${n}`;
  return [
    { id: id(1), action: 'drive_to', args: { target: site }, branches: [{ if: 'battery_below_floor', then: 'abort' }] },
    { id: id(2), action: 'image', args: { target: site }, branches: [{ if: 'target_not_found', then: 'escalate' }] },
    {
      id: id(3),
      action: 'drill',
      args: { site, depthCm },
      irreversible: true,
      approved: true,
      branches: [{ if: 'rock_too_hard', then: 'escalate' }],
    },
    { id: id(4), action: 'collect_sample', args: { site }, irreversible: true, approved: true, branches: [] },
  ];
}

/**
 * Ground-side plan amendment for the operator's choice. Returns null for "hold for a revised plan",
 * which needs a new plan rather than an amendment.
 */
export function amendPlan(plan: Plan, packet: EscalationPacket, optionId: string): Plan | null {
  const option = packet.options.find((o) => o.id === optionId);
  const intent = option ? parseOptionLabel(option.label) : null;
  if (!intent) return null;

  const version = plan.version + 1;
  const id = (n: number) => `v${version}s${n}`;
  const step = plan.steps.find((s) => s.id === packet.stepId);
  const site = String(step?.args.site ?? step?.args.target ?? '');
  const depthCm = Number(step?.args.depthCm ?? 5);
  const rest = (fromId: string) => nominalFlow(plan, fromId).slice(1);

  let steps: PlanStep[];
  switch (intent.kind) {
    case 'alt_site':
      steps = siteSteps(intent.site, depthCm, version);
      break;
    case 'surface_sample':
      steps = [{ id: id(1), action: 'collect_sample', args: { site }, irreversible: true, approved: true, branches: [] }];
      break;
    case 'retry_drill':
      steps = [
        { id: id(1), action: 'drill', args: { site, depthCm, force: 'high' }, irreversible: true, approved: true, branches: [] },
        { id: id(2), action: 'collect_sample', args: { site }, irreversible: true, approved: true, branches: [] },
      ];
      break;
    case 'approve_step': {
      const target = plan.steps.find((s) => s.id === intent.stepId);
      if (!target) return null;
      steps = [{ ...target, approved: true }, ...rest(intent.stepId)];
      break;
    }
    case 'skip_step':
      steps = rest(intent.stepId);
      break;
    case 'return_to':
      steps = [{ id: id(1), action: 'drive_to', args: { target: intent.waypoint }, branches: [] }];
      break;
    case 'recharge':
      steps = [{ id: id(1), action: 'hold', args: { minutes: 60 }, branches: [] }];
      break;
    case 'hold_for_plan':
      return null;
  }
  if (!steps.length) return null;

  return { ...plan, version, intent: `${plan.intent} (amended: ${option!.label})`, steps };
}
