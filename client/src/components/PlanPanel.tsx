import type { Plan } from '../../../shared/plan';
import { formatClock, formatMin } from '../format';
import { describeStep } from '../sim/executor';
import type { SentPlan, Sim } from '../sim/sim';

function uplinkStatus(u: SentPlan, now: number): string {
  switch (u.status) {
    case 'in_flight':
      return now < u.arrivesAt ? `in flight, arrives in ${formatMin(u.arrivesAt - now)}` : 'delivered, awaiting ack';
    case 'accepted':
      return `loaded ${formatClock(u.roverReceivedAt!)}, ack ${formatClock(u.ackReceivedAt!)}`;
    case 'rejected':
      return `rejected by rover: ${u.reason}`;
  }
}

export function PlanSteps({ plan, activeStepId = null }: { plan: Plan; activeStepId?: string | null }) {
  return (
    <ol className="steps">
      {plan.steps.map((step) => (
        <li key={step.id} className={step.id === activeStepId ? 'active' : ''}>
          <div className="step-line">
            <span className="mono step-id">{step.id}</span>
            <span className="mono">{describeStep(step)}</span>
            {step.irreversible && (
              <span className={step.approved ? 'chip warn' : 'chip bad'}>
                irreversible{step.approved ? ' · approved' : ' · NOT approved'}
              </span>
            )}
          </div>
          {step.branches.length > 0 && (
            <div className="branches">
              {step.branches.map((b) => (
                <span key={b.if} className="mono">
                  if {b.if} → {b.then}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function PlanLimits({ plan }: { plan: Plan }) {
  const { limits } = plan;
  return (
    <dl className="limits">
      <div><dt>Battery floor</dt><dd>{limits.batteryFloorPct}%</dd></div>
      <div><dt>No-go</dt><dd>{limits.noGoZones.join(', ') || 'none'}</dd></div>
      <div><dt>Escalate when</dt><dd>{plan.escalateWhen.join(', ') || 'any surprise'}</dd></div>
      <div><dt>Abort means</dt><dd>{plan.abort.behavior} → {plan.abort.to}</dd></div>
      <div><dt>While waiting</dt><dd>{plan.whileWaiting.join(', ') || 'nothing'}</dd></div>
    </dl>
  );
}

interface PlanPanelProps {
  sim: Sim;
  plan: Plan;
  /** Step the rover was on, as of the last downlink. */
  knownStepId: string | null;
}

export function PlanPanel({ sim, plan, knownStepId }: PlanPanelProps) {
  return (
    <div className="plan">
      <div className="plan-head">
        <h3>
          Current plan · {plan.planId} v{plan.version}
        </h3>
      </div>
      <p className="intent">“{plan.intent}”</p>
      <ol className="uplinks">
        {sim.ground.uplinks.map((u, i) => (
          <li key={`${u.planId}-${u.version}`} className="muted small">
            <span className="mono">#{i + 1}</span> v{u.version} sent {formatClock(u.sentAt)} · {u.bytes} B ·{' '}
            {uplinkStatus(u, sim.now)}
          </li>
        ))}
      </ol>
      <PlanSteps plan={plan} activeStepId={knownStepId} />
      <PlanLimits plan={plan} />
    </div>
  );
}
