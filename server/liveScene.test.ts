import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  daysAgoFromUtc,
  ingestLiveScene,
  isFullFrame,
  latestWaypoint,
  parseLmstHours,
  pickBestImage,
  recordFromMeta,
  type NasaRawImage,
} from './liveScene';

function image(partial: Partial<NasaRawImage> & Pick<NasaRawImage, 'imageid'>): NasaRawImage {
  return {
    sol: 1996,
    sample_type: 'Full',
    date_taken_utc: '2026-10-01T13:33:31.330',
    date_taken_mars: 'Sol-01996M11:53:10.864',
    link: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/demo',
    camera: { instrument: 'NAVCAM_LEFT' },
    image_files: { full_res: 'https://example.test/full.png', large: 'https://example.test/large.jpg' },
    extended: { subframeRect: '(1,1,5120,3840)' },
    ...partial,
  };
}

describe('live scene selection', () => {
  it('parses LMST hours and days-ago from UTC', () => {
    expect(parseLmstHours('Sol-01996M11:53:10.864')).toBeCloseTo(11 + 53 / 60 + 10 / 3600, 5);
    expect(parseLmstHours('bad')).toBeNull();
    const now = new Date('2026-10-04T13:33:31.330Z');
    expect(daysAgoFromUtc('2026-10-01T13:33:31.330Z', now)).toBe(3);
    expect(daysAgoFromUtc('2026-10-01T13:33:31.330', now)).toBe(3);
  });

  it('rejects thumbnails and subframes', () => {
    expect(isFullFrame(image({ imageid: 'thumb', sample_type: 'Thumbnail' }))).toBe(false);
    expect(
      isFullFrame(image({ imageid: 'sub', sample_type: 'Full', extended: { subframeRect: '(400,200,640,480)' } })),
    ).toBe(false);
    expect(isFullFrame(image({ imageid: 'full' }))).toBe(true);
  });

  it('prefers daylight Front Hazcam over Navcam from same sol and skips night/thumbnails', () => {
    const picked = pickBestImage([
      image({
        imageid: 'night-nav',
        date_taken_mars: 'Sol-01998M21:10:00.000',
        sol: 1998,
      }),
      image({
        imageid: 'thumb-nav',
        sample_type: 'Thumbnail',
        sol: 1998,
      }),
      image({
        imageid: 'day-haz',
        sol: 1998,
        camera: { instrument: 'FRONT_HAZCAM_LEFT_A' },
        date_taken_utc: '2026-10-03T14:35:09.105',
        date_taken_mars: 'Sol-01998M11:36:06.063',
      }),
      image({
        imageid: 'day-nav',
        sol: 1996,
        camera: { instrument: 'NAVCAM_RIGHT' },
      }),
    ]);
    expect(picked?.image.imageid).toBe('day-haz');
    expect(picked?.why).toMatch(/FRONT_HAZCAM_LEFT_A/);
    expect(picked?.why).toMatch(/full-frame daylight Front Hazcam/);
  });

  it('reads the latest published waypoint, last localization on a sol', () => {
    const waypoint = latestWaypoint([
      { properties: { sol: 13, lat: 18.1, lon: 77.1 } },
      { properties: { sol: 1980, lat: 18.4, lon: 77.2 } },
      { properties: { sol: 1980, lat: 18.43687407, lon: 77.23205444 } },
    ]);
    expect(waypoint).toEqual({ sol: 1980, lat: 18.43687407, lon: 77.23205444 });
  });
});

describe('live scene fallback', () => {
  it('uses the pinned demo scene when the feed is unreachable and flags it', async () => {
    const liveDir = mkdtempSync(path.join(tmpdir(), 'live-scene-'));
    const fallbackDir = path.join(liveDir, 'fallback');
    mkdirSync(fallbackDir, { recursive: true });
    writeFileSync(path.join(fallbackDir, 'scene.jpg'), 'demo');
    writeFileSync(
      path.join(fallbackDir, 'scene.json'),
      JSON.stringify({
        imageId: 'PINNED_NAV',
        sol: 1996,
        camera: 'NAVCAM_LEFT',
        utcDateTaken: '2026-10-01T13:33:31.330Z',
        localMeanSolarTime: 'Sol-01996M11:53:10.864',
        nasaUrl: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/PINNED_NAV',
        credit: 'NASA/JPL-Caltech',
        fileName: 'scene.jpg',
      }),
    );

    const result = await ingestLiveScene({
      liveDir,
      now: new Date('2026-10-04T13:33:31.330Z'),
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });

    expect(result.record.isFallback).toBe(true);
    expect(result.record.imageId).toBe('PINNED_NAV');
    expect(result.record.daysAgo).toBe(3);
    expect(result.record.credit).toBe('NASA/JPL-Caltech');
    expect(result.record.chosenWhy).toMatch(/unreachable/);
    expect(result.record.filePath).toContain('fallback/scene.jpg');
  });

  it('records metadata without image bytes', () => {
    const record = recordFromMeta(
      {
        imageId: 'NLG_1',
        sol: 1996,
        camera: 'NAVCAM_LEFT',
        utcDateTaken: '2026-10-01T13:33:31.330Z',
        localMeanSolarTime: 'Sol-01996M11:53:10.864',
        nasaUrl: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/NLG_1',
        credit: 'NASA/JPL-Caltech',
        fileName: 'NLG_1.png',
      },
      'data/live/NLG_1.png',
      { isFallback: false, chosenWhy: 'test', now: new Date('2026-10-04T00:00:00Z') },
    );
    expect(record).not.toHaveProperty('bytes');
    expect(record.filePath).toBe('data/live/NLG_1.png');
    expect(JSON.stringify(record)).not.toMatch(/data:image/);
  });
});
