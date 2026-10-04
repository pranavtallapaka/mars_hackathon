import { describe, expect, it } from 'vitest';
import { DEFAULT_EPHEMERIS_DATE, earthMarsLightTime } from '../../../shared/ephemeris';
import { findPath } from './grid';
import { loadJezeroMap } from './map';
import { DEMO_PLAN } from './mars/mission';
import { Sim } from './sim';

describe('Stretch S1: real Mars data', () => {
  it('the Jezero map is HiRISE-derived and every named feature is reachable', () => {
    const map = loadJezeroMap();
    expect(map.source?.id).toBe('DTEEC_048842_1985_048908_1985_U01');
    expect(map.cellMeters).toBe(25);
    expect(map.elevations).toHaveLength(map.width * map.height);
    expect(map.cells).toContain('sand');
    expect(map.cells).toContain('rock');
    expect(map.noGoZones.map((z) => z.id)).toContain('sand-1');
    for (const f of map.features) expect(findPath(map, map.roverStart, f.pos)).not.toBeNull();
  });

  it('done when (1): the scripted mission runs on Jezero terrain', () => {
    const ours = new Sim({ terrain: 'jezero', autoOperator: true });
    const base = new Sim({ terrain: 'jezero', mode: 'baseline', autoOperator: true });
    expect(ours.start(DEMO_PLAN).ok).toBe(true);
    expect(base.start(DEMO_PLAN).ok).toBe(true);
    for (let t = 1; t <= 400; t++) {
      ours.stepTo(t);
      base.stepTo(t);
    }
    expect(ours.metrics.complete).toBe(true);
    expect(base.metrics.complete).toBe(true);
    expect(ours.metrics.roundTrips).toBeLessThan(base.metrics.roundTrips);
    expect(ours.metrics.missionMin).toBeLessThan(base.metrics.missionMin);
    expect(ours.map.source?.id).toBe('DTEEC_048842_1985_048908_1985_U01');
  });

  it('done when (2): picking a date sets the real Earth–Mars light time', () => {
    const near = earthMarsLightTime(DEFAULT_EPHEMERIS_DATE);
    const far = earthMarsLightTime('2026-01-15');
    expect(near.delayMin).toBeGreaterThanOrEqual(3);
    expect(near.delayMin).toBeLessThanOrEqual(22);
    expect(far.delayMin).not.toBe(near.delayMin);
    const sim = new Sim({ terrain: 'jezero', oneWayDelayMin: near.delayMin });
    expect(sim.link.oneWayDelayMin).toBe(near.delayMin);
  });
});
