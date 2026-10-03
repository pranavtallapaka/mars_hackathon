import {
  createPlanSchema,
  escalationPacketSchema,
  formatIssues,
  type EscalationPacket,
  type PlanSchema,
} from '../../../shared/plan';
import { MARS_SURFACE, type ScenarioDef } from '../../../shared/scenario';
import { DEFAULT_ONE_WAY_DELAY_MIN, DEMO_SEED, TELEMETRY_PERIOD_MIN, TICKS_PER_MIN } from './config';
import { Executor } from './executor';
import { DelayLink, type LinkMessage } from './link';
import { generateMap } from './map';
import { buildMarsMission, type MarsMission } from './mars/mission';
import { MarsRover } from './mars/rover';
import type { Downlink, RoverSnapshot, SimMap, Uplink } from './types';

const EPS = 1e-9;

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
  receivedAt: number;
  bytes: number;
}

/** Everything mission control knows. It only changes when a downlink message arrives. */
export interface GroundView {
  lastState: RoverSnapshot;
  receivedAt: number;
  uplinks: SentPlan[];
  escalations: ReceivedEscalation[];
}

export interface SimOptions {
  seed?: number;
  oneWayDelayMin?: number;
}

export type SendResult = { ok: true; bytes: number } | { ok: false; errors: string[] };

/** One mission world: map, rover, executor, delay link and ground view, stepped in fixed ticks up to the clock's time. */
export class Sim {
  readonly scenario: ScenarioDef = MARS_SURFACE;
  readonly planSchema: PlanSchema = createPlanSchema(MARS_SURFACE);
  readonly map: SimMap;
  readonly mission: MarsMission;
  readonly link: DelayLink<Uplink, Downlink>;
  readonly rover: MarsRover;
  readonly executor: Executor;
  readonly ground: GroundView;
  readonly groundLog: LogEntry[] = [];
  readonly roverLog: LogEntry[] = [];

  private ticks = 0;
  private lastTelemetryAt = 0;

  constructor({ seed = DEMO_SEED, oneWayDelayMin = DEFAULT_ONE_WAY_DELAY_MIN }: SimOptions = {}) {
    this.map = generateMap(seed);
    this.mission = buildMarsMission(this.map);
    this.link = new DelayLink(oneWayDelayMin);
    this.rover = new MarsRover(this.map, this.mission);
    this.executor = new Executor(this.scenario, this.rover, {
      log: (stepId, text) => this.roverLog.push({ t: this.now, text: stepId ? `[${stepId}] ${text}` : text }),
      escalate: (packet) => this.downlink({ kind: 'escalation', packet, state: this.snapshot() }),
      modeChanged: (mode) => {
        if (mode === 'complete' || mode === 'aborted') this.sendTelemetry();
      },
    });
    // Pre-mission knowledge: ground knows the start state at T+0.
    this.ground = { lastState: this.snapshot(), receivedAt: 0, uplinks: [], escalations: [] };
  }

  get now(): number {
    return this.ticks / TICKS_PER_MIN;
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

  /** Ground boundary: only a schema-valid plan is uplinked. */
  sendPlan(input: unknown): SendResult {
    const parsed = this.planSchema.safeParse(input);
    if (!parsed.success) {
      const errors = formatIssues(parsed.error);
      this.groundLog.push({ t: this.now, text: `Plan rejected before uplink: ${errors.join('; ')}` });
      return { ok: false, errors };
    }
    const plan = parsed.data;
    const msg = this.link.up.send({ kind: 'plan', plan }, this.now);
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
      text: `Uplinked plan ${plan.planId} v${plan.version} (${plan.steps.length} steps, ${msg.bytes} B), reaches rover in ${this.link.oneWayDelayMin} min`,
    });
    return { ok: true, bytes: msg.bytes };
  }

  stepTo(simTime: number): void {
    const target = Math.floor(simTime * TICKS_PER_MIN + 1e-6);
    while (this.ticks < target) {
      this.ticks++;
      this.tick(1 / TICKS_PER_MIN);
    }
  }

  private tick(dt: number): void {
    const now = this.now;
    for (const msg of this.link.up.takeDue(now)) this.receiveUplink(msg.payload);
    this.executor.tick(dt, now);
    if (now - this.lastTelemetryAt >= TELEMETRY_PERIOD_MIN - EPS) this.sendTelemetry();
    for (const msg of this.link.down.takeDue(now)) this.receiveDownlink(msg);
  }

  /** Rover boundary: re-validate whatever arrives before executing it. */
  private receiveUplink(payload: Uplink): void {
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

  private downlink(payload: Downlink): void {
    this.link.down.send(payload, this.now);
    this.lastTelemetryAt = this.now;
  }

  private sendTelemetry(): void {
    this.downlink({ kind: 'telemetry', state: this.snapshot() });
  }

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

    if (payload.kind === 'escalation') {
      // Ground boundary: never act on a malformed packet.
      const parsed = escalationPacketSchema.safeParse(payload.packet);
      if (!parsed.success) {
        this.groundLog.push({ t: now, text: `Malformed escalation packet dropped: ${formatIssues(parsed.error)[0]}` });
        return;
      }
      this.ground.escalations.push({ packet: parsed.data, receivedAt: now, bytes });
      this.groundLog.push({
        t: now,
        text: `ESCALATION from ${parsed.data.stepId} (${ago} min ago): ${parsed.data.whatHappened}`,
      });
      return;
    }

    const mode = this.ground.lastState.mode;
    if (mode !== prevMode && (mode === 'complete' || mode === 'aborted')) {
      this.groundLog.push({ t: now, text: `Rover reports plan ${payload.state.mode} (${ago} min ago)` });
    }
  }
}
