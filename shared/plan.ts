import { z } from 'zod';
import type { ScenarioDef } from './scenario';

const ID = /^[A-Za-z0-9_-]+$/;
const OUTCOME = /^(goto:[A-Za-z0-9_-]+|skip|escalate|abort)$/;
const ESCALATE_WHEN = /^(no_branch_matches|confidence_below:(0(\.\d+)?|1(\.0+)?))$/;

/** Plan schema (Build decisions §3) with action/condition enums taken from the scenario config. */
export function createPlanSchema(scenario: ScenarioDef) {
  const branch = z.object({
    if: z.enum(scenario.conditions),
    then: z.string().regex(OUTCOME, 'must be goto:<stepId>, skip, escalate or abort'),
  });

  const step = z.object({
    id: z.string().regex(ID),
    action: z.enum(scenario.actions),
    args: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    irreversible: z.boolean().optional(),
    approved: z.boolean().optional(),
    branches: z.array(branch).default([]),
  });

  return z
    .object({
      planId: z.string().min(1),
      version: z.number().int().positive(),
      intent: z.string(),
      limits: z.object({
        batteryFloorPct: z.number().min(0).max(100),
        noGoZones: z.array(z.string()),
        irreversibleNeedsApproval: z.boolean(),
      }),
      steps: z.array(step).min(1),
      escalateWhen: z.array(z.string().regex(ESCALATE_WHEN)).default([]),
      abort: z.object({ behavior: z.literal('stop_and_return'), to: z.string() }),
      whileWaiting: z.array(z.enum(scenario.whileWaitingTasks)).default([]),
    })
    .superRefine((plan, ctx) => {
      const ids = new Set<string>();
      plan.steps.forEach((s, i) => {
        if (ids.has(s.id)) ctx.addIssue({ code: 'custom', message: `duplicate step id ${s.id}`, path: ['steps', i, 'id'] });
        ids.add(s.id);
      });
      plan.steps.forEach((s, i) => {
        s.branches.forEach((b, j) => {
          const outcome = parseOutcome(b.then);
          if (outcome.type !== 'goto') return;
          const path = ['steps', i, 'branches', j, 'then'];
          if (!ids.has(outcome.stepId)) ctx.addIssue({ code: 'custom', message: `goto to unknown step ${outcome.stepId}`, path });
          if (outcome.stepId === s.id) ctx.addIssue({ code: 'custom', message: 'goto to itself', path });
        });
      });
    });
}

export type PlanSchema = ReturnType<typeof createPlanSchema>;
export type Plan = z.output<PlanSchema>;
export type PlanStep = Plan['steps'][number];
export type Branch = PlanStep['branches'][number];

export type Outcome =
  | { type: 'goto'; stepId: string }
  | { type: 'skip' }
  | { type: 'escalate' }
  | { type: 'abort' };

export function parseOutcome(then: string): Outcome {
  if (then.startsWith('goto:')) return { type: 'goto', stepId: then.slice(5) };
  return { type: then as 'skip' | 'escalate' | 'abort' };
}

/** Threshold from an `escalateWhen` entry like "confidence_below:0.6", if present. */
export function confidenceThreshold(plan: Plan): number | null {
  const entry = plan.escalateWhen.find((e) => e.startsWith('confidence_below:'));
  return entry ? Number(entry.split(':')[1]) : null;
}

export const sceneSchema = z.object({
  objects: z.array(z.string()),
  slopeDeg: z.number(),
  terrain: z.string(),
});

export type Scene = z.output<typeof sceneSchema>;

export const escalationPacketSchema = z
  .object({
    planId: z.string().min(1),
    stepId: z.string().min(1),
    simTime: z.number().nonnegative(),
    whatHappened: z.string().min(1),
    scene: sceneSchema,
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          risk: z.enum(['low', 'medium', 'high']),
          costMin: z.number().nonnegative(),
        }),
      )
      .min(2)
      .max(3),
    recommendation: z.string(),
  })
  .refine((p) => p.options.some((o) => o.id === p.recommendation), {
    message: 'recommendation must be one of the option ids',
    path: ['recommendation'],
  });

export type EscalationPacket = z.output<typeof escalationPacketSchema>;

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
