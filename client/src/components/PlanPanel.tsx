import type { Plan } from '../../../shared/plan';
import { formatClock, formatMin } from '../format';
import { describeStep } from '../sim/executor';
import type { SentPlan, Sim } from '../sim/sim';

function uplinkStatus(u: SentPlan, now: number): string {
  switch (u.status) {
    case 'in_flight':
      return now < u.arrivesAt ? `uplink in flight, arrives in ${formatMin(u.arrivesAt - now)}` : 'delivered, awaiting ack';
    case 'accepted':
      return `loaded by rover at ${formatClock(u.roverReceivedAt!)}, ack received ${formatClock(u.ackReceivedAt!)}`;
    case 'rejected':
      return `rejected by rover: ${u.reason}`;
  }
}

interface PlanPanelProps {
  sim: Sim;
  plan: Plan;
  /** Step the rover was on, as of the last downlink. */
  knownStepId: string | null;
}

export function PlanPanel({ sim, plan, knownStepId }: PlanPanelProps) {
  const uplink = sim.ground.uplinks.find((u) => u.planId === plan.planId && u.version === plan.version);
  const { limits } = plan;

  return (
    <div className="plan">
      <div className="plan-head">
        <h3>
          Plan {plan.planId} v{plan.version}
        </h3>
        <button className="primary" disabled={Boolean(uplink)} onClick={() => sim.sendPlan(plan)}>
          {uplink ? 'Uplinked' : 'Uplink plan'}
        </button>
      </div>
      <p className="intent">“{plan.intent}”</p>
      {uplink && <p className="muted small">{uplinkStatus(uplink, sim.now)}</p>}

      <ol className="steps">
        {plan.steps.map((step) => (
          <li key={step.id} className={step.id === knownStepId ? 'active' : ''}>
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

      <dl className="limits">
        <div><dt>Battery floor</dt><dd>{limits.batteryFloorPct}%</dd></div>
        <div><dt>No-go</dt><dd>{limits.noGoZones.join(', ') || 'none'}</dd></div>
        <div><dt>Escalate when</dt><dd>{plan.escalateWhen.join(', ') || 'never'}</dd></div>
        <div><dt>Abort means</dt><dd>{plan.abort.behavior} → {plan.abort.to}</dd></div>
        <div><dt>While waiting</dt><dd>{plan.whileWaiting.join(', ') || 'nothing'}</dd></div>
      </dl>
    </div>
  );
}
