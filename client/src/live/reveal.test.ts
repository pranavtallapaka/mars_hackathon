import { describe, expect, it } from 'vitest';
import {
  branchLinks,
  cameraShortName,
  daysAgoPhrase,
  delaySentence,
  formatLatLon,
  formatLightTime,
  hazardsForCondition,
  lonLatToPct,
  HIRISE_FRAME,
  JEZERO_INSET,
  oneLine,
  optionalNumber,
  sceneCaption,
} from '../../../shared/liveScene/reveal';
import type { PlanStep } from '../../../shared/plan';
import type { SceneAnalysis } from '../../../shared/liveScene/analysis';

const hazards: SceneAnalysis['hazards'] = [
  { type: 'rock', bbox: { x: 0, y: 0.8, w: 0.2, h: 0.2 }, severity: 'low', reason: 'Scattered stones on the left.' },
  { type: 'steep_slope', bbox: { x: 0.5, y: 0.6, w: 0.4, h: 0.1 }, severity: 'low', reason: 'Low ridge on the right horizon.' },
];

describe('live reveal copy', () => {
  it('formats the Perseverance caption and Navcam label', () => {
    expect(cameraShortName('NAVCAM_LEFT')).toBe('Navcam');
    expect(cameraShortName('FRONT_HAZCAM_RIGHT_A')).toBe('Hazcam');
    expect(daysAgoPhrase(2.77)).toBe('3 days ago');
    expect(daysAgoPhrase(0.2)).toBe('today');
    expect(daysAgoPhrase(1.1)).toBe('1 day ago');
    expect(sceneCaption({ sol: 1996, daysAgo: 2.77, camera: 'NAVCAM_LEFT' })).toBe(
      'Taken by Perseverance on Mars, sol 1996, 3 days ago. Navcam.',
    );
  });

  it('formats today\'s one-way light time', () => {
    expect(formatLightTime(13.6502)).toEqual({ minutes: 13, seconds: 39, label: '13 min 39 s' });
    expect(delaySentence(13.6502)).toBe('Today, this plan would take 13 min 39 s to reach Mars.');
  });

  it('links contingency branches to the hazards they handle', () => {
    const step: PlanStep = {
      id: 's1',
      action: 'drive_to',
      args: { target: 'outcrop-2' },
      branches: [
        { if: 'path_blocked', then: 'goto:s1b' },
        { if: 'hazard_detected', then: 'abort' },
        { if: 'battery_below_floor', then: 'abort' },
      ],
    };
    const links = branchLinks(step, hazards);
    expect(links[0]?.hazards.map((h) => h.type)).toEqual(['rock']);
    expect(links[1]?.hazards.map((h) => h.type)).toEqual(['steep_slope']);
    expect(hazardsForCondition('battery_below_floor', hazards)).toEqual([]);
    expect(oneLine('Scattered stones on the left. More detail.')).toBe('Scattered stones on the left.');
  });

  it('places the current waypoint west of the HiRISE landing-site frame', () => {
    const rover = lonLatToPct(18.43687407, 77.23205444, JEZERO_INSET);
    expect(rover.inside).toBe(true);
    expect(rover.x).toBeLessThan(0.3);
    const onHirise = lonLatToPct(18.43687407, 77.23205444, HIRISE_FRAME);
    expect(onHirise.inside).toBe(false);
    expect(formatLatLon(18.43687407, 77.23205444)).toBe('18.437°N 77.232°E');
    expect(optionalNumber({ some: 18.4 })).toBe(18.4);
    expect(optionalNumber(18.4)).toBe(18.4);
  });
});
