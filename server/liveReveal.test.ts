import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertInsideLiveDir, loadLiveSnapshot, resolveLiveImage } from './liveReveal';

const analysis = {
  imageId: 'demo',
  analysis: {
    hazards: [{ type: 'rock', bbox: { x: 0.1, y: 0.8, w: 0.2, h: 0.15 }, severity: 'low', reason: 'Rocks.' }],
    targets: [{ type: 'outcrop', bbox: { x: 0.6, y: 0.7, w: 0.2, h: 0.1 }, reason: 'Bedrock.' }],
    terrainSummary: 'Rocky plain.',
    confidence: 'medium',
  },
  plan: {
    planId: 'live-demo',
    version: 1,
    intent: 'Drive to outcrop-1 and image it.',
    limits: { batteryFloorPct: 30, noGoZones: [], irreversibleNeedsApproval: true },
    steps: [
      {
        id: 's1',
        action: 'drive_to',
        args: { target: 'outcrop-1' },
        branches: [{ if: 'path_blocked', then: 'abort' }],
      },
    ],
    escalateWhen: ['no_branch_matches'],
    abort: { behavior: 'stop_and_return', to: 'last_safe_waypoint' },
    whileWaiting: ['image_surroundings'],
  },
  delay: { earthDate: '2026-10-04', delayMin: 13.6502, rangeAu: 1.64, sotDeg: 67 },
  compileSource: 'cached',
  validated: true,
  validationReasons: [],
  model: 'grok-4.7',
};

function seedCache(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'live-reveal-'));
  const fallback = path.join(dir, 'fallback');
  mkdirSync(fallback, { recursive: true });
  writeFileSync(path.join(fallback, 'scene.png'), Buffer.from([137, 80, 78, 71]));
  writeFileSync(
    path.join(fallback, 'scene.json'),
    JSON.stringify({
      imageId: 'demo',
      sol: 1996,
      camera: 'NAVCAM_LEFT',
      utcDateTaken: '2026-10-01T13:33:31.330Z',
      localMeanSolarTime: 'Sol-01996M11:53:10.864',
      nasaUrl: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/demo',
      credit: 'NASA/JPL-Caltech',
      fileName: 'scene.png',
      lat: 18.43687407,
      lon: 77.23205444,
      waypointSol: 1980,
    }),
  );
  writeFileSync(path.join(fallback, 'analysis.json'), JSON.stringify(analysis));
  return dir;
}

describe('live reveal snapshot', () => {
  it('loads the cached scene, plan, delay and location', () => {
    const liveDir = seedCache();
    const snap = loadLiveSnapshot({ cached: true, liveDir, now: new Date('2026-10-04T13:33:31.330Z') });
    expect(snap.view.scene.sol).toBe(1996);
    expect(snap.view.scene.daysAgo).toBe(3);
    expect(snap.view.scene.lat).toBeCloseTo(18.43687407);
    expect(snap.view.plan.planId).toBe('live-demo');
    expect(snap.view.delayMin).toBeCloseTo(13.6502);
    expect(snap.mime).toBe('image/png');
    const image = resolveLiveImage({ cached: true, liveDir });
    expect(image.filePath).toBe(snap.filePath);
  });

  it('refuses paths outside the live cache', () => {
    const liveDir = seedCache();
    expect(() => assertInsideLiveDir('/etc/passwd', liveDir)).toThrow(/outside/);
  });
});
