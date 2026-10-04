import { describe, expect, it } from 'vitest';
import { DEMO_SEED } from '../sim/config';
import { createMap } from '../sim/map';
import { buildMarsMission } from '../sim/mars/mission';
import type { ReplayRun } from '../sim/replay';
import { drivenPathUntil, plannedRoute } from './route';

const run: ReplayRun = {
  runId: 't',
  mode: 'envelope',
  seed: 42,
  terrain: 'jezero',
  oneWayDelayMin: 8,
  start: { x: 0, y: 0, heading: 0 },
  events: [
    { type: 'drive', t: 0, from: { x: 0, y: 0, heading: 0 }, to: { x: 10, y: 0, heading: 1.5 }, tEnd: 10 },
    { type: 'wait', t: 10, reason: 'boulder', duration: 20 },
    { type: 'drive', t: 30, from: { x: 10, y: 0, heading: 1.5 }, to: { x: 10, y: 8, heading: 3 }, tEnd: 38 },
  ],
};

describe('drivenPathUntil', () => {
  it('stays at the start, interpolates drives, and freezes through a wait', () => {
    expect(drivenPathUntil(run, 0)).toEqual([{ x: 0, y: 0 }]);
    const mid = drivenPathUntil(run, 5);
    expect(mid.at(-1)).toEqual({ x: 5, y: 0 });
    const waiting = drivenPathUntil(run, 20);
    expect(waiting.at(-1)).toEqual({ x: 10, y: 0 });
    const later = drivenPathUntil(run, 34);
    expect(later.at(-1)?.y).toBeCloseTo(4);
  });

  it('places the demo boulder on the planned Jezero route', () => {
    const map = createMap(DEMO_SEED, 'jezero');
    const boulder = buildMarsMission(map, DEMO_SEED).hiddenObstacles[0];
    expect(boulder).toBeDefined();
    expect(plannedRoute(map).some((p) => p.x === boulder.x && p.y === boulder.y)).toBe(true);
  });
});
