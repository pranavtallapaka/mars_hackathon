import { DEMO_PLAN } from './mars/mission';
import { Sim, type LogEntry } from './sim';
import type { TerrainId } from './types';

export type ReplayMode = 'baseline' | 'envelope';

export interface ReplayPose {
  x: number;
  y: number;
  heading: number;
}

export type ReplayEvent =
  | { type: 'drive'; t: number; from: ReplayPose; to: ReplayPose; tEnd: number }
  | { type: 'wait'; t: number; reason: string; duration: number }
  | { type: 'branch'; t: number; stepId: string; reason: string }
  | { type: 'escalation'; t: number; packetId: string }
  | { type: 'safe_hold'; t: number; activity: string }
  | { type: 'drill'; t: number }
  | { type: 'collect'; t: number }
  | { type: 'done'; t: number };

export interface ReplayRun {
  runId: string;
  mode: ReplayMode;
  seed: number;
  terrain: TerrainId;
  oneWayDelayMin: number;
  start: ReplayPose;
  events: ReplayEvent[];
}

export type ReplayActivity = 'idle' | 'driving' | 'waiting' | 'safe_hold' | 'drilling' | 'collecting' | 'done';

export interface ReplaySample {
  t: number;
  x: number;
  y: number;
  heading: number;
  state: ReplayActivity;
  waitRemaining: number | null;
}

export interface ComparisonOptions {
  oneWayDelayMin?: number;
  terrain?: TerrainId;
  plan?: unknown;
  maxMinutes?: number;
}

const DEFAULT_MAX_MIN = 500;
const MOVE_EPS = 1e-4;

function poseOf(sim: Sim): ReplayPose {
  const p = sim.rover.pose;
  return { x: p.x, y: p.y, heading: p.heading };
}

function moved(a: ReplayPose, b: ReplayPose): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > MOVE_EPS;
}

function lerpAngle(a: number, b: number, u: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * u;
}

function lerpPose(a: ReplayPose, b: ReplayPose, u: number): ReplayPose {
  const t = Math.min(1, Math.max(0, u));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    heading: lerpAngle(a.heading, b.heading, t),
  };
}

function stepIdOf(text: string): string | null {
  return text.startsWith('[') ? (text.match(/^\[([^\]]+)\]/)?.[1] ?? null) : null;
}

function bodyOf(text: string): string {
  return text.replace(/^\[[^\]]+\]\s*/, '');
}

/** Watches an already-running Sim. Does not change how the executor or baseline decide. */
class ReplayRecorder {
  readonly events: ReplayEvent[] = [];
  private logAt = 0;
  private lastPose: ReplayPose;
  private lastT: number;
  private wait: { t: number; reason: string } | null = null;
  private lastReason = 'escalation';
  private seenPackets = new Set<string>();

  constructor(private readonly sim: Sim) {
    this.lastPose = poseOf(sim);
    this.lastT = sim.now;
  }

  observe(): void {
    this.ingestLogs(this.sim.roverLog.slice(this.logAt));
    this.logAt = this.sim.roverLog.length;
    this.noteEscalation();
    this.noteMotion();
  }

  finish(): ReplayEvent[] {
    this.closeWait(this.sim.now);
    this.events.sort((a, b) => a.t - b.t);
    return this.events;
  }

  private ingestLogs(rows: LogEntry[]): void {
    for (const { t, text } of rows) {
      const stepId = stepIdOf(text);
      const body = bodyOf(text);

      if (body.startsWith('start drill')) this.events.push({ type: 'drill', t });
      if (body.startsWith('start collect_sample')) this.events.push({ type: 'collect', t });

      if (stepId && / → /.test(body) && !body.includes('no branch matches') && !body.startsWith('refused:')) {
        const then = body.split(' → ').at(-1) ?? body;
        if (then !== 'escalate') {
          this.lastReason = body;
          this.events.push({ type: 'branch', t, stepId, reason: body });
        } else {
          this.lastReason = body;
        }
      } else if (body.includes('no branch matches') || body.startsWith('refused:')) {
        this.lastReason = body;
      }

      if (body.startsWith('safe hold')) {
        const activity = body.includes('image') ? 'imaging' : 'holding';
        this.events.push({ type: 'safe_hold', t, activity });
        this.openWait(t, this.lastReason);
      }

      if (body.startsWith('Plan ') && body.includes(' loaded')) this.closeWait(t);
      if (body.includes(' complete')) {
        this.closeWait(t);
        this.events.push({ type: 'done', t });
      }
    }
  }

