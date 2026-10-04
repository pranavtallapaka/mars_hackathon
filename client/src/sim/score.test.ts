import { describe, expect, it } from 'vitest';
import {
  applyEnvelope,
  classifyTerrain,
  HANDWRITTEN_ENVELOPE,
  parseEnvelope,
  validateEnvelope,
} from '../../../shared/envelope/schema';
import { SITES, terrainSummary } from '../../../shared/envelope/sites';
import type { MissionContext, SolState } from '../../../shared/envelope/types';
import { CACHED_DEMO_PLAN } from '../../../shared/missions/mars-demo';
import { createPlanSchema } from '../../../shared/plan';
import { MARS_SURFACE } from '../../../shared/scenario';
import { scoreEnvelope } from './score';

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

describe('Agent A3: envelope schema and scoring', () => {
  it('zod-validates the hand-written envelope and rejects a duplicate cell', () => {
    expect(HANDWRITTEN_ENVELOPE.envelopeId).toBe('env-hand-2028');
    expect(validateEnvelope(HANDWRITTEN_ENVELOPE).ok).toBe(true);
    expect(() =>
      parseEnvelope({
        ...HANDWRITTEN_ENVELOPE,
        rules: [...HANDWRITTEN_ENVELOPE.rules, HANDWRITTEN_ENVELOPE.rules[0]],
      }),
    ).toThrow(/duplicate rule/);
    expect(
      validateEnvelope({
        envelopeId: 'bad',
        version: 1,
        defaults: HANDWRITTEN_ENVELOPE.defaults,
        rules: [
          {
            terrain: 'flat',
            comm: 'normal',
            limits: { batteryFloorPct: 10, noGoZones: [], irreversibleNeedsApproval: false },
            escalateWhen: ['no_branch_matches'],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it('classifies terrain from slope and roughness, then applies the matching cell', () => {
    expect(classifyTerrain(terrainSummary('oxia'))).toBe('flat');
    expect(['flat', 'sloped', 'rough']).toContain(classifyTerrain(terrainSummary('jezero')));
    const plan = createPlanSchema(MARS_SURFACE).parse(CACHED_DEMO_PLAN);
    const applied = applyEnvelope(plan, HANDWRITTEN_ENVELOPE, { terrain: 'rough', comm: 'long_gap' });
    expect(applied.limits.batteryFloorPct).toBe(38);
    expect(applied.escalateWhen).toContain('confidence_below:0.75');
    expect(applyEnvelope(plan, HANDWRITTEN_ENVELOPE, { terrain: 'flat', comm: 'normal' }).limits.batteryFloorPct).toBe(30);
  });

  it('done when: a hand-written envelope scores on a MissionContext with metrics and failures', () => {
    const mission = ctx([
      sol({ solIndex: 0, comm: 'normal', delayMin: 8 }),
      sol({ solIndex: 1, comm: 'long_gap', delayMin: 16, earthDate: '2028-02-02' }),
      sol({ solIndex: 2, comm: 'conjunction', delayMin: 8, earthDate: '2028-02-03' }),
    ]);
    const result = scoreEnvelope(HANDWRITTEN_ENVELOPE, mission, { runs: 8, baseSeed: 2000 });
    expect(result.envelopeId).toBe('env-hand-2028');
    expect(result.campaign).not.toBeNull();
    expect(result.campaign?.baseline.meanRoundTrips).toBeGreaterThan(0);
    expect(result.campaign?.envelope.meanRoundTrips).toBeGreaterThan(0);
    expect(Array.isArray(result.failures)).toBe(true);
    expect(result.failures.every((f) => /hazard|no_go|battery_floor|irreversible|stuck/.test(f.reason))).toBe(true);
    if (result.accepted) {
      expect(result.score).toBe(result.roundTripsSaved);
      expect(result.unsafe).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(0);
    } else {
      expect(result.score).toBeNull();
      expect(result.unsafe).toBeGreaterThan(0);
      expect(result.failures.length).toBeGreaterThan(0);
    }
  });

  it('rejects a short-daylight window with metrics and the unsafe list', () => {
    const mission = ctx([sol({ solIndex: 0, comm: 'normal', delayMin: 8, daylightHours: 0.15 })]);
    const result = scoreEnvelope(HANDWRITTEN_ENVELOPE, mission, { runs: 4, baseSeed: 4 });
    expect(result.accepted).toBe(false);
    expect(result.score).toBeNull();
    expect(result.campaign?.envelope.unsafe).toBeGreaterThan(0);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].reason).toMatch(/stuck|battery_floor|hazard|no_go|irreversible/);
    expect(Number.isInteger(result.failures[0].cellX)).toBe(true);
  });

  it('does not score an envelope that fails the flight-rule check', () => {
    const result = scoreEnvelope(
      {
        envelopeId: 'reckless',
        version: 1,
        defaults: {
          limits: { batteryFloorPct: 10, noGoZones: [], irreversibleNeedsApproval: false },
          escalateWhen: ['no_branch_matches'],
        },
        rules: [],
      },
      ctx([sol({ solIndex: 0, comm: 'normal', delayMin: 8 })]),
      { runs: 1 },
    );
    expect(result.accepted).toBe(false);
    expect(result.campaign).toBeNull();
    expect(result.errors.some((e) => /battery floor|no-go|approval/.test(e))).toBe(true);
  });
});
