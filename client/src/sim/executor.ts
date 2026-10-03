import {
  escalationPacketSchema,
  formatIssues,
  parseOutcome,
  type EscalationPacket,
  type Plan,
  type PlanStep,
} from '../../../shared/plan';
import type { ScenarioDef } from '../../../shared/scenario';

export type ConditionEvent = { type: 'condition'; condition: string; detail: string };
export type ViolationEvent = { type: 'violation'; detail: string };
export type StepEvent = { type: 'running' } | { type: 'done'; note?: string } | ConditionEvent | ViolationEvent;

export interface StepRun {
  tick(dt: number, now: number): StepEvent;
}

export type StepStart = { type: 'started'; run: StepRun; note: string } | ConditionEvent | ViolationEvent;

export interface EscalationContext {
  plan: Plan;
  step: PlanStep;
  reason: string;
  /** Null when the cause is an onboard hard-limit refusal rather than a sensed condition. */
  condition: string | null;
  now: number;
}

/** The scenario-specific body the executor drives. Mars implements it with a rover; Scenario B would use a lab. */
export interface ScenarioRuntime {
  start(step: PlanStep, plan: Plan, now: number): StepStart;
  stop(): void;
  /** Runs safe tasks during a hold; returns log lines for anything it did. */
  whileWaiting(tasks: readonly string[], dt: number, now: number): string[];
  startReturn(plan: Plan): StepStart;
  buildEscalation(ctx: EscalationContext): EscalationPacket;
}

export type ExecutorMode = 'idle' | 'executing' | 'safe_hold' | 'returning' | 'complete' | 'aborted';

export interface ExecutorEvents {
  log(stepId: string | null, text: string): void;
  escalate(packet: EscalationPacket): void;
  modeChanged(mode: ExecutorMode): void;
}

/**
 * Steps reached by a forward goto are contingencies: normal sequential flow skips them,
 * and after one finishes, flow resumes at the next non-contingency step.
 */
function contingencySteps(plan: Plan): Set<string> {
  const out = new Set<string>();
  plan.steps.forEach((step, i) => {
    for (const b of step.branches) {
      const o = parseOutcome(b.then);
      if (o.type !== 'goto') continue;
      const j = plan.steps.findIndex((s) => s.id === o.stepId);
      if (j > i) out.add(o.stepId);
    }
  });
  return out;
}

export function describeStep(step: PlanStep): string {
  const [main, ...others] = Object.entries(step.args);
  if (!main) return step.action;
  const extra = others.map(([k, v]) => `${k} ${v}`).join(', ');
  return extra ? `${step.action} ${main[1]} (${extra})` : `${step.action} ${main[1]}`;
}

/** Deterministic onboard executor. Every action traces to a plan step or branch; nothing is improvised. */
export class Executor {
  mode: ExecutorMode = 'idle';
  plan: Plan | null = null;
  escalation: EscalationPacket | null = null;

  private index = -1;
  private run: StepRun | null = null;
  private contingency = new Set<string>();

  constructor(
    private readonly scenario: ScenarioDef,
    private readonly runtime: ScenarioRuntime,
    private readonly events: ExecutorEvents,
  ) {}

  get currentStep(): PlanStep | null {
    return this.plan?.steps[this.index] ?? null;
  }

  load(plan: Plan): void {
    this.runtime.stop();
    this.plan = plan;
    this.escalation = null;
    this.run = null;
    this.contingency = contingencySteps(plan);
    this.index = 0;
    this.events.log(null, `Plan ${plan.planId} v${plan.version} loaded, ${plan.steps.length} steps`);
    this.setMode('executing');
  }

  tick(dt: number, now: number): void {
    switch (this.mode) {
      case 'executing':
        this.tickExecuting(dt, now);
        return;
      case 'safe_hold':
        for (const line of this.runtime.whileWaiting(this.plan!.whileWaiting, dt, now)) {
          this.events.log(this.currentStep?.id ?? null, line);
        }
        return;
      case 'returning':
        this.tickReturning(dt, now);
        return;
    }
  }

