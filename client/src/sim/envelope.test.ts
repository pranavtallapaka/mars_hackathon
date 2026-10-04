import { describe, expect, it } from 'vitest';
import horizonsCsv from '../../../shared/envelope/data/earth-mars-2026-2028.csv?raw';
import { loadMissionContext, missionContextId } from '../../../shared/envelope/context';
import { dataSourceWrites, missionContextWrite, solConditionWrites } from '../../../shared/envelope/persist';
import { commState, parseHorizonsCsv } from '../../../shared/envelope/horizons';
import { mars24 } from '../../../shared/envelope/mars24';
import { perseveranceBenchmark } from '../../../shared/envelope/perseverance';
import { SITES } from '../../../shared/envelope/sites';

describe('Agent A1: real data ingestion', () => {
  it('parses a Horizons-format table and flags conjunction on a small SOT angle', () => {
    const rows = parseHorizonsCsv(`
$$SOE
2028-Feb-01 12:00, 0.70, 5.80, 34.00
2028-Feb-02 12:00, 0.71, 5.90, 2.10
$$EOE
`);
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2028-02-01');
    expect(commState(rows[0])).toBe('normal');
    expect(commState(rows[1])).toBe('conjunction');
  });

  it('Mars24 matches the published 2000 Jan 6 coincidence within a sol and a few degrees of Ls', () => {
    const clock = mars24(new Date('2000-01-06T00:00:00Z'), 0, 0);
    expect(clock.msd).toBeGreaterThan(44795);
    expect(clock.msd).toBeLessThan(44797);
    expect(clock.lsDeg).toBeGreaterThan(270);
    expect(clock.lsDeg).toBeLessThan(285);
  });

  it('Perseverance waypoints yield a conventional-ops pace', () => {
    const b = perseveranceBenchmark();
    expect(b.available).toBe(true);
    expect(b.distanceKm).toBeGreaterThan(40);
    expect(b.kmPerSol).toBeGreaterThan(0.01);
    expect(b.source.url).toContain('M20_waypoints.json');
  });

  it('done when: a site and date window return a tagged MissionContext', () => {
    const ctx = loadMissionContext({ siteId: 'jezero', startDate: '2028-02-01', sols: 30 }, horizonsCsv);
    expect(ctx.site.id).toBe('jezero');
    expect(ctx.sols).toHaveLength(30);
    expect(ctx.terrain.source.source).toMatch(/HiRISE/);
    expect(ctx.sources.horizons.source).toMatch(/Horizons/);
    expect(ctx.sources.mars24.source).toMatch(/Mars24/);
    expect(ctx.sources.perseverance.url).toBeDefined();
    expect(ctx.sols[0].delayMin).toBeGreaterThanOrEqual(3);
    expect(ctx.sols[0].delayMin).toBeLessThanOrEqual(22);
    expect(ctx.sols[0].season).toBeTruthy();
    expect(ctx.benchmark.available).toBe(true);
    expect(ctx.sols.every((s) => ['normal', 'long_gap', 'conjunction'].includes(s.comm))).toBe(true);
  });

  it('D0 persist mapping tags each source and sol row', () => {
    const ctx = loadMissionContext({ siteId: 'jezero', startDate: '2028-02-01', sols: 3 }, horizonsCsv);
    const id = missionContextId(ctx.concept);
    expect(id).toBe('jezero:2028-02-01:3');
    const sources = dataSourceWrites(ctx);
    expect(sources.map((s) => s.name)).toEqual(['horizons', 'mars24', 'terrain', 'perseverance']);
    expect(sources.every((s) => s.source.length > 0)).toBe(true);
    const row = missionContextWrite(ctx, '2026-10-04T00:00:00.000Z');
    expect(row.id).toBe(id);
    expect(row.terrainKind).toBe('hirise');
    const sols = solConditionWrites(ctx);
    expect(sols).toHaveLength(3);
    expect(sols[0].dataSource).toBe('horizons,mars24');
    expect(sols[0].comm).toMatch(/normal|long_gap|conjunction/);
  });

  it('Oxia Planum is a second catalog site; Perseverance is Jezero-only', () => {
    expect(SITES.oxia.lat).toBeCloseTo(18.16, 1);
    const ctx = loadMissionContext({ siteId: 'oxia', startDate: '2028-02-01', sols: 5 }, horizonsCsv);
    expect(ctx.terrain.source.source).toMatch(/synthetic/i);
    expect(ctx.benchmark.available).toBe(false);
    expect(ctx.sols).toHaveLength(5);
  });
});
