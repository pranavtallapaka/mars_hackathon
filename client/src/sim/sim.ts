import {
  createPlanSchema,
  escalationPacketSchema,
  formatIssues,
  parseOutcome,
  type EscalationPacket,
  type Plan,
  type PlanSchema,
} from '../../../shared/plan';
import { MARS_DEMO_BRIEFING, type FlightRules } from '../../../shared/missions/mars-demo';
import { MARS_SURFACE, type ScenarioDef } from '../../../shared/scenario';
import {
  DEFAULT_ONE_WAY_DELAY_MIN,
  DEMO_SEED,
  OPERATOR_DECISION_MIN,
  TELEMETRY_PERIOD_MIN,
  TICKS_PER_MIN,
} from './config';
import { Executor } from './executor';
import { DelayLink, type LinkMessage } from './link';
import { createMap } from './map';
import { amendPlan, nominalFlow, toConventional } from './mars/amend';
import { buildMarsMission, DEMO_PLAN, type MarsMission } from './mars/mission';
import { parseOptionLabel } from './mars/options';
import { MarsRover } from './mars/rover';
import type { Downlink, RoverSnapshot, SimMap, TerrainId, Uplink } from './types';
import { checkPlanSafety, type SafetyReport } from './validator';
import { REAL_IMAGE_BYTES, sceneBytes } from '../../../shared/scene';

const EPS = 1e-9;
const BASELINE_PLAN_ID = 'b-001';

export interface LogEntry {
  t: number;
  text: string;
}

export interface SentPlan {
  planId: string;
  version: number;
  sentAt: number;
  arrivesAt: number;
  bytes: number;
  status: 'in_flight' | 'accepted' | 'rejected';
  reason?: string;
  roverReceivedAt?: number;
  ackReceivedAt?: number;
}

export interface ReceivedEscalation {
  packet: EscalationPacket;
  condition: string | null;
  receivedAt: number;
  bytes: number;
}

export interface ImageRequest {
  stepId: string;
  sentAt: number;
  receivedAt: number | null;
  upBytes: number;
  downBytes: number;
}

/** Everything mission control knows. It only changes when a downlink message arrives. */
export interface GroundView {
  lastState: RoverSnapshot;
  receivedAt: number;
  currentPlan: Plan | null;
  uplinks: SentPlan[];
  escalations: ReceivedEscalation[];
  imageRequests: ImageRequest[];
  blockedBeforeUplink: number;
  lastBlocked: { at: number; planId: string; version: number; reasons: string[] } | null;
  completionConfirmedAt: number | null;
}

/** Operator choices keyed by `${stepId}|${condition}`, shared so the baseline makes the same call ours did. */
export type DecisionBook = Map<string, string>;

export const decisionKey = (stepId: string, condition: string | null) => `${stepId}|${condition ?? 'violation'}`;

/**
 * `contingency` is our system: one plan with branches, escalate only when no branch fits.
 * `baseline` mirrors real rover ops (Build decisions §2): a sequence with no contingencies,
 * so any surprise means stop and wait a full round trip for a new sequence.
 */
export type SimMode = 'contingency' | 'baseline';

export interface SimOptions {
  seed?: number;
  oneWayDelayMin?: number;
  mode?: SimMode;
  /** Scripted mission control answers stops itself; otherwise a human answers with `decide()`. */
  autoOperator?: boolean;
  /** Think time charged per decision, scripted or human, so both panes pay the same. */
  decisionMin?: number;
  decisions?: DecisionBook;
  /** Off only to test the rover's onboard limits on plans the ground would have blocked. */
  groundSafetyCheck?: boolean;
  /** `jezero` loads the HiRISE heightmap; tests keep the default synthetic map. */
  terrain?: TerrainId;
}

export interface Metrics {
  missionMin: number;
  complete: boolean;
  completedAt: number | null;
  confirmedAt: number | null;
  roundTrips: number;
  bytesUp: number;
  bytesDown: number;
  escalations: number;
  unsafeBlocked: number;
}

export type SendResult = { ok: true; bytes: number } | { ok: false; errors: string[]; unsafe: boolean };

/** One mission world: map, rover, executor, delay link and ground view, stepped in fixed ticks up to the clock's time. */
export class Sim {
  readonly scenario: ScenarioDef = MARS_SURFACE;
  readonly planSchema: PlanSchema = createPlanSchema(MARS_SURFACE);
  readonly mode: SimMode;
  readonly map: SimMap;
  readonly mission: MarsMission;
  readonly link: DelayLink<Uplink, Downlink>;
  readonly rover: MarsRover;
  readonly executor: Executor;
  readonly ground: GroundView;
  readonly groundLog: LogEntry[] = [];
  readonly roverLog: LogEntry[] = [];
  startedAt: number | null = null;
  completedAt: number | null = null;

