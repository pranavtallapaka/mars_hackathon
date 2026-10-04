import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPath } from '../client/src/sim/grid';
import { checkPlanSafety } from '../client/src/sim/validator';
import { missionIssues } from '../shared/compiler';
import { createPlanSchema } from '../shared/plan';
import { MARS_SURFACE } from '../shared/scenario';
import {
  briefingFromAnalysis,
  parseSceneAnalysis,
  pickBestTarget,
  planFromAnalysis,
  type SceneAnalysis,
} from '../shared/liveScene/analysis';
import { analyzeLiveScene, mapFromAnalysis, todayLightTime } from './liveAnalyze';

const analysis: SceneAnalysis = {
  hazards: [
    {
      type: 'rock',
      bbox: { x: 0.2, y: 0.45, w: 0.12, h: 0.14 },
      severity: 'medium',
      reason: 'Boulder on the left of the drive lane',
    },
    {
      type: 'sand_soft_soil',
      bbox: { x: 0.62, y: 0.55, w: 0.18, h: 0.16 },
      severity: 'high',
      reason: 'Soft ripple field to the right',
    },
  ],
  targets: [
    {
      type: 'interesting_rock',
      bbox: { x: 0.1, y: 0.7, w: 0.08, h: 0.08 },
      reason: 'Dark float rock, less useful',
    },
    {
      type: 'layered_rock',
      bbox: { x: 0.48, y: 0.22, w: 0.2, h: 0.16 },
      reason: 'Bedded outcrop ahead, primary science target',
    },
  ],
  terrainSummary: 'Open Jezero pavement with a layered outcrop ahead and soft soil on the right.',
  confidence: 'high',
};

describe('live scene analysis', () => {
  it('validates structured vision JSON and rejects a bad box', () => {
    const ok = parseSceneAnalysis(JSON.stringify(analysis));
    expect(ok.analysis?.confidence).toBe('high');
    const bad = parseSceneAnalysis(JSON.stringify({ ...analysis, hazards: [{ ...analysis.hazards[0], bbox: { x: 2, y: 0, w: 1, h: 1 } }] }));
    expect(bad.analysis).toBeNull();
    expect(bad.errors.join(' ')).toMatch(/bbox|max/i);
  });

  it('picks the layered outcrop and compiles a contingency plan that passes the validator', () => {
    expect(pickBestTarget(analysis)?.type).toBe('layered_rock');
    const { briefing, bestTargetId } = briefingFromAnalysis(analysis, 'NLG_TEST');
    expect(bestTargetId).toMatch(/outcrop/);
    expect(briefing.noGoZones.some((z) => z.id.startsWith('sand'))).toBe(true);

    const plan = planFromAnalysis(analysis, 'NLG_TEST');
    expect(createPlanSchema(MARS_SURFACE).parse(plan).steps.some((s) => s.action === 'drive_to')).toBe(true);
    expect(plan.steps[0].branches.some((b) => b.if === 'path_blocked')).toBe(true);
    expect(plan.steps[0].branches.some((b) => b.if === 'hazard_detected')).toBe(true);
    expect(missionIssues(plan, MARS_SURFACE, briefing)).toEqual([]);

    const map = mapFromAnalysis(analysis, 'NLG_TEST');
    expect(findPath(map, map.roverStart, briefing.features.find((f) => f.id === bestTargetId)!.pos)).not.toBeNull();
    const safety = checkPlanSafety(
      plan,
      map,
      briefing.flightRules,
      { pos: briefing.roverStart, batteryPct: 100, knownObstacles: [] },
      MARS_SURFACE.irreversibleActions,
    );
    expect(safety.ok).toBe(true);
  });

  it('uses A1 Horizons lookup for today\'s one-way light time', () => {
    const delay = todayLightTime(new Date('2026-10-04T16:00:00Z'));
    expect(delay.earthDate).toBe('2026-10-04');
    expect(delay.delayMin).toBeCloseTo(13.6502, 3);
    expect(delay.rangeAu).toBeGreaterThan(1);
  });

  it('retries invalid vision JSON once, then compiles and can persist a linked row', async () => {
    const liveDir = mkdtempSync(path.join(tmpdir(), 'live-analyze-'));
    mkdirSync(path.join(liveDir, 'fallback'), { recursive: true });
    writeFileSync(path.join(liveDir, 'fallback', 'scene.png'), 'png');
    writeFileSync(
      path.join(liveDir, 'fallback', 'scene.json'),
      JSON.stringify({
        imageId: 'NLG_TEST',
        sol: 1996,
        camera: 'NAVCAM_LEFT',
        utcDateTaken: '2026-10-01T13:33:31.330Z',
        localMeanSolarTime: 'Sol-01996M11:53:10.864',
        nasaUrl: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/NLG_TEST',
        credit: 'NASA/JPL-Caltech',
        fileName: 'scene.png',
      }),
    );

    let calls = 0;
    const persisted: string[] = [];
    const result = await analyzeLiveScene({
      liveDir,
      now: new Date('2026-10-04T16:00:00Z'),
      callVision: async () => {
        calls += 1;
        if (calls === 1) return '{not-json';
        return JSON.stringify(analysis);
      },
      callModel: null,
      persist: async (row) => {
        persisted.push(row.imageId);
        expect(row.id).toBe('current');
        expect(JSON.parse(row.analysisJson).targets).toHaveLength(2);
        expect(JSON.parse(row.planJson).steps.length).toBeGreaterThan(1);
        expect(row.delayMin).toBeCloseTo(13.6502, 3);
        expect(row.validated).toBe(true);
      },
    });

    expect(calls).toBe(2);
    expect(result.analysis.targets).toHaveLength(2);
    expect(result.safety.ok).toBe(true);
    expect(result.persisted).toBe(true);
    expect(persisted).toEqual(['NLG_TEST']);
    expect(result.compile.source).toBe('cached');
  });
});
