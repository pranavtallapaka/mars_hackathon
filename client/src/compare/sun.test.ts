import { describe, expect, it } from 'vitest';
import { sunPosition } from './sun';

describe('compare sun', () => {
  it('moves as sim time advances', () => {
    const a = sunPosition(0);
    const b = sunPosition(40);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(1);
    expect(a.y).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
  });
});
