import { describe, expect, it } from 'vitest';
import { TICKS_PER_MIN } from './config';
import { cellAt, featureById, samePos } from './grid';
import { DEMO_PLAN } from './mars/mission';
import { Sim } from './sim';
import type { Vec } from './types';

const DELAY = 8;

type PlanJson = { limits: { batteryFloorPct: number }; steps: Record<string, unknown>[] };
const demoPlan = () => structuredClone(DEMO_PLAN) as PlanJson;

// Onboard limits are the second layer, so these tests switch off the ground validator to reach them.
function run(plan: unknown, minutes: number) {
  const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY, groundSafetyCheck: false });
  expect(sim.sendPlan(plan).ok).toBe(true);
  const visited: Vec[] = [];
  for (let tick = 1; tick <= minutes * TICKS_PER_MIN; tick++) {
    sim.stepTo(tick / TICKS_PER_MIN);
    visited.push({ ...sim.rover.pos });
  }
  const log = sim.roverLog.map((e) => e.text);
  return { sim, visited, log };
}

describe('scripted mission (Batch 2 done-when)', () => {
  it('branches on the staged boulder, then escalates on the hard rock', () => {
    const { sim, visited, log } = run(DEMO_PLAN, 120);

    const blocked = log.findIndex((l) => l.startsWith('[s1] path_blocked') && l.endsWith('→ goto:s1b'));
    expect(blocked).toBeGreaterThan(-1);
    expect(log.some((l, i) => i > blocked && l.startsWith('[s1b] done: arrived at wp-A-alt'))).toBe(true);
    expect(log.some((l) => l.startsWith('[s3] done: outcrop-1 identified'))).toBe(true);
    expect(log.some((l) => l.startsWith('[s4] rock_too_hard') && l.endsWith('→ escalate'))).toBe(true);
    expect(log.some((l) => l.startsWith('[s5]'))).toBe(false);

    const wpA = featureById(sim.map, 'wp-A')!.pos;
    expect(visited.some((p) => samePos(p, wpA))).toBe(false);
    expect(sim.rover.discovered).toEqual(sim.mission.hiddenObstacles);

    expect(sim.executor.mode).toBe('safe_hold');
    const packet = sim.executor.escalation!;
    expect(packet).toMatchObject({ planId: 'p-001', stepId: 's4', recommendation: 'o1' });
    expect(packet.whatHappened).toMatch(/Drill stalled at 4 cm/);
    expect(packet.options.length).toBeGreaterThanOrEqual(2);
    expect(packet.scene).toMatchObject({ slopeDeg: 18, terrain: 'loose regolith right' });
  });

  it('delivers the escalation packet to mission control one delay later', () => {
    const { sim } = run(DEMO_PLAN, 120);
    const [received] = sim.ground.escalations;
    expect(received.packet.stepId).toBe('s4');
    expect(received.receivedAt - received.packet.simTime).toBeCloseTo(DELAY);
  });

  it('keeps imaging but does not move while in safe hold', () => {
    const { sim } = run(DEMO_PLAN, 120);
    const pos = { ...sim.rover.pos };
    const images = sim.rover.imagesTaken;
    sim.stepTo(150);
    expect(sim.rover.pos).toEqual(pos);
    expect(sim.rover.imagesTaken).toBeGreaterThan(images);
    expect(sim.roverLog.at(-1)!.text).toMatch(/image_surroundings/);
  });

  it('never enters the sand no-go zone', () => {
    const { sim, visited } = run(DEMO_PLAN, 120);
    expect(visited.every((p) => cellAt(sim.map, p) !== 'sand')).toBe(true);
  });

  it('is deterministic: same seed and plan give the same decision log', () => {
    expect(run(DEMO_PLAN, 120).log).toEqual(run(DEMO_PLAN, 120).log);
  });
});

describe('onboard hard limits', () => {
  it('refuses a drive that would breach the battery floor and takes the abort branch', () => {
    const plan = demoPlan();
    plan.limits.batteryFloorPct = 99;
    const { sim, log } = run(plan, 60);
    expect(log.some((l) => l.startsWith('[s1] battery_below_floor') && l.endsWith('→ abort'))).toBe(true);
    expect(sim.executor.mode).toBe('aborted');
    expect(sim.rover.pos).toEqual(sim.map.roverStart);
  });

  it('refuses an irreversible step that is not approved and escalates instead', () => {
    const plan = demoPlan();
    plan.steps.forEach((s) => {
      if (s.id === 's4') s.approved = false;
    });
    const { sim, log } = run(plan, 120);
    expect(log.some((l) => l.startsWith('[s4] refused') && l.includes('not approved'))).toBe(true);
    expect(log.some((l) => l.startsWith('[s4] start'))).toBe(false);
    expect(sim.executor.escalation).toMatchObject({ stepId: 's4', recommendation: 'o2' });
  });

  it('treats drilling as irreversible even when the plan forgets to flag it', () => {
    const plan = demoPlan();
    plan.steps.forEach((s) => {
      if (s.id === 's4') {
        delete s.irreversible;
        delete s.approved;
      }
    });
    const { log } = run(plan, 120);
    expect(log.some((l) => l.startsWith('[s4] refused'))).toBe(true);
  });

  it('escalates when a condition has no matching branch', () => {
    const plan = demoPlan();
    plan.steps.forEach((s) => {
      if (s.id === 's1') s.branches = [];
    });
    const { sim, log } = run(plan, 60);
    expect(log.some((l) => l.startsWith('[s1] path_blocked') && l.includes('no branch matches'))).toBe(true);
    expect(sim.executor.escalation?.stepId).toBe('s1');
  });

  it('rejects an invalid plan on the ground, so nothing is uplinked', () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    const plan = demoPlan();
    plan.steps[0].action = 'teleport';
    const result = sim.sendPlan(plan);
    expect(result.ok).toBe(false);
    expect(sim.link.up.inFlight).toHaveLength(0);
  });
});
