import { formatClock } from '../format';
import type { ReceivedEscalation } from '../sim/sim';

export function EscalationView({ escalation }: { escalation: ReceivedEscalation }) {
  const { packet, receivedAt, bytes } = escalation;
  return (
    <div className="escalation">
      <div className="escalation-head">
        <h3>Escalation · {packet.stepId}</h3>
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
        {packet.options.map((o) => (
          <li key={o.id} className={o.id === packet.recommendation ? 'recommended' : ''}>
            <span className="mono">{o.id}</span> {o.label}
            <span className={`chip risk-${o.risk}`}>{o.risk} risk</span>
            <span className="muted small">{o.costMin} min</span>
            {o.id === packet.recommendation && <span className="chip rec">recommended</span>}
          </li>
        ))}
      </ul>
      <p className="muted small">Rover is in safe hold until it receives a decision.</p>
    </div>
  );
}