  autoOperator: boolean;
  /** Escalation waiting on a human click (only when `autoOperator` is off). */
  awaitingDecision: ReceivedEscalation | null = null;
  readonly decisionMin: number;
  readonly flightRules: FlightRules = MARS_DEMO_BRIEFING.flightRules;

  private readonly decisions: DecisionBook;
  private readonly groundSafetyCheck: boolean;
  private ticks = 0;
  private lastTelemetryAt = 0;
  private pendingDecision: { at: number; escalation: ReceivedEscalation; optionId: string } | null = null;
  private holdRequested = false;
  /** Baseline only: the contingency plan the baseline operator reasons from when replanning. */
  private shadowPlan: Plan | null = null;

  constructor({
    seed = DEMO_SEED,
    oneWayDelayMin = DEFAULT_ONE_WAY_DELAY_MIN,
    mode = 'contingency',
    autoOperator = false,
    decisionMin = OPERATOR_DECISION_MIN,
    decisions = new Map(),
    groundSafetyCheck = true,
    terrain = 'synthetic',
  }: SimOptions = {}) {
    this.groundSafetyCheck = groundSafetyCheck;
    this.mode = mode;
    this.autoOperator = autoOperator;
    this.decisionMin = decisionMin;
    this.decisions = decisions;
    this.map = createMap(seed, terrain);
    this.mission = buildMarsMission(this.map, seed);
    this.link = new DelayLink(oneWayDelayMin);
    this.rover = new MarsRover(this.map, this.mission);
    this.executor = new Executor(this.scenario, this.rover, {
      log: (stepId, text) => this.roverLog.push({ t: this.now, text: stepId ? `[${stepId}] ${text}` : text }),
      escalate: (packet, condition) => this.downlink({ kind: 'escalation', packet, condition, state: this.snapshot() }),
      modeChanged: (m) => {
        if (m === 'complete') this.completedAt ??= this.now;
        if (m === 'complete' || m === 'aborted') this.sendTelemetry();
      },
    });
    // Pre-mission knowledge: ground knows the start state at T+0.
    this.ground = {
      lastState: this.snapshot(),
      receivedAt: 0,
      currentPlan: null,
      uplinks: [],
      escalations: [],
      imageRequests: [],
      blockedBeforeUplink: 0,
      lastBlocked: null,
      completionConfirmedAt: null,
    };
  }

  /** The pre-uplink safety check, run against what the ground last heard from the rover. */
  checkSafety(plan: Plan): SafetyReport {
    const { pos, batteryPct, discovered } = this.ground.lastState;
    return checkPlanSafety(
      plan,
      this.map,
      this.flightRules,
      { pos, batteryPct, knownObstacles: discovered },
      this.scenario.irreversibleActions,
    );
  }

  /**
   * Ask the rover for the real camera frame. Costs an uplink now and REAL_IMAGE_BYTES
   * one delay later; counts as a round trip. Decisions still use the structured scene.
   */
  requestImage(stepId: string): boolean {
    const esc = this.ground.escalations.find((e) => e.packet.stepId === stepId);
    if (!esc || this.ground.imageRequests.some((r) => r.stepId === stepId)) return false;
    const msg = this.link.up.send({ kind: 'image_request', planId: esc.packet.planId, stepId }, this.now);
    this.ground.imageRequests.push({ stepId, sentAt: this.now, receivedAt: null, upBytes: msg.bytes, downBytes: 0 });
    this.groundLog.push({
      t: this.now,
      text: `Requested camera frame for ${stepId} (${msg.bytes} B up). Description was ${sceneBytes(esc.packet.scene)} B; the frame is ${REAL_IMAGE_BYTES} B.`,
    });
    return true;
  }

  /** The operator's one-click answer to the escalation on screen. */
  decide(optionId: string): void {
    const escalation = this.awaitingDecision;
    if (!escalation || !escalation.packet.options.some((o) => o.id === optionId)) return;
    this.awaitingDecision = null;
    this.pendingDecision = { at: this.now + this.decisionMin, escalation, optionId };
  }

  /** The answer being drafted, if one is scheduled to go up. */
  get pendingAnswer(): { at: number; optionId: string } | null {
    return this.pendingDecision && { at: this.pendingDecision.at, optionId: this.pendingDecision.optionId };
  }

