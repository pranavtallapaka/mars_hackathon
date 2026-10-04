import { missionContextId } from '../../../shared/envelope/concept';
import { loadMissionContext } from '../../../shared/envelope/context';
import {
  classifyTerrain,
  HANDWRITTEN_ENVELOPE,
  validateEnvelope,
  type Envelope,
  type EnvelopeLimits,
} from '../../../shared/envelope/schema';
import type { MissionConcept, MissionContext } from '../../../shared/envelope/types';
import { scoreEnvelope, type EnvelopeScore } from './score';
import type { CampaignFailure, CampaignOptions, CampaignReport } from './campaign';

export const AGENT_RUNS = 8;
export const AGENT_MAX_ITERATIONS = 5;
export const AGENT_MAX_RUNS = 64;
export const AGENT_TUNE_SEED = 2000;
export const AGENT_FINAL_SEED = 52_000;
const FLAT_EPS = 0.05;

export type AgentAction =
  | 'load_mission_context'
  | 'propose_envelope'
  | 'validate_envelope'
  | 'run_campaign'
  | 'get_failures'
  | 'widen'
  | 'tighten'
  | 'final_check'
  | 'stop';

export interface AgentLogEntry {
  seq: number;
  iteration: number;
  action: AgentAction;
  change: string;
  result: string;
}

export interface ProposeInput {
  ctx: MissionContext;
  current: Envelope | null;
  lastScore: EnvelopeScore | null;
  intent: 'start' | 'widen' | 'tighten';
  version: number;
}

export interface ProposeResult {
  envelope: Envelope;
  change: string;
  action: 'propose_envelope' | 'widen' | 'tighten';
  source: 'grok' | 'local';
}

export type ProposeFn = (input: ProposeInput) => Promise<ProposeResult>;

export interface AgentJobSnapshot {
  id: string;
  contextId: string;
  status: 'running' | 'done' | 'failed';
  iteration: number;
  budgetIterations: number;
  budgetRuns: number;
  runsUsed: number;
  bestEnvelopeKey: string;
  stopReason: string;
  accepted: boolean;
  score: number;
  unsafe: number;
  source: string;
}

export interface AgentEvent {
  job: AgentJobSnapshot;
  logs: AgentLogEntry[];
  envelope?: { envelope: Envelope; accepted: boolean; score: number; unsafe: number };
  campaign?: CampaignReport;
}

export interface AgentOptions {
  runs?: number;
  maxIterations?: number;
  maxRuns?: number;
  tuneSeed?: number;
  finalSeed?: number;
  propose?: ProposeFn;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}

export interface AgentReport {
  job: AgentJobSnapshot;
  contextId: string;
  best: Envelope | null;
  finalCheck: EnvelopeScore | null;
  logs: AgentLogEntry[];
  tuningSeeds: number[];
  finalSeed: number;
}

export function toolLoadMissionContext(concept: MissionConcept, horizonsText: string): MissionContext {
  return loadMissionContext(concept, horizonsText);
}

export function toolValidateEnvelope(input: unknown) {
  return validateEnvelope(input);
}

export function toolRunCampaign(envelope: Envelope, ctx: MissionContext, opts?: CampaignOptions): EnvelopeScore {
  return scoreEnvelope(envelope, ctx, opts);
}

export function toolGetFailures(score: EnvelopeScore): CampaignFailure[] {
  return score.failures;
}

function confidenceOf(escalateWhen: string[]): number {
  const entry = escalateWhen.find((e) => e.startsWith('confidence_below:'));
  return entry ? Number(entry.split(':')[1]) : 0.6;
}

function withConfidence(escalateWhen: string[], confidence: number): string[] {
  const clipped = Math.round(Math.min(0.95, Math.max(0.45, confidence)) * 100) / 100;
  return [...escalateWhen.filter((e) => !e.startsWith('confidence_below:')), `confidence_below:${clipped}`];
}

