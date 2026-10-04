import { describe, expect, it } from 'vitest';
import horizonsCsv from '../../../shared/envelope/data/earth-mars-2026-2028.csv?raw';
import { DEFAULT_CONCEPT } from '../../../shared/envelope/concept';
import {
  localPropose,
  runAgentJob,
  toolLoadMissionContext,
  toolValidateEnvelope,
} from './agent';

describe('Agent A4: envelope agent loop', () => {
  it('exposes the five tools and rejects an unsafe proposal', () => {
    const ctx = toolLoadMissionContext({ ...DEFAULT_CONCEPT, sols: 3 }, horizonsCsv);
    expect(ctx.site.id).toBe('jezero');
    expect(ctx.sols).toHaveLength(3);
    const started = localPropose({ ctx, current: null, lastScore: null, intent: 'start', version: 1 });
    expect(toolValidateEnvelope(started.envelope).ok).toBe(true);
    expect(started.change.length).toBeGreaterThan(10);
    expect(
      toolValidateEnvelope({
        envelopeId: 'reckless',
        version: 1,
        defaults: {
          limits: { batteryFloorPct: 10, noGoZones: [], irreversibleNeedsApproval: false },
          escalateWhen: ['no_branch_matches'],
        },
        rules: [],
      }).ok,
    ).toBe(false);
  });

  it('done when: Jezero demo concept converges with 0 unsafe on a fresh-seed check, and the log explains each change', async () => {
    const report = await runAgentJob(DEFAULT_CONCEPT, horizonsCsv, {
      runs: 8,
      maxIterations: 4,
      maxRuns: 48,
      tuneSeed: 2000,
      finalSeed: 52_000,
    });
    expect(report.contextId).toBe('jezero:2028-02-01:30');
    expect(report.job.status).toBe('done');
    expect(report.best).not.toBeNull();
    expect(report.finalCheck).not.toBeNull();
    expect(report.finalCheck?.unsafe).toBe(0);
    expect(report.finalCheck?.accepted).toBe(true);
    expect(report.tuningSeeds).not.toContain(report.finalSeed);
    expect(report.logs.some((row) => row.action === 'load_mission_context')).toBe(true);
    expect(report.logs.some((row) => row.action === 'propose_envelope')).toBe(true);
    expect(report.logs.some((row) => row.action === 'run_campaign')).toBe(true);
    expect(report.logs.some((row) => row.action === 'get_failures')).toBe(true);
    expect(report.logs.some((row) => row.action === 'final_check')).toBe(true);
    expect(report.logs.some((row) => row.action === 'widen' || row.action === 'tighten' || /Started|Widen|Tighten/i.test(row.change))).toBe(
      true,
    );
    expect(report.logs.every((row) => row.change.length > 0 && row.result.length > 0)).toBe(true);
  }, 60_000);
});
