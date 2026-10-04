import type { MissionContext, SolState } from '../../../shared/envelope/types';
import { DEMO_PLAN } from './mars/mission';
import { cellAt, zoneAt } from './grid';
import { Sim, type Metrics, type SimMode } from './sim';
import type { TerrainId } from './types';

export const CAMPAIGN_RUNS = 50;
export const CAMPAIGN_BASE_SEED = 2000;
const DEFAULT_MAX_MIN = 500;

export type CampaignSide = 'baseline' | 'envelope';
export type FailureReason = 'hazard' | 'no_go' | 'battery_floor' | 'irreversible' | 'stuck';

export interface CampaignOptions {
  runs?: number;
  baseSeed?: number;
  plan?: unknown;
  iteration?: number;
}

export interface CampaignFailure {
  runIndex: number;
  seed: number;
  solIndex: number;
  cellX: number;
  cellY: number;
  reason: FailureReason;
  detail: string;
  side: CampaignSide;
}

export interface SolOutcome {
  solIndex: number;
  skipped: 'blackout' | 'night' | null;
  seed: number;
  metrics: Metrics | null;
  failures: CampaignFailure[];
}

export interface CampaignRun {
  runIndex: number;
  seed: number;
  side: CampaignSide;
  sols: SolOutcome[];
  operationalSols: number;
  blackoutSols: number;
  nightSols: number;
  finished: boolean;
  roundTrips: number;
  missionMin: number;
  bytesDown: number;
  escalations: number;
  failures: CampaignFailure[];
}

export interface CampaignSideReport {
  side: CampaignSide;
  runs: number;
  finished: number;
  unsafe: number;
  blackoutSols: number;
  nightSols: number;
  operationalSols: number;
  meanRoundTrips: number;
  meanMissionMin: number;
  meanBytesDown: number;
  meanEscalations: number;
}

export interface CampaignReport {
  contextId: string;
  iteration: number;
  runs: number;
  sols: number;
  elapsedMs: number;
  seed: number;
  baseline: CampaignSideReport;
  envelope: CampaignSideReport;
  failures: CampaignFailure[];
  runsPerMin: number;
}

export function campaignTerrain(ctx: MissionContext): TerrainId {
  return ctx.terrain.site.terrainKind === 'hirise' ? 'jezero' : 'synthetic';
}

export function mixSeed(base: number, solIndex: number): number {
  return (Math.imul(base >>> 0, 1664525) + (solIndex + 1) * 1013904223) >>> 0;
}

export function solMaxMinutes(sol: SolState): number {
  const daylightMin = Math.round(sol.daylightHours * 60);
  if (daylightMin <= 0) return 0;
  return Math.min(DEFAULT_MAX_MIN, daylightMin);
}

function modeFor(side: CampaignSide): SimMode {
  return side === 'envelope' ? 'contingency' : 'baseline';
}

export function inspectUnsafe(
  sim: Sim,
  side: CampaignSide,
  runIndex: number,
  seed: number,
  solIndex: number,
): CampaignFailure[] {
  const pos = sim.rover.pos;
  const base = { runIndex, seed, solIndex, cellX: pos.x, cellY: pos.y, side };
  const found: CampaignFailure[] = [];
  const zone = zoneAt(sim.map, pos);
  if (zone) {
    found.push({ ...base, reason: 'no_go', detail: `ended in no-go ${zone.id}` });
  } else if (cellAt(sim.map, pos) === 'rock') {
    found.push({ ...base, reason: 'hazard', detail: 'ended on a rock cell' });
  }
  const floor = sim.executor.plan?.limits.batteryFloorPct ?? 30;
  if (sim.rover.batteryPct < floor) {
    found.push({
      ...base,
      reason: 'battery_floor',
      detail: `battery ${sim.rover.batteryPct.toFixed(1)}% below floor ${floor}%`,
    });
  }
  if (sim.roverLog.some((e) => e.text.includes('irreversible and not approved'))) {
    found.push({ ...base, reason: 'irreversible', detail: 'irreversible action without approval' });
  }
  const mode = sim.executor.mode;
  if (!sim.metrics.complete && (mode === 'safe_hold' || mode === 'aborted' || mode === 'executing' || mode === 'idle')) {
    found.push({ ...base, reason: 'stuck', detail: `unfinished (${mode})` });
  }
  return found;
}

function runSolMission(
  sol: SolState,
  side: CampaignSide,
  runIndex: number,
  runSeed: number,
  terrain: TerrainId,
  plan: unknown,
  decisions: Map<string, string>,
): SolOutcome {
  if (sol.comm === 'conjunction') {
    return { solIndex: sol.solIndex, skipped: 'blackout', seed: runSeed, metrics: null, failures: [] };
  }
  const maxMinutes = solMaxMinutes(sol);
  if (maxMinutes <= 0) {
    return { solIndex: sol.solIndex, skipped: 'night', seed: runSeed, metrics: null, failures: [] };
  }
  const seed = mixSeed(runSeed, sol.solIndex);
  const sim = new Sim({
    seed,
    mode: modeFor(side),
    autoOperator: true,
    decisions,
    oneWayDelayMin: sol.delayMin,
    terrain,
  });
  sim.start(plan);
  for (let t = 1; t <= maxMinutes; t++) {
    if (sim.ground.completionConfirmedAt !== null) break;
    sim.stepTo(t);
  }
  const failures = inspectUnsafe(sim, side, runIndex, seed, sol.solIndex);
  return { solIndex: sol.solIndex, skipped: null, seed, metrics: sim.metrics, failures };
}