  get now(): number {
    return this.ticks / TICKS_PER_MIN;
  }

  get metrics(): Metrics {
    const end = this.completedAt ?? this.now;
    return {
      missionMin: this.startedAt === null ? 0 : end - this.startedAt,
      complete: this.completedAt !== null,
      completedAt: this.completedAt,
      confirmedAt: this.ground.completionConfirmedAt,
      roundTrips: this.ground.uplinks.length + this.ground.imageRequests.length,
      bytesUp: this.link.up.totalBytes,
      bytesDown: this.link.down.totalBytes,
      escalations: this.ground.escalations.length,
      unsafeBlocked: this.ground.blockedBeforeUplink,
    };
  }

  snapshot(): RoverSnapshot {
    const plan = this.executor.plan;
    return {
      simTime: this.now,
      pos: { ...this.rover.pos },
      batteryPct: Math.round(this.rover.batteryPct * 10) / 10,
      mode: this.executor.mode,
      planId: plan?.planId ?? null,
      planVersion: plan?.version ?? null,
      stepId: this.executor.currentStep?.id ?? null,
      activity: this.rover.activity,
      imagesTaken: this.rover.imagesTaken,
      discovered: this.rover.discovered.map((p) => ({ ...p })),
    };
  }

  /** Uplinks the approved mission: the contingency plan, or the same steps with no contingencies for the baseline. */
  start(input: unknown = DEMO_PLAN): SendResult {
    if (this.mode === 'contingency') return this.sendPlan(input);
    const parsed = this.planSchema.safeParse(input);
    if (!parsed.success) return this.sendPlan(input);
    this.shadowPlan = parsed.data;
    return this.sendPlan(toConventional(parsed.data, nominalFlow(parsed.data), BASELINE_PLAN_ID, 1));
  }

  /** Ground boundary: only a schema-valid plan that passes the safety validator is uplinked. */
  sendPlan(input: unknown): SendResult {
    const parsed = this.planSchema.safeParse(input);
    if (!parsed.success) {
      const errors = formatIssues(parsed.error);
      this.ground.blockedBeforeUplink++;
      this.groundLog.push({ t: this.now, text: `Plan rejected before uplink: ${errors.join('; ')}` });
      return { ok: false, errors, unsafe: false };
    }
    const plan = parsed.data;
    const safety = this.checkSafety(plan);
    if (this.groundSafetyCheck && !safety.ok) {
      this.ground.blockedBeforeUplink++;
      this.ground.lastBlocked = { at: this.now, planId: plan.planId, version: plan.version, reasons: safety.reasons };
      this.groundLog.push({
        t: this.now,
        text: `BLOCKED before uplink: ${plan.planId} v${plan.version}. ${safety.reasons.join(' ')}`,
      });
      return { ok: false, errors: safety.reasons, unsafe: true };
    }
    const msg = this.link.up.send({ kind: 'plan', plan }, this.now);
    this.startedAt ??= this.now;
    this.ground.currentPlan = plan;
    this.ground.uplinks.push({
      planId: plan.planId,
      version: plan.version,
      sentAt: this.now,
      arrivesAt: msg.deliverAt,
      bytes: msg.bytes,
      status: 'in_flight',
    });
    this.groundLog.push({
      t: this.now,
      text: `Uplinked ${plan.planId} v${plan.version} (${plan.steps.length} steps, ${msg.bytes} B), reaches rover in ${this.link.oneWayDelayMin} min`,
    });
    return { ok: true, bytes: msg.bytes };
  }

  /** Returns true if it stopped early because an escalation now needs the operator. */
  stepTo(simTime: number): boolean {
    const target = Math.floor(simTime * TICKS_PER_MIN + 1e-6);
    while (this.ticks < target) {
      this.ticks++;
      this.tick(1 / TICKS_PER_MIN);
      if (this.holdRequested) {
        this.holdRequested = false;
        return true;
      }
    }
    return false;
  }

  private tick(dt: number): void {
    const now = this.now;
    for (const msg of this.link.up.takeDue(now)) this.receiveUplink(msg.payload);
    this.executor.tick(dt, now);
    if (now - this.lastTelemetryAt >= TELEMETRY_PERIOD_MIN - EPS) this.sendTelemetry();
    for (const msg of this.link.down.takeDue(now)) this.receiveDownlink(msg);
    if (this.pendingDecision && now >= this.pendingDecision.at - EPS) this.executeDecision();
  }

