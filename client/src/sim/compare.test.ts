import { describe, expect, it } from 'vitest';
import { amendPlan, nominalFlow, toConventional } from './mars/amend';
import { DEMO_PLAN } from './mars/mission';
import { Sim, type SimMode } from './sim';

function runMission(mode: SimMode, oneWayDelayMin = 8, minutes = 400): Sim {
  const sim = new Sim({ mode, oneWayDelayMin, autoOperator: true });
  expect(sim.start().ok).toBe(true);
  for (let t = 1; t <= minutes && sim.ground.completionConfirmedAt === null; t++) sim.stepTo(t);
  return sim;
}

describe('Batch 3: baseline vs contingency', () => {
  it('done when: ours finishes with fewer round trips and less mission time than the baseline', () => {
    const ours = runMission('contingency');
    const base = runMission('baseline');
    expect(ours.metrics.complete).toBe(true);
    expect(base.metrics.complete).toBe(true);
    expect(ours.metrics.roundTrips).toBeLessThan(base.metrics.roundTrips);
    expect(ours.metrics.missionMin).toBeLessThan(base.metrics.missionMin);
    // The baseline's extra stop is the boulder our plan handled onboard with goto:s1b.
    expect(ours.metrics.roundTrips).toBe(2);
    expect(base.metrics.roundTrips).toBe(3);
    expect(base.ground.escalations.map((e) => e.condition)).toEqual(['path_blocked', 'rock_too_hard']);
    expect(ours.ground.escalations.map((e) => e.condition)).toEqual(['rock_too_hard']);
    // Same decisions on both sides: both end up sampling the alternate site.
    expect(ours.rover.samplesCollected).toEqual(base.rover.samplesCollected);
  });

  it('the gap grows with the light delay', () => {
    const gap = (d: number) => runMission('baseline', d).metrics.missionMin - runMission('contingency', d).metrics.missionMin;
    expect(gap(20)).toBeGreaterThan(gap(8));
  });

  it('the baseline sequence has no contingencies', () => {
    const base = runMission('baseline', 8, 1);
    const plan = base.ground.currentPlan!;
    expect(plan.steps.every((s) => s.branches.length === 0)).toBe(true);
    expect(plan.whileWaiting).toEqual([]);
    expect(plan.steps.map((s) => s.id)).not.toContain('s1b');
  });

  it('amendments are schema-valid plans', () => {
    const sim = new Sim();
    const plan = sim.planSchema.parse(DEMO_PLAN);
    const packet = {
      stepId: 's4',
      whatHappened: 'drill stalled',
      roverState: { pos: [20, 2], batteryPct: 60 },
      options: [
        { id: 'o1', label: 'Drill alternate site outcrop-2', cost: { timeMin: 30 } },
        { id: 'o2', label: 'Collect loose surface sample instead', cost: { timeMin: 10 } },
        { id: 'o3', label: 'Retry with higher drill force', cost: { timeMin: 20 } },
      ],
      recommendation: 'o1',
    };
    for (const id of ['o1', 'o2', 'o3']) {
      const amended = amendPlan(plan, packet as never, id);
      expect(amended).not.toBeNull();
      expect(sim.planSchema.safeParse(amended).success).toBe(true);
      expect(sim.planSchema.safeParse(toConventional(amended!, nominalFlow(amended!), 'b-001', 2)).success).toBe(true);
    }
  });
});