export function runCampaign(
  ctx: MissionContext,
  side: CampaignSide,
  runIndex: number,
  {
    baseSeed = CAMPAIGN_BASE_SEED,
    plan = DEMO_PLAN,
  }: Pick<CampaignOptions, 'baseSeed' | 'plan'> = {},
): CampaignRun {
  const runSeed = (baseSeed + runIndex) >>> 0;
  const terrain = campaignTerrain(ctx);
  const decisions = new Map<string, string>();
  const sols: SolOutcome[] = [];
  for (const sol of ctx.sols) {
    sols.push(runSolMission(sol, side, runIndex, runSeed, terrain, plan, decisions));
  }
  const operational = sols.filter((s) => s.skipped === null);
  const failures = sols.flatMap((s) => s.failures);
  return {
    runIndex,
    seed: runSeed,
    side,
    sols,
    operationalSols: operational.length,
    blackoutSols: sols.filter((s) => s.skipped === 'blackout').length,
    nightSols: sols.filter((s) => s.skipped === 'night').length,
    finished: operational.length > 0 && operational.every((s) => s.metrics?.complete),
    roundTrips: operational.reduce((n, s) => n + (s.metrics?.roundTrips ?? 0), 0),
    missionMin: operational.reduce((n, s) => n + (s.metrics?.missionMin ?? 0), 0),
    bytesDown: operational.reduce((n, s) => n + (s.metrics?.bytesDown ?? 0), 0),
    escalations: operational.reduce((n, s) => n + (s.metrics?.escalations ?? 0), 0),
    failures,
  };
}

export function runCampaignPair(
  ctx: MissionContext,
  runIndex: number,
  opts?: Pick<CampaignOptions, 'baseSeed' | 'plan'>,
): { baseline: CampaignRun; envelope: CampaignRun } {
  return {
    baseline: runCampaign(ctx, 'baseline', runIndex, opts),
    envelope: runCampaign(ctx, 'envelope', runIndex, opts),
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sideReport(side: CampaignSide, runs: CampaignRun[]): CampaignSideReport {
  return {
    side,
    runs: runs.length,
    finished: runs.filter((r) => r.finished).length,
    unsafe: runs.filter((r) => r.failures.length > 0).length,
    blackoutSols: runs.reduce((n, r) => n + r.blackoutSols, 0),
    nightSols: runs.reduce((n, r) => n + r.nightSols, 0),
    operationalSols: runs.reduce((n, r) => n + r.operationalSols, 0),
    meanRoundTrips: mean(runs.map((r) => r.roundTrips)),
    meanMissionMin: mean(runs.map((r) => r.missionMin)),
    meanBytesDown: mean(runs.map((r) => r.bytesDown)),
    meanEscalations: mean(runs.map((r) => r.escalations)),
  };
}

export function summarizeCampaigns(
  ctx: MissionContext,
  pairs: { baseline: CampaignRun; envelope: CampaignRun }[],
  elapsedMs: number,
  opts: { baseSeed: number; iteration: number },
): CampaignReport {
  const baseline = pairs.map((p) => p.baseline);
  const envelope = pairs.map((p) => p.envelope);
  const missionSols = pairs.reduce((n, p) => n + p.baseline.operationalSols + p.envelope.operationalSols, 0);
  const minutes = elapsedMs / 60_000;
  return {
    contextId: `${ctx.concept.siteId}:${ctx.concept.startDate}:${ctx.concept.sols}`,
    iteration: opts.iteration,
    runs: pairs.length,
    sols: ctx.sols.length,
    elapsedMs,
    seed: opts.baseSeed,
    baseline: sideReport('baseline', baseline),
    envelope: sideReport('envelope', envelope),
    failures: [...baseline, ...envelope].flatMap((r) => r.failures),
    runsPerMin: minutes > 0 ? missionSols / minutes : 0,
  };
}

export function runCampaignRange(
  ctx: MissionContext,
  from: number,
  to: number,
  opts: Pick<CampaignOptions, 'baseSeed' | 'plan'> = {},
): { baseline: CampaignRun; envelope: CampaignRun }[] {
  const pairs: { baseline: CampaignRun; envelope: CampaignRun }[] = [];
  for (let i = from; i < to; i++) pairs.push(runCampaignPair(ctx, i, opts));
  return pairs;
}

export function runCampaignBatch(ctx: MissionContext, opts: CampaignOptions = {}): CampaignReport {
  const runs = opts.runs ?? CAMPAIGN_RUNS;
  const baseSeed = opts.baseSeed ?? CAMPAIGN_BASE_SEED;
  const iteration = opts.iteration ?? 0;
  const t0 = performance.now();
  const pairs = runCampaignRange(ctx, 0, runs, { baseSeed, plan: opts.plan });
  return summarizeCampaigns(ctx, pairs, performance.now() - t0, { baseSeed, iteration });
}
