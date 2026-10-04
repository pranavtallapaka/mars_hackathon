import { z } from 'zod';
import { MARS_DEMO_BRIEFING, type FlightRules } from '../missions/mars-demo';
import { formatIssues, type Plan } from '../plan';
import type { CommState, TerrainSummary } from './types';

const ESCALATE_WHEN = /^(no_branch_matches|confidence_below:(0(\.\d+)?|1(\.0+)?))$/;

export const TERRAIN_CLASSES = ['flat', 'sloped', 'rough'] as const;
export type TerrainClass = (typeof TERRAIN_CLASSES)[number];

const limitsSchema = z.object({
  batteryFloorPct: z.number().min(0).max(100),
  noGoZones: z.array(z.string()),
  irreversibleNeedsApproval: z.boolean(),
});

const escalateWhenSchema = z.array(z.string().regex(ESCALATE_WHEN));

const ruleSchema = z.object({
  terrain: z.enum(TERRAIN_CLASSES),
  comm: z.enum(['normal', 'long_gap', 'conjunction']),
  limits: limitsSchema,
  escalateWhen: escalateWhenSchema,
});

/** Autonomy envelope: plan limits and escalation rules keyed by terrain class × comm state. */
export const envelopeSchema = z
  .object({
    envelopeId: z.string().min(1),
    version: z.number().int().positive(),
    note: z.string().optional(),
    defaults: z.object({
      limits: limitsSchema,
      escalateWhen: escalateWhenSchema,
    }),
    rules: z.array(ruleSchema),
  })
  .superRefine((env, ctx) => {
    const seen = new Set<string>();
    env.rules.forEach((rule, i) => {
      const key = `${rule.terrain}:${rule.comm}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: `duplicate rule ${key}`, path: ['rules', i] });
      }
      seen.add(key);
    });
  });

export type Envelope = z.output<typeof envelopeSchema>;
export type EnvelopeRule = z.output<typeof ruleSchema>;
export type EnvelopeLimits = z.output<typeof limitsSchema>;

export interface EnvelopeKey {
  terrain: TerrainClass;
  comm: CommState;
}

/** Slope p90 and rock fraction from the site terrain summary → one of three classes. */
export function classifyTerrain(terrain: TerrainSummary): TerrainClass {
  const slope = terrain.slopeP90Deg ?? 0;
  const rock = terrain.rockFrac ?? 0;
  if (slope >= 20 || rock >= 0.25) return 'rough';
  if (slope >= 8 || rock >= 0.12) return 'sloped';
  return 'flat';
}

export function lookupEnvelopeRule(envelope: Envelope, key: EnvelopeKey): Pick<EnvelopeRule, 'limits' | 'escalateWhen'> {
  return envelope.rules.find((r) => r.terrain === key.terrain && r.comm === key.comm) ?? envelope.defaults;
}

/** Overlay the matching cell onto a plan so the executor can load it as-is. */
export function applyEnvelope(plan: Plan, envelope: Envelope, key: EnvelopeKey): Plan {
  const rule = lookupEnvelopeRule(envelope, key);
  return {
    ...plan,
    limits: { ...rule.limits, noGoZones: [...rule.limits.noGoZones] },
    escalateWhen: [...rule.escalateWhen],
  };
}

export function parseEnvelope(input: unknown): Envelope {
  return envelopeSchema.parse(input);
}

/** Schema plus the same flight-rule floor the plan validator uses. */
export function validateEnvelope(
  input: unknown,
  rules: FlightRules = MARS_DEMO_BRIEFING.flightRules,
): { ok: true; envelope: Envelope } | { ok: false; errors: string[] } {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };

  const errors: string[] = [];
  const cells: { path: string; limits: EnvelopeLimits }[] = [
    { path: 'defaults.limits', limits: parsed.data.defaults.limits },
    ...parsed.data.rules.map((r, i) => ({ path: `rules.${i}.limits`, limits: r.limits })),
  ];
  for (const cell of cells) {
    if (cell.limits.batteryFloorPct < rules.minBatteryFloorPct) {
      errors.push(
        `${cell.path}: battery floor ${cell.limits.batteryFloorPct}% is below the flight-rule minimum of ${rules.minBatteryFloorPct}%.`,
      );
    }
    for (const zone of rules.noGoZones.filter((z) => !cell.limits.noGoZones.includes(z))) {
      errors.push(`${cell.path}: drops flight-rule no-go zone ${zone}.`);
    }
    if (!cell.limits.irreversibleNeedsApproval) {
      errors.push(`${cell.path}: turns off approval for irreversible actions.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, envelope: parsed.data };
}

function cell(terrain: TerrainClass, comm: CommState, batteryFloorPct: number, confidence: number): EnvelopeRule {
  return {
    terrain,
    comm,
    limits: {
      batteryFloorPct,
      noGoZones: ['sand-1'],
      irreversibleNeedsApproval: true,
    },
    escalateWhen: ['no_branch_matches', `confidence_below:${confidence}`],
  };
}

/** Conservative starting envelope for Jezero / Oxia. Not a certification. */
export const HANDWRITTEN_ENVELOPE: Envelope = envelopeSchema.parse({
  envelopeId: 'env-hand-2028',
  version: 1,
  note: 'Hand-written starting envelope. Not a certification.',
  defaults: {
    limits: { batteryFloorPct: 30, noGoZones: ['sand-1'], irreversibleNeedsApproval: true },
    escalateWhen: ['no_branch_matches', 'confidence_below:0.6'],
  },
  rules: [
    cell('flat', 'normal', 30, 0.6),
    cell('sloped', 'normal', 30, 0.6),
    cell('rough', 'normal', 35, 0.7),
    cell('flat', 'long_gap', 32, 0.65),
    cell('sloped', 'long_gap', 32, 0.65),
    cell('rough', 'long_gap', 38, 0.75),
    cell('flat', 'conjunction', 40, 0.8),
    cell('sloped', 'conjunction', 40, 0.8),
    cell('rough', 'conjunction', 42, 0.85),
  ],
});