  // --- rover side ------------------------------------------------------------

  /** Rover boundary: re-validate whatever arrives before executing it. */
  private receiveUplink(payload: Uplink): void {
    if (payload.kind === 'image_request') {
      this.rover.imagesTaken++;
      this.roverLog.push({ t: this.now, text: `Downlinking camera frame for ${payload.stepId} (${REAL_IMAGE_BYTES} B)` });
      this.downlink(
        { kind: 'image', planId: payload.planId, stepId: payload.stepId, bytes: REAL_IMAGE_BYTES, state: this.snapshot() },
        REAL_IMAGE_BYTES,
      );
      return;
    }
    const parsed = this.planSchema.safeParse(payload.plan);
    const { planId, version } = payload.plan;
    if (!parsed.success) {
      const reason = formatIssues(parsed.error)[0];
      this.roverLog.push({ t: this.now, text: `Plan ${planId} v${version} failed onboard validation: ${reason}` });
      this.downlink({ kind: 'ack', planId, version, ok: false, reason, state: this.snapshot() });
      return;
    }
    this.executor.load(parsed.data);
    this.downlink({ kind: 'ack', planId, version, ok: true, state: this.snapshot() });
  }

  private downlink(payload: Downlink, bytes?: number): void {
    this.link.down.send(payload, this.now, bytes);
    this.lastTelemetryAt = this.now;
  }

  private sendTelemetry(): void {
    this.downlink({ kind: 'telemetry', state: this.snapshot() });
  }

  // --- ground side -----------------------------------------------------------

  private receiveDownlink({ payload, bytes }: LinkMessage<Downlink>): void {
    const now = this.now;
    const prevMode = this.ground.lastState.mode;
    if (payload.state.simTime >= this.ground.lastState.simTime) {
      this.ground.lastState = payload.state;
      this.ground.receivedAt = now;
    }
    const ago = Math.round(now - payload.state.simTime);

    if (payload.kind === 'ack') {
      const sent = this.ground.uplinks.find((u) => u.planId === payload.planId && u.version === payload.version);
      if (!sent) return;
      sent.status = payload.ok ? 'accepted' : 'rejected';
      sent.reason = payload.reason;
      sent.roverReceivedAt = payload.state.simTime;
      sent.ackReceivedAt = now;
      this.groundLog.push({
        t: now,
        text: payload.ok
          ? `Ack: rover loaded ${payload.planId} v${payload.version} ${ago} min ago`
          : `Ack: rover rejected ${payload.planId} v${payload.version} ${ago} min ago (${payload.reason})`,
      });
      return;
    }

    if (payload.kind === 'image') {
      const req = this.ground.imageRequests.find((r) => r.stepId === payload.stepId && r.receivedAt === null);
      if (req) {
        req.receivedAt = now;
        req.downBytes = bytes;
      }
      this.groundLog.push({ t: now, text: `Camera frame for ${payload.stepId} arrived (${bytes} B)` });
      if (this.awaitingDecision) this.holdRequested = true;
      return;
    }

    if (payload.kind === 'escalation') {
      // Ground boundary: never act on a malformed packet.
      const parsed = escalationPacketSchema.safeParse(payload.packet);
      if (!parsed.success) {
        this.groundLog.push({ t: now, text: `Malformed escalation packet dropped: ${formatIssues(parsed.error)[0]}` });
        return;
      }
      const escalation = { packet: parsed.data, condition: payload.condition, receivedAt: now, bytes };
      this.ground.escalations.push(escalation);
      this.groundLog.push({
        t: now,
        text: `${this.mode === 'baseline' ? 'STOPPED' : 'ESCALATION'} at ${parsed.data.stepId} (${ago} min ago): ${parsed.data.whatHappened}`,
      });
      if (this.autoOperator) {
        this.pendingDecision = { at: now + this.decisionMin, escalation, optionId: parsed.data.recommendation };
      } else {
        this.awaitingDecision = escalation;
        this.holdRequested = true;
      }
      return;
    }

    const mode = this.ground.lastState.mode;
    if (mode !== prevMode && (mode === 'complete' || mode === 'aborted')) {
      if (mode === 'complete') this.ground.completionConfirmedAt ??= now;
      this.groundLog.push({ t: now, text: `Rover reports plan ${mode} (${ago} min ago)` });
    }
  }

