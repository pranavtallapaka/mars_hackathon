import { formatClock } from '../format';
import type { ReplayEvent, ReplayRun, ReplaySample } from '../sim/replay';

const BRANCH_HOLD_MIN = 12;

export function formatCountdown(simMin: number): string {
  const sec = Math.max(0, Math.round(simMin * 60));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function branchLine(event: Extract<ReplayEvent, { type: 'branch' }>): string {
  const dest = event.reason.match(/goto:([A-Za-z0-9_-]+)/)?.[1];
  if (dest === 's1b') return 'Took branch s1b: detour left, no call home';
  return `Took branch ${dest ?? event.stepId}: handled onboard, no call home`;
}

export interface SideOverlay {
  status: string;
  countdown: string | null;
  branch: string | null;
  escalation: string | null;
  hold: string | null;
  clock: string;
  trips: number;
  waitMin: number;
  doneAt: number | null;
}

export function sameTrack(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.55;
}

export function overlayFor(run: ReplayRun, t: number, sample: ReplaySample): SideOverlay {
  const done = run.events.find((e) => e.type === 'done');
  const doneAt = done && done.t <= t ? done.t : null;
  const waits = run.events.filter((e): e is Extract<ReplayEvent, { type: 'wait' }> => e.type === 'wait');
  const started = waits.filter((e) => e.t <= t);
  const waitMin = started.reduce((sum, e) => sum + Math.min(e.duration, Math.max(0, t - e.t)), 0);
  const branch = [...run.events]
    .reverse()
    .find((e): e is Extract<ReplayEvent, { type: 'branch' }> => e.type === 'branch' && e.t <= t && t < e.t + BRANCH_HOLD_MIN);
  const hold = [...run.events]
    .reverse()
    .find((e): e is Extract<ReplayEvent, { type: 'safe_hold' }> => e.type === 'safe_hold' && e.t <= t);
  const waiting = sample.waitRemaining !== null && sample.waitRemaining > 0;

  const branched = run.events.some((e) => e.type === 'branch' && e.t <= t);
  const status = doneAt
    ? `Done at minute ${Math.round(doneAt)}`
    : waiting
      ? 'Stopped at the boulder'
      : branched
        ? 'Onboard detour — no call home'
        : sample.state === 'driving'
          ? 'On the planned route'
          : sample.state === 'drilling' || sample.state === 'collecting'
            ? sample.state === 'drilling'
              ? 'Drilling'
              : 'Collecting sample'
            : 'Waiting for the plan uplink';

  return {
    status,
    countdown: waiting ? `Waiting on Earth: ${formatCountdown(sample.waitRemaining ?? 0)}` : null,
    branch: branch ? branchLine(branch) : null,
    escalation:
      waiting && run.events.some((e) => e.type === 'escalation' && e.t <= t)
        ? `Escalated: answer arrives in ${formatCountdown(sample.waitRemaining ?? 0)}`
        : null,
    hold: waiting && hold?.activity === 'imaging' ? 'Still imaging while waiting' : null,
    clock: formatClock(doneAt ?? t),
    trips: 1 + started.length,
    waitMin,
    doneAt,
  };
}
