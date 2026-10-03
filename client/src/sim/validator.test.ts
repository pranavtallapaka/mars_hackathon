import { describe, expect, it } from 'vitest';
import { STAGED_UNSAFE_PLAN } from '../../../shared/missions/mars-demo';
import type { Plan } from '../../../shared/plan';
import { DEMO_PLAN } from './mars/mission';
import { Sim, type DecisionBook } from './sim';

const demo = () => new Sim().planSchema.parse(DEMO_PLAN);
const withChanges = (change: (p: Plan) => void): Plan => {
  const plan = structuredClone(demo());
  change(plan);
  return plan;
};

/** Runs until the ground is waiting on a human, or the mission is confirmed done. */
function runUntilDecision(sim: Sim, from = 0, to = 400): number {
  for (let t = from + 1; t <= to; t++) {
    if (sim.stepTo(t)) return sim.now;
    if (sim.ground.completionConfirmedAt !== null) break;
  }
  return sim.now;
}

describe('Batch 5: pre-uplink safety validator', () => {
  it('done when (1): the staged unsafe command is blocked before uplink, with reasons', () => {
    const sim = new Sim();
    const result = sim.start(STAGED_UNSAFE_PLAN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsafe).toBe(true);
    expect(result.errors.join(' ')).toContain('below the flight-rule minimum of 20%');
    expect(result.errors.join(' ')).toContain('drops no-go zone sand-1');
    expect(sim.metrics.unsafeBlocked).toBe(1);
    expect(sim.ground.uplinks).toHaveLength(0);
    expect(sim.link.up.totalBytes).toBe(0);
    expect(sim.startedAt).toBeNull();
  });

  it('passes the demo plan and forecasts its battery use', () => {
    const report = new Sim().checkSafety(demo());
    expect(report.reasons).toEqual([]);
    expect(report.forecast.endBatteryPct).toBeGreaterThan(30);
  });

  it('blocks unapproved irreversible steps, targets inside no-go zones, and a forecast floor breach', () => {
    const sim = new Sim();
    const unapproved = withChanges((p) => delete p.steps[4].approved);
    expect(sim.checkSafety(unapproved).reasons.join(' ')).toContain('s4 drill outcrop-1 (depthCm 5) is irreversible but not approved');

    const noApproval = withChanges((p) => (p.limits.irreversibleNeedsApproval = false));
    expect(sim.checkSafety(noApproval).ok).toBe(false);

    const highFloor = withChanges((p) => (p.limits.batteryFloorPct = 95));
    expect(sim.checkSafety(highFloor).reasons.join(' ')).toMatch(/Forecast: battery falls to .* below the 95% floor/);
  });

  it('checks escalation answers too: an unsafe amendment is blocked and the operator is asked again', () => {
    const sim = new Sim();
    sim.start(DEMO_PLAN);
    runUntilDecision(sim);
    expect(sim.awaitingDecision?.packet.stepId).toBe('s4');
    const blocked = withChanges((p) => {
      p.version = 2;
      p.limits.noGoZones = [];
    });
    expect(sim.sendPlan(blocked).ok).toBe(false);
    expect(sim.ground.lastBlocked?.reasons.join(' ')).toContain('sand-1');
  });
});

describe('Batch 5: one-click escalation', () => {
  it('done when (2): the hard-rock escalation resolves with a single click', () => {
    const sim = new Sim({ mode: 'contingency' });
    sim.start(DEMO_PLAN);
    const pausedAt = runUntilDecision(sim);
    const escalation = sim.awaitingDecision!;
    expect(escalation.condition).toBe('rock_too_hard');
    expect(pausedAt).toBe(escalation.receivedAt);

    sim.decide(escalation.packet.recommendation);
    expect(sim.awaitingDecision).toBeNull();
    runUntilDecision(sim, Math.floor(sim.now));
    expect(sim.metrics.complete).toBe(true);
    expect(sim.metrics.roundTrips).toBe(2);
    expect(sim.ground.uplinks[1].sentAt).toBeCloseTo(escalation.receivedAt + sim.decisionMin);
    expect(sim.rover.samplesCollected).toBe(1);
  });

  it("the baseline makes the same call the human made, so only timing differs", () => {
    const decisions: DecisionBook = new Map();
    const ours = new Sim({ mode: 'contingency', decisions });
    const base = new Sim({ mode: 'baseline', autoOperator: true, decisions });
    ours.start(DEMO_PLAN);
    base.start(DEMO_PLAN);
    for (let t = 1; t <= 400; t++) {
      if (ours.stepTo(t)) {
        const surface = ours.awaitingDecision!.packet.options.find((o) => o.label.startsWith('Collect loose surface'))!;
        ours.decide(surface.id);
      }
      base.stepTo(t);
    }
    expect(ours.metrics.complete && base.metrics.complete).toBe(true);
    expect(base.groundLog.some((l) => l.text.includes('Collect loose surface sample instead (same call as ours)'))).toBe(true);
    expect(ours.metrics.missionMin).toBeLessThan(base.metrics.missionMin);
  });
});
