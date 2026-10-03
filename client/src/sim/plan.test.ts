import { describe, expect, it } from 'vitest';
import { createPlanSchema, escalationPacketSchema } from '../../../shared/plan';
import { MARS_SURFACE, type ScenarioDef } from '../../../shared/scenario';
import { DEMO_PLAN } from './mars/mission';

const marsPlan = createPlanSchema(MARS_SURFACE);

// The example plan and packet from docs/design.md, Build decisions §3.
const DOC_PLAN = {
  planId: 'p-001',
  version: 1,
  intent: 'Sample the layered outcrop NE; avoid sand; keep battery above 30%',
  limits: { batteryFloorPct: 30, noGoZones: ['sand-1'], irreversibleNeedsApproval: true },
  steps: [
    {
      id: 's1',
      action: 'drive_to',
      args: { target: 'wp-A' },
      branches: [
        { if: 'path_blocked', then: 'goto:s1b' },
        { if: 'battery_below_floor', then: 'abort' },
      ],
    },
    { id: 's1b', action: 'drive_to', args: { target: 'wp-A-alt' } },
    {
      id: 's2',
      action: 'drill',
      args: { site: 'outcrop-1' },
      irreversible: true,
      approved: true,
      branches: [{ if: 'rock_too_hard', then: 'escalate' }],
    },
  ],
  escalateWhen: ['no_branch_matches', 'confidence_below:0.6'],
  abort: { behavior: 'stop_and_return', to: 'last_safe_waypoint' },
  whileWaiting: ['image_surroundings'],
};

const DOC_PACKET = {
  planId: 'p-001',
  stepId: 's2',
  simTime: 412,
  whatHappened: 'Drill stalled at 4 cm; rock harder than expected',
  scene: { objects: ['boulder 1.2 m, 3 m ahead'], slopeDeg: 18, terrain: 'loose regolith right' },
  options: [
    { id: 'o1', label: 'Drill alternate site outcrop-2', risk: 'low', costMin: 40 },
    { id: 'o2', label: 'Collect loose surface sample instead', risk: 'low', costMin: 15 },
    { id: 'o3', label: 'Retry with higher drill force', risk: 'medium', costMin: 20 },
  ],
  recommendation: 'o1',
};

const withStep = (patch: object) => ({ ...DOC_PLAN, steps: [{ ...DOC_PLAN.steps[0], ...patch }, ...DOC_PLAN.steps.slice(1)] });

describe('plan schema', () => {
  it('accepts the design-doc example plan and the demo plan', () => {
    expect(marsPlan.safeParse(DOC_PLAN).success).toBe(true);
    expect(marsPlan.safeParse(DEMO_PLAN).success).toBe(true);
  });

  it('rejects actions and conditions outside the scenario enums', () => {
    expect(marsPlan.safeParse(withStep({ action: 'fly_to' })).success).toBe(false);
    expect(marsPlan.safeParse(withStep({ branches: [{ if: 'aliens', then: 'abort' }] })).success).toBe(false);
  });

  it('rejects malformed branch outcomes and goto targets that do not exist', () => {
    expect(marsPlan.safeParse(withStep({ branches: [{ if: 'path_blocked', then: 'improvise' }] })).success).toBe(false);
    expect(marsPlan.safeParse(withStep({ branches: [{ if: 'path_blocked', then: 'goto:s9' }] })).success).toBe(false);
    expect(marsPlan.safeParse(withStep({ branches: [{ if: 'path_blocked', then: 'goto:s1' }] })).success).toBe(false);
  });

  it('rejects duplicate step ids', () => {
    expect(marsPlan.safeParse(withStep({ id: 's1b' })).success).toBe(false);
  });

  it('takes its enums from the scenario config, so another scenario reuses the schema', () => {
    const lab: ScenarioDef = {
      id: 'lab',
      name: 'Lab',
      actions: ['prepare_sample', 'incubate', 'image_sample', 'seal'],
      conditions: ['contamination_detected', 'growth_below_threshold'],
      whileWaitingTasks: ['monitor_temperature'],
      irreversibleActions: ['seal'],
    };
    const labPlan = createPlanSchema(lab);
    const plan = {
      ...DOC_PLAN,
      steps: [{ id: 'l1', action: 'incubate', branches: [{ if: 'contamination_detected', then: 'abort' }] }],
      whileWaiting: ['monitor_temperature'],
    };
    expect(labPlan.safeParse(plan).success).toBe(true);
    expect(labPlan.safeParse(DOC_PLAN).success).toBe(false);
  });
});

describe('escalation packet schema', () => {
  it('accepts the design-doc example packet', () => {
    expect(escalationPacketSchema.safeParse(DOC_PACKET).success).toBe(true);
  });

  it('requires 2–3 options and a recommendation that is one of them', () => {
    expect(escalationPacketSchema.safeParse({ ...DOC_PACKET, recommendation: 'o9' }).success).toBe(false);
    expect(escalationPacketSchema.safeParse({ ...DOC_PACKET, options: DOC_PACKET.options.slice(0, 1) }).success).toBe(false);
  });
});
