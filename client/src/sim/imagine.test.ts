import { describe, expect, it } from 'vitest';
import { REAL_IMAGE_BYTES } from '../../../shared/scene';
import { DEMO_PLAN } from './mars/mission';
import { Sim } from './sim';

function runUntilDecision(sim: Sim, from = 0, to = 400): number {
  for (let t = from + 1; t <= to; t++) {
    if (sim.stepTo(t)) return sim.now;
    if (sim.ground.completionConfirmedAt !== null) break;
  }
  return sim.now;
}

describe('Batch 6: Grok Imagine scene reconstruction', () => {
  it('done when: requesting the real image costs a round trip and the camera-frame bytes', () => {
    const sim = new Sim({ mode: 'contingency' });
    sim.start(DEMO_PLAN);
    runUntilDecision(sim);
    const esc = sim.awaitingDecision!;
    expect(esc.packet.stepId).toBe('s4');

    const before = { ...sim.metrics };
    expect(sim.requestImage(esc.packet.stepId)).toBe(true);
    expect(sim.requestImage(esc.packet.stepId)).toBe(false);
    expect(sim.metrics.roundTrips).toBe(before.roundTrips + 1);
    expect(sim.metrics.bytesUp).toBeGreaterThan(before.bytesUp);

    for (let t = Math.floor(sim.now) + 1; t <= sim.now + 40; t++) {
      sim.stepTo(t);
      if (sim.ground.imageRequests[0]?.receivedAt !== null) break;
    }

    const req = sim.ground.imageRequests[0];
    expect(req.receivedAt).not.toBeNull();
    expect(req.downBytes).toBe(REAL_IMAGE_BYTES);
    expect(sim.metrics.bytesDown).toBeGreaterThanOrEqual(before.bytesDown + REAL_IMAGE_BYTES);
    expect(sim.metrics.roundTrips).toBe(before.roundTrips + 1);
    // Still waiting on the same one-click decision; the picture did not answer it.
    expect(sim.awaitingDecision?.packet.stepId).toBe('s4');
  });
});