function clipFloor(n: number): number {
  return Math.min(55, Math.max(20, Math.round(n)));
}

function adjustCell(limits: EnvelopeLimits, escalateWhen: string[], dFloor: number, dConf: number) {
  return {
    limits: {
      batteryFloorPct: clipFloor(limits.batteryFloorPct + dFloor),
      noGoZones: limits.noGoZones.includes('sand-1') ? [...limits.noGoZones] : [...limits.noGoZones, 'sand-1'],
      irreversibleNeedsApproval: true,
    },
    escalateWhen: withConfidence(escalateWhen, confidenceOf(escalateWhen) + dConf),
  };
}

function mapEnvelope(env: Envelope, version: number, dFloor: number, dConf: number): Envelope {
  const defaults = adjustCell(env.defaults.limits, env.defaults.escalateWhen, dFloor, dConf);
  return {
    ...env,
    version,
    defaults,
    rules: env.rules.map((rule) => ({
      terrain: rule.terrain,
      comm: rule.comm,
      ...adjustCell(rule.limits, rule.escalateWhen, dFloor, dConf),
    })),
  };
}

function startingEnvelope(ctx: MissionContext): Envelope {
  return {
    ...HANDWRITTEN_ENVELOPE,
    envelopeId: `env-agent-${ctx.concept.siteId}`,
    version: 1,
    note: 'Started from the hand-written envelope. Not a certification.',
    defaults: {
      limits: { ...HANDWRITTEN_ENVELOPE.defaults.limits, noGoZones: [...HANDWRITTEN_ENVELOPE.defaults.limits.noGoZones] },
      escalateWhen: [...HANDWRITTEN_ENVELOPE.defaults.escalateWhen],
    },
    rules: HANDWRITTEN_ENVELOPE.rules.map((rule) => ({
      ...rule,
      limits: { ...rule.limits, noGoZones: [...rule.limits.noGoZones] },
      escalateWhen: [...rule.escalateWhen],
    })),
  };
}

/** Local tuner: start from the hand-written envelope, then widen or tighten by a small step. */
export function localPropose(input: ProposeInput): ProposeResult {
  if (input.intent === 'start' || !input.current) {
    return {
      envelope: startingEnvelope(input.ctx),
      change: `Started from the hand-written envelope for ${input.ctx.site.label}.`,
      action: 'propose_envelope',
      source: 'local',
    };
  }
  if (input.intent === 'tighten') {
    const reasons = [...new Set((input.lastScore?.failures ?? []).map((f) => f.reason))].join(', ') || 'unsafe outcome';
    return {
      envelope: mapEnvelope(input.current, input.version, 3, 0.05),
      change: `Tightened battery floor +3% and confidence after ${input.lastScore?.unsafe ?? 0} unsafe (${reasons}).`,
      action: 'tighten',
      source: 'local',
    };
  }
  return {
    envelope: mapEnvelope(input.current, input.version, -2, -0.05),
    change: `Widened battery floor −2% and confidence after 0 unsafe outcomes.`,
    action: 'widen',
    source: 'local',
  };
}

function envelopeKey(jobId: string, version: number): string {
  return `${jobId}:v${version}`;
}

function persistedScore(score: EnvelopeScore | null): number {
  if (!score || !score.accepted || score.score === null) return -1;
  return score.score;
}

/**
 * Propose → simulate → inspect → widen or tighten.
 * Stops on 0 unsafe + flattened improvement, or a budget. Final check uses a fresh seed.
 */
