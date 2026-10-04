import { describe, expect, it } from 'vitest';
import { createPlanSchema, escalationPacketSchema } from '../../../shared/plan';
import { MARS_SURFACE } from '../../../shared/scenario';
import { escalationReadback, planReadback, speakable, voiceKey } from '../../../shared/voice';
import { DEMO_PLAN } from './mars/mission';
import { Sim } from './sim';

const plan = createPlanSchema(MARS_SURFACE).parse(DEMO_PLAN);

describe('Batch 7: ElevenLabs voice', () => {
  it('the ground assistant script reads the compiled plan', () => {
    const text = planReadback(plan);
    expect(text).toMatch(/Plan p-001/);
    expect(text.toLowerCase()).toContain('intent');
    expect(text).toMatch(/outcrop/i);
    expect(text).toMatch(/Approve to uplink/);
    expect(speakable('wp-A 30% 5cm')).toBe('waypoint A 30 percent 5 centimeters');
    expect(voiceKey('ground', text)).toBe(voiceKey('ground', text));
    expect(voiceKey('ground', text)).not.toBe(voiceKey('rover', text));
  });

  it('the robot script reads an escalation only Earth has received', () => {
    const packet = escalationPacketSchema.parse({
      planId: 'p-001',
      stepId: 's4',
      simTime: 40,
      whatHappened: 'Drill stalled at 4 cm; rock harder than expected',
      scene: { objects: ['boulder 1.2 m'], slopeDeg: 18, terrain: 'loose regolith right' },
      options: [
        { id: 'o1', label: 'Drill alternate site outcrop-2', risk: 'low', costMin: 40 },
        { id: 'o2', label: 'Collect loose surface sample instead', risk: 'low', costMin: 15 },
      ],
      recommendation: 'o1',
    });
    const text = escalationReadback(packet);
    expect(text).toMatch(/Rover escalation/);
    expect(text).toMatch(/Recommended/);
    expect(text).toContain('s4');

    const sim = new Sim({ oneWayDelayMin: 10, autoOperator: false });
    sim.start(DEMO_PLAN);
    for (let t = 1; t <= 80; t++) {
      if (sim.executor.escalation && sim.ground.escalations.length === 0) break;
      sim.stepTo(t);
    }
    expect(sim.executor.escalation).not.toBeNull();
    expect(sim.ground.escalations).toHaveLength(0);
    const sentAt = sim.executor.escalation!.simTime;
    for (let t = Math.floor(sim.now) + 1; t <= sentAt + 12; t++) sim.stepTo(t);
    expect(sim.ground.escalations).toHaveLength(1);
    expect(sim.ground.escalations[0].receivedAt).toBeGreaterThan(sentAt);
  });

  it('typed path still works with the mic off', () => {
    const sim = new Sim({ autoOperator: true });
    expect(sim.start(DEMO_PLAN).ok).toBe(true);
    for (let t = 1; t <= 400; t++) sim.stepTo(t);
    expect(sim.metrics.complete).toBe(true);
  });
});