  private executeDecision(): void {
    const { escalation, optionId } = this.pendingDecision!;
    this.pendingDecision = null;
    let plan =
      this.mode === 'contingency' ? this.answerEscalation(escalation, optionId) : this.replanBaseline(escalation);
    if (!plan && this.autoOperator) {
      const skip = escalation.packet.options.find((o) => parseOptionLabel(o.label)?.kind === 'skip_step');
      if (skip) {
        plan =
          this.mode === 'contingency' ? this.answerEscalation(escalation, skip.id) : this.replanBaseline(escalation, skip.id);
      }
    }
    if (!plan && this.autoOperator && this.ground.currentPlan) {
      const cur = this.ground.currentPlan;
      const version = cur.version + 1;
      plan = {
        ...cur,
        version,
        intent: `${cur.intent} (amended: end plan)`,
        steps: [{ id: `v${version}end`, action: 'hold', args: { minutes: 1 }, branches: [] }],
      };
      this.groundLog.push({ t: this.now, text: `Operator: nothing left to amend at ${escalation.packet.stepId}; closing the plan` });
    }
    if (!plan) {
      this.groundLog.push({ t: this.now, text: `Operator: no amendment possible for ${escalation.packet.stepId}; rover keeps holding` });
      return;
    }
    if (!this.sendPlan(plan).ok && !this.autoOperator) {
      // The validator refused that answer; the rover is still holding, so ask again.
      this.awaitingDecision = escalation;
      this.holdRequested = true;
    }
  }

  /** Our system: one reply. The chosen option becomes a plan amendment. */
  private answerEscalation({ packet, condition }: ReceivedEscalation, optionId: string): Plan | null {
    const option = packet.options.find((o) => o.id === optionId)!;
    const rec = option.id === packet.recommendation ? ' (recommended)' : '';
    this.groundLog.push({ t: this.now, text: `Operator picks ${option.id}${rec}: ${option.label}` });
    this.decisions.set(decisionKey(packet.stepId, condition), option.label);
    return amendPlan(this.ground.currentPlan!, packet, option.id);
  }

  /**
   * Baseline: the operator makes the same decision our contingency plan would have made,
   * only one round trip later. That keeps the comparison about timing, not judgment.
   */
  private replanBaseline({ packet, condition }: ReceivedEscalation, forceOptionId?: string): Plan | null {
    const shadow = this.shadowPlan!;
    const current = this.ground.currentPlan!;
    const version = current.version + 1;
    const step = shadow.steps.find((s) => s.id === packet.stepId);
    const branch = step?.branches.find((b) => b.if === condition);
    const outcome = branch ? parseOutcome(branch.then) : ({ type: 'escalate' } as const);
    const resequence = (from: Plan, steps: Plan['steps']) => toConventional(from, steps, current.planId, version);

    switch (outcome.type) {
      case 'goto':
        this.groundLog.push({ t: this.now, text: `Operator replans: ${condition} at ${packet.stepId}, resume from ${outcome.stepId}` });
        return resequence(shadow, nominalFlow(shadow, outcome.stepId));
      case 'skip': {
        const steps = nominalFlow(shadow, packet.stepId).slice(1);
        this.groundLog.push({ t: this.now, text: `Operator replans: skip ${packet.stepId}` });
        return steps.length ? resequence(shadow, steps) : null;
      }
      case 'abort': {
        const back = packet.options.find((o) => parseOptionLabel(o.label)?.kind === 'return_to');
        const amended = back ? amendPlan(shadow, packet, back.id) : null;
        this.groundLog.push({ t: this.now, text: `Operator replans: abort at ${packet.stepId}` });
        return amended ? resequence(amended, amended.steps) : null;
      }
      case 'escalate': {
        // Same call our operator made at this point, if they've made it; otherwise the rover's recommendation.
        const chosen = this.decisions.get(decisionKey(packet.stepId, condition));
        const option =
          (forceOptionId ? packet.options.find((o) => o.id === forceOptionId) : undefined) ??
          packet.options.find((o) => o.label === chosen) ??
          packet.options.find((o) => o.id === packet.recommendation)!;
        let amended = amendPlan(shadow, packet, option.id);
        if (!amended) {
          const skip = packet.options.find((o) => parseOptionLabel(o.label)?.kind === 'skip_step');
          if (skip) amended = amendPlan(shadow, packet, skip.id);
        }
        if (!amended) return null;
        this.shadowPlan = amended;
        this.groundLog.push({
          t: this.now,
          text: `Operator replans: ${option.label}${chosen === option.label ? ' (same call as ours)' : ''}`,
        });
        return resequence(amended, nominalFlow(amended));
      }
    }
  }
}
