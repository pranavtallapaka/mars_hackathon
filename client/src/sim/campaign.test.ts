import { describe, expect, it } from 'vitest';
import { SITES, terrainSummary } from '../../../shared/envelope/sites';
import type { MissionContext, SolState } from '../../../shared/envelope/types';
import {
  mixSeed,
  runCampaign,
  runCampaignBatch,
  runCampaignPair,
  solMaxMinutes,
} from './campaign';

function sol(partial: Partial<SolState> & Pick<SolState, 'solIndex' | 'comm' | 'delayMin'>): SolState {
  return {
    earthDate: '2028-02-01',
    rangeAu: 0.7,
    sotDeg: 20,
    lsDeg: 10,
    season: 'northern_winter',
    msd: 1,
    lmstHours: 12,
    sunElevationDeg: 40,
    daylightHours: 12,
    isDay: true,
    ...partial,
  };
}

function ctx(sols: SolState[]): MissionContext {
  return {
    concept: { siteId: 'oxia', startDate: '2028-02-01', sols: sols.length },
    site: SITES.oxia,
    terrain: terrainSummary('oxia'),
    sols,
    benchmark: { available: false, source: { source: 'test' } },
    sources: {
      horizons: { source: 'test' },
      mars24: { source: 'test' },
      terrain: { source: 'test' },
      perseverance: { source: 'test' },
    },
    conjunctionThresholdDeg: 3,
  };
}

describe('Agent A2: campaign simulator', () => {
  it('skips conjunction sols as blackouts and does not simulate them', () => {
    const mission = ctx([
      sol({ solIndex: 0, comm: 'normal', delayMin: 8 }),
      sol({ solIndex: 1, comm: 'conjunction', delayMin: 8, sotDeg: 1 }),
    ]);
    const run = runCampaign(mission, 'envelope', 0, { baseSeed: 7 });
    expect(run.blackoutSols).toBe(1);
    expect(run.operationalSols).toBe(1);
    expect(run.sols[1].skipped).toBe('blackout');
    expect(run.sols[1].metrics).toBeNull();
  });

  it('caps the operational window to daylight and skips a night sol', () => {
    expect(solMaxMinutes(sol({ solIndex: 0, comm: 'normal', delayMin: 8, daylightHours: 2 }))).toBe(120);
    const night = ctx([sol({ solIndex: 0, comm: 'normal', delayMin: 8, daylightHours: 0, isDay: false })]);
    const run = runCampaign(night, 'baseline', 0, { baseSeed: 3 });
    expect(run.nightSols).toBe(1);
    expect(run.operationalSols).toBe(0);
  });

  it('uses that sol\'s one-way delay and is reproducible for a seed', () => {
    const mission = ctx([sol({ solIndex: 0, comm: 'long_gap', delayMin: 18 })]);
    const a = runCampaign(mission, 'envelope', 1, { baseSeed: 11 });
    const b = runCampaign(mission, 'envelope', 1, { baseSeed: 11 });
    expect(a.seed).toBe(b.seed);
    expect(a.roundTrips).toBe(b.roundTrips);
    expect(a.finished).toBe(b.finished);
    expect(mixSeed(11 + 1, 0)).toBe(a.sols[0].seed);
  });

  it('a different run index uses a different seed', () => {
    const mission = ctx([sol({ solIndex: 0, comm: 'normal', delayMin: 8 })]);
    const first = runCampaignPair(mission, 0, { baseSeed: 1000 });
    const other = runCampaignPair(mission, 1, { baseSeed: 1000 });
    expect(first.envelope.seed).not.toBe(other.envelope.seed);
    expect(first.envelope.sols[0].seed).not.toBe(other.envelope.sols[0].seed);
  });

  it('records unsafe outcomes with a map cell and reason when a run gets stuck', () => {
    const mission = ctx([sol({ solIndex: 0, comm: 'normal', delayMin: 8, daylightHours: 0.2 })]);
    const run = runCampaign(mission, 'baseline', 0, { baseSeed: 4 });
    if (run.failures.length) {
      expect(run.failures[0].reason).toMatch(/stuck|battery_floor|hazard|no_go|irreversible/);
      expect(Number.isInteger(run.failures[0].cellX)).toBe(true);
      expect(Number.isInteger(run.failures[0].cellY)).toBe(true);
    } else {
      expect(run.finished || run.operationalSols === 0).toBe(true);
    }
  });

  it('done when: 1000 baseline + envelope sols finish in under a minute', () => {
    const mission = ctx(
      Array.from({ length: 5 }, (_, i) => sol({ solIndex: i, comm: 'normal', delayMin: 8, earthDate: `2028-02-0${i + 1}` })),
    );
    const report = runCampaignBatch(mission, { runs: 100, baseSeed: 2000 });
    expect(report.baseline.operationalSols + report.envelope.operationalSols).toBe(1000);
    expect(report.elapsedMs).toBeLessThan(60_000);
    expect(report.runsPerMin).toBeGreaterThan(1000);
    expect(report.envelope.meanRoundTrips).toBeLessThanOrEqual(report.baseline.meanRoundTrips);
    expect(report.failures.every((f) => f.detail.length > 0)).toBe(true);
  }, 60_000);
});
