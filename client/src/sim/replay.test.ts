import { describe, expect, it } from 'vitest';
import { DEMO_SEED } from './config';
import { getComparison, sampleAt } from './replay';

describe('replay data layer', () => {
  it('done when: demo seed baseline waits more and finishes later; sampleAt interpolates a drive', () => {
    const { baseline, envelope } = getComparison(DEMO_SEED, { terrain: 'synthetic', oneWayDelayMin: 8 });

    const baselineWaits = baseline.events.filter((e) => e.type === 'wait');
    const envelopeWaits = envelope.events.filter((e) => e.type === 'wait');
    expect(baselineWaits.length).toBeGreaterThan(envelopeWaits.length);

    const baselineDone = baseline.events.find((e) => e.type === 'done');
    const envelopeDone = envelope.events.find((e) => e.type === 'done');
    expect(baselineDone).toBeDefined();
    expect(envelopeDone).toBeDefined();
    expect(baselineDone!.t).toBeGreaterThan(envelopeDone!.t);

    const drive = envelope.events.find((e) => e.type === 'drive' && e.tEnd - e.t >= 1);
    expect(drive).toBeDefined();
    if (drive?.type !== 'drive') throw new Error('expected a drive');

    const mid = (drive.t + drive.tEnd) / 2;
    const sample = sampleAt(envelope, mid);
    expect(sample.state).toBe('driving');
    expect(sample.x).toBeGreaterThan(Math.min(drive.from.x, drive.to.x) - 1e-6);
    expect(sample.x).toBeLessThan(Math.max(drive.from.x, drive.to.x) + 1e-6);
    expect(sample.y).toBeGreaterThan(Math.min(drive.from.y, drive.to.y) - 1e-6);
    expect(sample.y).toBeLessThan(Math.max(drive.from.y, drive.to.y) + 1e-6);
    const distFrom = Math.hypot(sample.x - drive.from.x, sample.y - drive.from.y);
    const distTo = Math.hypot(sample.x - drive.to.x, sample.y - drive.to.y);
    expect(distFrom).toBeGreaterThan(0.05);
    expect(distTo).toBeGreaterThan(0.05);

    const waiting = baselineWaits[0];
    if (waiting) {
      const during = sampleAt(baseline, waiting.t + waiting.duration / 2);
      expect(during.waitRemaining).toBeGreaterThan(0);
      expect(during.waitRemaining).toBeLessThan(waiting.duration);
    }
  });

  it('keeps both Jezero rovers on the same cells until the boulder', () => {
    const { baseline, envelope } = getComparison(DEMO_SEED);
    const split = envelope.events.find((e) => e.type === 'branch')?.t ?? 22;
    for (let t = 0; t < split; t++) {
      const a = sampleAt(baseline, t);
      const b = sampleAt(envelope, t);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.35);
    }
    const after = sampleAt(envelope, split + 3);
    const left = sampleAt(baseline, split + 3);
    expect(Math.hypot(after.x - left.x, after.y - left.y)).toBeGreaterThan(1);
  });
});
