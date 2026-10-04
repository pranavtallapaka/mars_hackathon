import type { TerrainId } from './types';
import { DEMO_PLAN } from './mars/mission';
import { Sim, type Metrics } from './sim';

export const BATCH_RUNS = 50;
export const BATCH_BASE_SEED = 1000;
const DEFAULT_MAX_MIN = 500;

export interface BatchOptions {
  runs?: number;
  baseSeed?: number;
  oneWayDelayMin?: number;
  terrain?: TerrainId;
  plan?: unknown;
  maxMinutes?: number;
}

export interface RunPair {
  seed: number;
  baseline: Metrics;
  ours: Metrics;
}

export interface MetricSpread {
  mean: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
}

export interface SideReport {
  roundTrips: MetricSpread;
  missionMin: MetricSpread;
  bytesDown: MetricSpread;
  escalations: MetricSpread;
  finished: number;
}

export interface BatchReport {
  runs: number;
  elapsedMs: number;
  pairs: RunPair[];
  baseline: SideReport;
  ours: SideReport;
  saved: { missionMin: number; roundTrips: number };
}

export function runPair(
  seed: number,
  {
    oneWayDelayMin = 8,
    terrain = 'jezero',
    plan = DEMO_PLAN,
    maxMinutes = DEFAULT_MAX_MIN,
  }: Omit<BatchOptions, 'runs' | 'baseSeed'> = {},
): RunPair {
  const decisions = new Map<string, string>();
  const ours = new Sim({
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
  ours.start(plan);
  baseline.start(plan);
  for (let t = 1; t <= maxMinutes; t++) {
    if (ours.ground.completionConfirmedAt === null) ours.stepTo(t);
    if (baseline.ground.completionConfirmedAt === null) baseline.stepTo(t);
    if (ours.ground.completionConfirmedAt !== null && baseline.ground.completionConfirmedAt !== null) break;
  }
  return { seed, baseline: baseline.metrics, ours: ours.metrics };
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

export function spread(values: number[]): MetricSpread {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
  return {
    mean,
    min: n ? sorted[0] : 0,
    max: n ? sorted[n - 1] : 0,
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  };
}

function side(pairs: RunPair[], pick: (p: RunPair) => Metrics): SideReport {
  const metrics = pairs.map(pick);
  return {
    roundTrips: spread(metrics.map((m) => m.roundTrips)),
    missionMin: spread(metrics.map((m) => m.missionMin)),
    bytesDown: spread(metrics.map((m) => m.bytesDown)),
    escalations: spread(metrics.map((m) => m.escalations)),
    finished: metrics.filter((m) => m.complete).length,
  };
}

export function summarize(pairs: RunPair[], elapsedMs: number): BatchReport {
  const baseline = side(pairs, (p) => p.baseline);
  const ours = side(pairs, (p) => p.ours);
  return {
    runs: pairs.length,
    elapsedMs,
    pairs,
    baseline,
    ours,
    saved: {
      missionMin: baseline.missionMin.mean - ours.missionMin.mean,
      roundTrips: baseline.roundTrips.mean - ours.roundTrips.mean,
    },
  };
}

/** Synchronous runner for tests and the agent. */
export function runBatch(opts: BatchOptions = {}): BatchReport {
  const runs = opts.runs ?? BATCH_RUNS;
  const baseSeed = opts.baseSeed ?? BATCH_BASE_SEED;
  const t0 = performance.now();
  const pairs: RunPair[] = [];
  for (let i = 0; i < runs; i++) pairs.push(runPair(baseSeed + i, opts));
  return summarize(pairs, performance.now() - t0);
}

/** Same as `runBatch`, yielding so the UI can show progress. */
export async function runBatchAsync(
  opts: BatchOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchReport> {
  const runs = opts.runs ?? BATCH_RUNS;
  const baseSeed = opts.baseSeed ?? BATCH_BASE_SEED;
  const t0 = performance.now();
  const pairs: RunPair[] = [];
  for (let i = 0; i < runs; i++) {
    pairs.push(runPair(baseSeed + i, opts));
    onProgress?.(i + 1, runs);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  return summarize(pairs, performance.now() - t0);
}
