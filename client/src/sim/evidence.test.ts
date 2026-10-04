import { describe, expect, it } from 'vitest';
import { aggregateHeat, limitsSetBy } from './evidence';

describe('Agent A5: evidence helpers', () => {
  it('aggregates envelope-side failures onto map cells and names the limits they set', () => {
    const failures = [
      { cellX: 4, cellY: 3, reason: 'stuck', detail: 'unfinished (safe_hold)', side: 'envelope', solIndex: 0 },
      { cellX: 4, cellY: 3, reason: 'battery_floor', detail: 'battery 28%', side: 'envelope', solIndex: 1 },
      { cellX: 8, cellY: 2, reason: 'hazard', detail: 'rock', side: 'envelope', solIndex: 2 },
      { cellX: 1, cellY: 1, reason: 'stuck', detail: 'baseline stuck', side: 'baseline', solIndex: 0 },
    ];
    const heat = aggregateHeat(failures);
    expect(heat).toHaveLength(2);
    expect(heat[0]).toMatchObject({ x: 4, y: 3, count: 2 });
    expect(heat[0].reasons).toEqual(['stuck', 'battery_floor']);
    const limits = limitsSetBy(failures);
    expect(limits.map((l) => l.limit)).toContain('battery floor');
    expect(limits.find((l) => l.reason === 'stuck')?.count).toBe(1);
  });
});