  private noteEscalation(): void {
    const packet = this.sim.executor.escalation;
    if (!packet) return;
    const packetId = `${packet.planId}:${packet.stepId}:${packet.simTime}`;
    if (this.seenPackets.has(packetId)) return;
    this.seenPackets.add(packetId);
    this.lastReason = packet.whatHappened;
    this.events.push({ type: 'escalation', t: packet.simTime, packetId });
  }

  private noteMotion(): void {
    const now = this.sim.now;
    const pose = poseOf(this.sim);
    if (moved(this.lastPose, pose) && now > this.lastT) {
      this.events.push({ type: 'drive', t: this.lastT, from: this.lastPose, to: pose, tEnd: now });
    }
    this.lastPose = pose;
    this.lastT = now;
  }

  private openWait(t: number, reason: string): void {
    if (!this.wait) this.wait = { t, reason };
  }

  private closeWait(t: number): void {
    if (!this.wait) return;
    const duration = Math.max(0, t - this.wait.t);
    this.events.push({ type: 'wait', t: this.wait.t, reason: this.wait.reason, duration });
    this.wait = null;
  }
}

function recordRun(sim: Sim, mode: ReplayMode, seed: number, terrain: TerrainId, maxMinutes: number): ReplayRun {
  const start = poseOf(sim);
  const recorder = new ReplayRecorder(sim);
  for (let t = 1; t <= maxMinutes; t++) {
    if (sim.ground.completionConfirmedAt !== null && sim.completedAt !== null) break;
    if (sim.ground.completionConfirmedAt === null) sim.stepTo(t);
    recorder.observe();
  }
  recorder.observe();
  return {
    runId: `${mode}:${seed}:${terrain}:${sim.link.oneWayDelayMin}`,
    mode,
    seed,
    terrain,
    oneWayDelayMin: sim.link.oneWayDelayMin,
    start,
    events: recorder.finish(),
  };
}

/**
 * Same seed, terrain and delay, existing side-by-side pair (baseline sequence vs contingency plan).
 * Later: accept the agent's median campaign run here instead of DEMO_PLAN / these defaults.
 */
export function getComparison(
  seed: number,
  {
    oneWayDelayMin = 8,
    terrain = 'jezero',
    plan = DEMO_PLAN,
    maxMinutes = DEFAULT_MAX_MIN,
  }: ComparisonOptions = {},
): { baseline: ReplayRun; envelope: ReplayRun } {
  const decisions = new Map<string, string>();
  const envelope = new Sim({
    seed,
    mode: 'contingency',
    autoOperator: true,
    decisions,
    oneWayDelayMin,
    terrain,
  });
  const baseline = new Sim({
    seed,
    mode: 'baseline',
    autoOperator: true,
    decisions,
    oneWayDelayMin,
    terrain,
  });
  envelope.start(plan);
  baseline.start(plan);
  return {
    baseline: recordRun(baseline, 'baseline', seed, terrain, maxMinutes),
    envelope: recordRun(envelope, 'envelope', seed, terrain, maxMinutes),
  };
}

export function sampleAt(run: ReplayRun, t: number): ReplaySample {
  const wait = run.events.find(
    (e): e is Extract<ReplayEvent, { type: 'wait' }> => e.type === 'wait' && e.t <= t && t < e.t + e.duration,
  );
  const drive = run.events.find(
    (e): e is Extract<ReplayEvent, { type: 'drive' }> => e.type === 'drive' && e.t <= t && t <= e.tEnd,
  );

  let pose = run.start;
  for (const e of run.events) {
    if (e.t > t) break;
    if (e.type === 'drive' && e.tEnd <= t) pose = e.to;
  }
  if (drive) {
    const span = drive.tEnd - drive.t;
    pose = lerpPose(drive.from, drive.to, span > 0 ? (t - drive.t) / span : 1);
  }

  return {
    t,
    x: pose.x,
    y: pose.y,
    heading: pose.heading,
    state: stateAt(run, t, Boolean(drive), Boolean(wait)),
    waitRemaining: wait ? wait.t + wait.duration - t : null,
  };
}

function stateAt(run: ReplayRun, t: number, driving: boolean, waiting: boolean): ReplayActivity {
  if (run.events.some((e) => e.type === 'done' && e.t <= t)) return 'done';
  if (driving) return 'driving';
  if (waiting) return 'waiting';
  let state: ReplayActivity = 'idle';
  for (const e of run.events) {
    if (e.t > t) break;
    if (e.type === 'safe_hold') state = 'safe_hold';
    if (e.type === 'drill') state = 'drilling';
    if (e.type === 'collect') state = 'collecting';
    if (e.type === 'done') state = 'done';
  }
  return state;
}
