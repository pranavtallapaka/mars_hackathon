import { describe, expect, it } from 'vitest';
import { DEMO_SEED } from './config';
import { createMap } from './map';
import { buildMarsMission, cellOnRoute } from './mars/mission';
import { BATCH_RUNS, runBatch, runPair, spread } from './batch';

describe('Stretch S4: batch test mode', () => {
  it('seed 42 keeps the scripted demo boulder and hard-rock stall', () => {
    const map = createMap(DEMO_SEED);
    const mission = buildMarsMission(map, DEMO_SEED);
    expect(mission.hiddenObstacles).toEqual([cellOnRoute(map, map.roverStart, 'wp-A', 0.6)]);
    expect(mission.sites['outcrop-1'].drillStallCm).toBe(4);
  });

  it('the same seed places the same surprises; a different seed can differ', () => {
    const mapA = createMap(1000);
    const mapB = createMap(1000);
    expect(buildMarsMission(mapA, 1000)).toEqual(buildMarsMission(mapB, 1000));
    const other = buildMarsMission(createMap(1001), 1001);
    const first = buildMarsMission(mapA, 1000);
    expect(JSON.stringify(first)).not.toEqual(JSON.stringify(other));
  });

  it('a seeded pair finishes on the cached plan with no LLM', () => {
    const pair = runPair(42, { terrain: 'synthetic', oneWayDelayMin: 8 });
    expect(pair.ours.complete).toBe(true);
    expect(pair.baseline.complete).toBe(true);
    expect(pair.ours.roundTrips).toBeLessThan(pair.baseline.roundTrips);
  });

  it('done when: 50 missions finish in under a minute and report aggregates', () => {
    const report = runBatch({ runs: BATCH_RUNS, terrain: 'synthetic', oneWayDelayMin: 8 });
    expect(report.runs).toBe(50);
    expect(report.elapsedMs).toBeLessThan(60_000);
    expect(report.ours.finished).toBeGreaterThanOrEqual(45);
    expect(report.baseline.finished).toBeGreaterThanOrEqual(45);
    expect(report.ours.roundTrips.mean).toBeLessThanOrEqual(report.baseline.roundTrips.mean);
    expect(report.saved.roundTrips).toBeGreaterThan(0);
    expect(report.pairs).toHaveLength(50);
    const trips = spread(report.pairs.map((p) => p.ours.roundTrips));
    expect(trips.max).toBeGreaterThanOrEqual(trips.min);
  }, 60_000);
});
