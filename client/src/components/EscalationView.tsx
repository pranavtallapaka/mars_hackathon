import { formatClock } from '../format';
import type { ReceivedEscalation } from '../sim/sim';

interface EscalationViewProps {
  escalation: ReceivedEscalation;
  title?: string;
  /** When mission control sent its answer, if it has. */
  answeredAt?: number;
  /** Present while the operator can answer with one click. */
  onDecide?: (optionId: string) => void;
  decisionMin?: number;
  /** The answer being drafted, before it goes up. */
  pending?: { at: number; optionId: string } | null;
  /** Why the validator refused the last answer, if it did. */
  blockedReasons?: string[];
}

export function EscalationView({
  escalation,
  title = 'Escalation',
  answeredAt,
  onDecide,
  decisionMin,
  pending,
  blockedReasons,
}: EscalationViewProps) {
  const { packet, receivedAt, bytes } = escalation;
  const awaiting = Boolean(onDecide);

  let status: string;
  if (awaiting) status = `Clock paused for your decision. Your answer is charged ${decisionMin} sim min, the same as the baseline's operator.`;
  else if (pending) status = `Drafting ${pending.optionId} as a plan amendment; uplinks at ${formatClock(pending.at)}.`;
  else if (answeredAt !== undefined) status = `Answered ${formatClock(answeredAt)}; rover held safely until the answer arrived.`;
  else status = 'Rover is in safe hold until it receives a decision.';

  return (
    <div className={awaiting ? 'escalation awaiting' : 'escalation'}>
      <div className="escalation-head">
        <h3>
          {title} · {packet.stepId}
        </h3>
        <span className="muted small">
          sent {formatClock(packet.simTime)} · received {formatClock(receivedAt)} · {bytes} B
        </span>
      </div>
      <p className="what">{packet.whatHappened}</p>
      <div className="scene">
        <span className="muted small">Scene (structured, from rover)</span>
        <ul>
          {packet.scene.objects.map((o) => (
            <li key={o}>{o}</li>
          ))}
          <li>slope {packet.scene.slopeDeg}°</li>
          <li>{packet.scene.terrain}</li>
        </ul>
      </div>
      <ul className="options">
        {packet.options.map((o) => {
          const rec = o.id === packet.recommendation;
          const chosen = pending?.optionId === o.id;
          const body = (
            <>
              <span className="mono">{o.id}</span> <span className="label">{o.label}</span>
              <span className={`chip risk-${o.risk}`}>{o.risk} risk</span>
              <span className="muted small">{o.costMin} min</span>
              {rec && <span className="chip rec">recommended</span>}
              {chosen && <span className="chip source-grok">chosen</span>}
            </>
          );
          return (
            <li key={o.id} className={rec ? 'recommended' : ''}>
              {onDecide ? (
                <button className="option-btn" onClick={() => onDecide(o.id)}>
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
      {blockedReasons && blockedReasons.length > 0 && (
        <div className="blocked small">
          <strong>Answer blocked before uplink:</strong> {blockedReasons.join(' ')}
        </div>
      )}
      <p className="muted small">{status}</p>
    </div>
  );
}
