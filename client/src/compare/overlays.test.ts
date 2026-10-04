import { describe, expect, it } from 'vitest';
import { formatCountdown, overlayFor } from './overlays';
import type { ReplayRun } from '../sim/replay';

const run: ReplayRun = {
  runId: 'test',
  mode: 'envelope',
  seed: 42,
  terrain: 'jezero',
  oneWayDelayMin: 8,
  start: { x: 0, y: 0, heading: 0 },
  events: [
    { type: 'branch', t: 10, stepId: 's1', reason: 'path_blocked → goto:s1b' },
    { type: 'wait', t: 40, reason: 'hard rock', duration: 22 },
    { type: 'escalation', t: 40, packetId: 'p1' },
    { type: 'safe_hold', t: 40, activity: 'imaging' },
    { type: 'done', t: 80 },
  ],
};

describe('compare overlays', () => {
  it('formats a ticking countdown', () => {
    expect(formatCountdown(21 + 40 / 60)).toBe('21:40');
  });

  it('shows branch, wait, escalation and hold copy from replay samples', () => {
    const branch = overlayFor(run, 11, {
      t: 11,
      x: 1,
      y: 1,
      heading: 0,
      state: 'driving',
      waitRemaining: null,
    });
    expect(branch.branch).toBe('Took branch s1b: detour left, no call home');
    expect(branch.status).toBe('Onboard detour — no call home');
    expect(branch.countdown).toBeNull();

    const waiting = overlayFor(run, 40.5, {
      t: 40.5,
      x: 2,
      y: 2,
      heading: 0,
      state: 'waiting',
      waitRemaining: 21.5,
    });
    expect(waiting.status).toBe('Stopped at the boulder');
    expect(waiting.countdown).toBe('Waiting on Earth: 21:30');
    expect(waiting.escalation).toBe('Escalated: answer arrives in 21:30');
    expect(waiting.hold).toBe('Still imaging while waiting');
    expect(waiting.trips).toBe(2);
    expect(waiting.waitMin).toBeCloseTo(0.5);

    const done = overlayFor(run, 90, {
      t: 90,
      x: 3,
      y: 3,
      heading: 0,
      state: 'done',
      waitRemaining: null,
    });
    expect(done.doneAt).toBe(80);
    expect(done.clock).toBe('T+1:20');
  });
});