  private tickExecuting(dt: number, now: number): void {
    const step = this.currentStep!;
    if (this.run) {
      this.handle(step, this.run.tick(dt, now), now);
      return;
    }
    if (this.isIrreversible(step) && !step.approved) {
      this.handle(step, { type: 'violation', detail: `${describeStep(step)} is irreversible and not approved` }, now);
      return;
    }
    const start = this.runtime.start(step, this.plan!, now);
    if (start.type === 'started') {
      this.run = start.run;
      this.events.log(step.id, `start ${describeStep(step)}: ${start.note}`);
    } else {
      this.handle(step, start, now);
    }
  }

  private handle(step: PlanStep, ev: StepEvent, now: number): void {
    switch (ev.type) {
      case 'running':
        return;
      case 'done':
        this.events.log(step.id, ev.note ? `done: ${ev.note}` : 'done');
        this.advance();
        return;
      case 'violation':
        this.runtime.stop();
        this.events.log(step.id, `refused: ${ev.detail} (onboard hard limit) → escalate`);
        this.escalate(step, ev.detail, null, now);
        return;
      case 'condition':
        this.handleCondition(step, ev, now);
        return;
    }
  }

  private handleCondition(step: PlanStep, ev: ConditionEvent, now: number): void {
    this.runtime.stop();
    this.run = null;
    const branch = step.branches.find((b) => b.if === ev.condition);
    if (!branch) {
      this.events.log(step.id, `${ev.condition}: ${ev.detail} → no branch matches → escalate`);
      this.escalate(step, ev.detail, ev.condition, now);
      return;
    }

    this.events.log(step.id, `${ev.condition}: ${ev.detail} → ${branch.then}`);
    const outcome = parseOutcome(branch.then);
    switch (outcome.type) {
      case 'goto':
        this.index = this.plan!.steps.findIndex((s) => s.id === outcome.stepId);
        return;
      case 'skip':
        this.advance();
        return;
      case 'escalate':
        this.escalate(step, ev.detail, ev.condition, now);
        return;
      case 'abort':
        this.startReturn();
        return;
    }
  }

  private advance(): void {
    this.run = null;
    const steps = this.plan!.steps;
    let next = this.index + 1;
    while (next < steps.length && this.contingency.has(steps[next].id)) next++;
    this.index = next;
    if (next >= steps.length) {
      this.events.log(null, `Plan ${this.plan!.planId} complete`);
      this.setMode('complete');
    }
  }

  private escalate(step: PlanStep, reason: string, condition: string | null, now: number): void {
    this.run = null;
    const packet = this.runtime.buildEscalation({ plan: this.plan!, step, reason, condition, now });
    const parsed = escalationPacketSchema.safeParse(packet);
    this.setMode('safe_hold');
    const tasks = this.plan!.whileWaiting;
    this.events.log(step.id, `safe hold; while waiting: ${tasks.length ? tasks.join(', ') : 'nothing'}`);
    if (!parsed.success) {
      this.escalation = null;
      this.events.log(step.id, `escalation packet failed validation: ${formatIssues(parsed.error).join('; ')}`);
      return;
    }
    this.escalation = parsed.data;
    this.events.escalate(parsed.data);
  }

  private startReturn(): void {
    this.run = null;
    const start = this.runtime.startReturn(this.plan!);
    if (start.type === 'started') {
      this.run = start.run;
      this.events.log(null, `abort: ${start.note}`);
      this.setMode('returning');
    } else {
      this.events.log(null, `abort: cannot return (${start.detail}); stopped in place`);
      this.setMode('aborted');
    }
  }

  private tickReturning(dt: number, now: number): void {
    const ev = this.run!.tick(dt, now);
    if (ev.type === 'running') return;
    this.runtime.stop();
    this.run = null;
    this.events.log(null, ev.type === 'done' ? `abort complete: ${ev.note ?? 'returned'}` : `abort: return stopped (${ev.detail}); holding in place`);
    this.setMode('aborted');
  }

  private isIrreversible(step: PlanStep): boolean {
    return Boolean(step.irreversible) || this.scenario.irreversibleActions.includes(step.action);
  }

  private setMode(mode: ExecutorMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.events.modeChanged(mode);
  }
}
