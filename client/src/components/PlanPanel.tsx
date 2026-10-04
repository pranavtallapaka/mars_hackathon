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
            <span className="data step-id">{step.id}</span>
            <span className="data">{describeStep(step)}</span>
            {step.irreversible && (
              <span className={step.approved ? 'chip warn' : 'chip bad'}>
                irreversible{step.approved ? ' · approved' : ' · NOT approved'}
              </span>
            )}
          </div>
          {step.branches.length > 0 && (
            <div className="branches">
              {step.branches.map((b) => (
                <span key={b.if} className="data">
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

export function PlanLimits({ plan, compiled }: { plan: Plan; compiled?: Plan }) {
  const { limits } = plan;
  const floorChanged = compiled !== undefined && compiled.limits.batteryFloorPct !== limits.batteryFloorPct;
  const escalateChanged = compiled !== undefined && compiled.escalateWhen.join() !== plan.escalateWhen.join();
  return (
    <dl className="limits">
      <div className={floorChanged ? 'from-envelope' : undefined}>
        <dt>Battery floor{floorChanged ? ' · from envelope' : ''}</dt>
        <dd>
          {limits.batteryFloorPct}%
          {floorChanged && <span className="was">compiler {compiled.limits.batteryFloorPct}%</span>}
        </dd>
      </div>
      <div><dt>No-go</dt><dd>{limits.noGoZones.join(', ') || 'none'}</dd></div>
      <div className={escalateChanged ? 'from-envelope' : undefined}>
        <dt>Escalate when{escalateChanged ? ' · from envelope' : ''}</dt>
        <dd>
          {plan.escalateWhen.join(', ') || 'any surprise'}
          {escalateChanged && <span className="was">compiler {compiled.escalateWhen.join(', ')}</span>}
        </dd>
      </div>
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
  fromEnvelope?: boolean;
}

export function PlanPanel({ sim, plan, knownStepId, fromEnvelope = false }: PlanPanelProps) {
  return (
    <div className="plan">
      <div className="plan-head">
        <h3>
          Current plan · {plan.planId} v{plan.version}
        </h3>
        {fromEnvelope && <span className="chip source-grok">Envelope policy</span>}
      </div>
      <p className="intent">“{plan.intent}”</p>
      <ol className="uplinks">
        {sim.ground.uplinks.map((u, i) => (
          <li key={`${u.planId}-${u.version}`} className="muted small">
            <span className="data">#{i + 1}</span> v{u.version} sent {formatClock(u.sentAt)} · {u.bytes} B ·{' '}
            {uplinkStatus(u, sim.now)}
          </li>
        ))}
      </ol>
      <PlanSteps plan={plan} activeStepId={knownStepId} />
      <PlanLimits plan={plan} />
    </div>
  );
}