export async function runAgentJob(
  concept: MissionConcept,
  horizonsText: string,
  opts: AgentOptions = {},
): Promise<AgentReport> {
  const runs = opts.runs ?? AGENT_RUNS;
  const maxIterations = opts.maxIterations ?? AGENT_MAX_ITERATIONS;
  const maxRuns = opts.maxRuns ?? AGENT_MAX_RUNS;
  const tuneSeed = opts.tuneSeed ?? AGENT_TUNE_SEED;
  const finalSeed = opts.finalSeed ?? AGENT_FINAL_SEED;
  const propose = opts.propose ?? (async (input: ProposeInput) => localPropose(input));

  const contextId = missionContextId(concept);
  const jobId = contextId;
  const logs: AgentLogEntry[] = [];
  const tuningSeeds: number[] = [];
  let seq = 0;
  let source = 'local';
  let iteration = 0;
  let runsUsed = 0;
  let stopReason = '';
  let best: { envelope: Envelope; score: EnvelopeScore } | null = null;
  let prevAcceptedScore: number | null = null;

  const snapshot = (status: AgentJobSnapshot['status']): AgentJobSnapshot => ({
    id: jobId,
    contextId,
    status,
    iteration,
    budgetIterations: maxIterations,
    budgetRuns: maxRuns,
    runsUsed,
    bestEnvelopeKey: best ? envelopeKey(jobId, best.envelope.version) : '',
    stopReason,
    accepted: best?.score.accepted ?? false,
    score: persistedScore(best?.score ?? null),
    unsafe: best?.score.unsafe ?? 0,
    source,
  });

  const log = async (
    action: AgentAction,
    change: string,
    result: string,
    extra: { envelope?: Envelope; score?: EnvelopeScore; campaign?: CampaignReport | null } = {},
  ) => {
    seq += 1;
    logs.push({ seq, iteration, action, change, result });
    await opts.onEvent?.({
      job: snapshot('running'),
      logs: [...logs],
      envelope: extra.envelope
        ? {
            envelope: extra.envelope,
            accepted: extra.score?.accepted ?? false,
            score: persistedScore(extra.score ?? null),
            unsafe: extra.score?.unsafe ?? 0,
          }
        : undefined,
      campaign: extra.campaign ?? undefined,
    });
  };

  const ctx = toolLoadMissionContext(concept, horizonsText);
  const terrain = classifyTerrain(ctx.terrain);
  await log(
    'load_mission_context',
    `Loaded ${ctx.site.label}, ${ctx.concept.sols} sols from ${ctx.concept.startDate}.`,
    `terrain ${terrain} · delay ${ctx.sols[0]?.delayMin ?? 0}–${Math.max(...ctx.sols.map((s) => s.delayMin), 0)} min · ${ctx.sols.filter((s) => s.comm === 'conjunction').length} conjunction`,
  );

  const first = await propose({ ctx, current: null, lastScore: null, intent: 'start', version: 1 });
  source = first.source;
  let current = first.envelope;
  let checked = toolValidateEnvelope(current);
  await log('propose_envelope', first.change, checked.ok ? `v${current.version} passed schema` : checked.errors.join('; '));
  if (!checked.ok) {
    const fallback = localPropose({ ctx, current: null, lastScore: null, intent: 'start', version: 1 });
    current = fallback.envelope;
    checked = toolValidateEnvelope(current);
    source = `${first.source}+local`;
    await log('validate_envelope', fallback.change, checked.ok ? 'local fallback passed' : checked.errors.join('; '));
  } else {
    await log('validate_envelope', 'Same flight-rule check as plans.', 'ok');
  }
  if (!checked.ok) {
    stopReason = 'proposed envelope failed validation';
    await log('stop', stopReason, 'no campaign');
    const job = snapshot('failed');
    await opts.onEvent?.({ job, logs: [...logs] });
    return { job, contextId, best: null, finalCheck: null, logs, tuningSeeds, finalSeed };
  }

  let intent: 'widen' | 'tighten' = 'widen';

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    if (runsUsed + runs > maxRuns) {
      stopReason = `hit run budget (${runsUsed}/${maxRuns})`;
      break;
    }
    const seed = (tuneSeed + (iteration - 1) * 17) >>> 0;
    tuningSeeds.push(seed);
    const scored = toolRunCampaign(current, ctx, { runs, baseSeed: seed, iteration, envelope: current });
    runsUsed += runs;
    await log(
      'run_campaign',
      `Iteration ${iteration}, seed ${seed}, ${runs} campaigns.`,
      scored.accepted
        ? `score ${scored.score?.toFixed(1)} trips saved · 0 unsafe`
        : `rejected · ${scored.unsafe} unsafe`,
      { envelope: current, score: scored, campaign: scored.campaign },
    );
    const failures = toolGetFailures(scored);
    await log(
      'get_failures',
      failures.length ? `${failures.length} envelope-side failures` : 'No envelope-side failures.',
      failures.length
        ? [...new Set(failures.map((f) => `${f.reason} @ ${f.cellX},${f.cellY}`))].slice(0, 6).join(' · ')
        : '0 of N unsafe',
    );

    if (scored.accepted) {
      const scoreVal = scored.score ?? 0;
      if (!best || scoreVal > (best.score.score ?? 0) + 1e-9) {
        best = { envelope: current, score: scored };
        prevAcceptedScore = scoreVal;
        intent = 'widen';
      } else if (prevAcceptedScore !== null && scoreVal < prevAcceptedScore + FLAT_EPS) {
        stopReason = 'zero unsafe and improvement flattened';
        break;
      } else {
        prevAcceptedScore = scoreVal;
        intent = 'widen';
      }
    } else {
      intent = 'tighten';
    }

    if (iteration === maxIterations) {
      stopReason = stopReason || `hit iteration budget (${maxIterations})`;
      break;
    }
    if (runsUsed + runs > maxRuns) {
      stopReason = `hit run budget (${runsUsed}/${maxRuns})`;
      break;
    }

    const next = await propose({ ctx, current, lastScore: scored, intent, version: current.version + 1 });
    source = next.source === 'grok' || source === 'grok' ? 'grok' : source;
    const nextCheck = toolValidateEnvelope(next.envelope);
    await log(next.action, next.change, nextCheck.ok ? `v${next.envelope.version} valid` : nextCheck.errors.join('; '));
    if (!nextCheck.ok) {
      const local = localPropose({ ctx, current, lastScore: scored, intent, version: current.version + 1 });
      const localCheck = toolValidateEnvelope(local.envelope);
      await log('validate_envelope', local.change, localCheck.ok ? 'local fallback passed' : localCheck.errors.join('; '));
      if (!localCheck.ok) {
        stopReason = 'next envelope failed validation';
        break;
      }
      current = local.envelope;
    } else {
      current = next.envelope;
    }
  }

  if (!stopReason) stopReason = `hit iteration budget (${maxIterations})`;

  let finalCheck: EnvelopeScore | null = null;
  if (best) {
    if (runsUsed + runs <= maxRuns) {
      finalCheck = toolRunCampaign(best.envelope, ctx, {
        runs,
        baseSeed: finalSeed,
        iteration: iteration + 1,
        envelope: best.envelope,
      });
      runsUsed += runs;
      await log(
        'final_check',
        `Fresh seed ${finalSeed}, never used in tuning.`,
        finalCheck.accepted
          ? `0 unsafe · score ${finalCheck.score?.toFixed(1)}`
          : `${finalCheck.unsafe} unsafe on held-out seeds`,
        { envelope: best.envelope, score: finalCheck, campaign: finalCheck.campaign },
      );
      if (!finalCheck.accepted) {
        stopReason = 'final check found unsafe outcomes';
      }
    } else {
      await log('final_check', 'Skipped: no remaining run budget.', `used ${runsUsed}/${maxRuns}`);
    }
  }

  await log('stop', stopReason, best ? `best v${best.envelope.version}` : 'no accepted envelope');
  const job = snapshot('done');
  await opts.onEvent?.({ job, logs: [...logs] });
  return { job, contextId, best: best?.envelope ?? null, finalCheck, logs, tuningSeeds, finalSeed };
}
