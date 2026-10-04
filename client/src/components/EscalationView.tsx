import { useEffect, useState } from 'react';
import { RECONSTRUCTION_LABEL, formatDataBytes, sceneBytes, REAL_IMAGE_BYTES, type ReconstructionResult } from '../../../shared/scene';
import { reconstructScene } from '../api';
import { formatClock } from '../format';
import type { ImageRequest, ReceivedEscalation } from '../sim/sim';

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
  /** Present on the operator's pane: request the real camera frame. */
  onRequestImage?: (stepId: string) => void;
  imageRequest?: ImageRequest;
}

const SOURCE_LABEL: Record<ReconstructionResult['source'], string> = {
  grok: 'Grok Imagine',
  cache: 'cached',
  unavailable: 'unavailable',
};

export function EscalationView({
  escalation,
  title = 'Escalation',
  answeredAt,
  onDecide,
  decisionMin,
  pending,
  blockedReasons,
  onRequestImage,
  imageRequest,
}: EscalationViewProps) {
  const { packet, receivedAt, bytes } = escalation;
  const awaiting = Boolean(onDecide);
  const descBytes = sceneBytes(packet.scene);
  const cheaper = Math.round(REAL_IMAGE_BYTES / Math.max(descBytes, 1));

  const [recon, setRecon] = useState<ReconstructionResult | null>(null);
  const [frame, setFrame] = useState<ReconstructionResult | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRecon(null);
    setFrame(null);
    setReconError(null);
    void reconstructScene(packet.scene)
      .then((r) => {
        if (cancelled) return;
        setRecon(r);
        if (r.source !== 'unavailable' && onRequestImage) {
          void reconstructScene(packet.scene, 'frame').then((f) => !cancelled && setFrame(f));
        }
      })
      .catch((err) => {
        if (!cancelled) setReconError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [packet.planId, packet.stepId, packet.simTime, onRequestImage]);

  let status: string;
  if (awaiting) status = `Clock paused for your decision. Your answer is charged ${decisionMin} sim min, the same as the baseline's operator.`;
  else if (pending) status = `Drafting ${pending.optionId} as a plan amendment; uplinks at ${formatClock(pending.at)}.`;
  else if (answeredAt !== undefined) status = `Answered ${formatClock(answeredAt)}; rover held safely until the answer arrived.`;
  else status = 'Rover is in safe hold until it receives a decision.';

  const frameArrived = imageRequest?.receivedAt !== null && imageRequest?.receivedAt !== undefined;

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

      <div className="recon">
        {recon?.url ? (
          <img src={recon.url} alt="" className="recon-img" />
        ) : (
          <div className="recon-img placeholder">
            {reconError || recon?.reason ? `Reconstruction unavailable. ${reconError ?? recon?.reason}` : 'Reconstructing scene on the ground…'}
          </div>
        )}
        <p className="recon-label">
          {RECONSTRUCTION_LABEL}
          {recon && <span className="chip">{SOURCE_LABEL[recon.source]}</span>}
        </p>
        <p className="bytes-compare data">
          Scene description {formatDataBytes(descBytes)} · camera frame {formatDataBytes(REAL_IMAGE_BYTES)} · {cheaper.toLocaleString()}× cheaper
        </p>
        <p className="muted small">Decisions use the structured scene, never the picture.</p>
        {onRequestImage && !imageRequest && (
          <button type="button" onClick={() => onRequestImage(packet.stepId)}>
            Request real image
          </button>
        )}
        {imageRequest && !frameArrived && (
          <p className="muted small">Camera frame in flight. Costs one round trip and {formatDataBytes(REAL_IMAGE_BYTES)} down.</p>
        )}
        {frameArrived && (
          <div className="camera-frame">
            {frame?.url ? (
              <img src={frame.url} alt="" className="recon-img" />
            ) : (
              <div className="recon-img placeholder">Camera frame received. {formatDataBytes(imageRequest.downBytes)}</div>
            )}
            <p className="recon-label">
              Camera frame (simulated downlink) · {formatDataBytes(imageRequest.downBytes)} · arrived {formatClock(imageRequest.receivedAt!)}
            </p>
          </div>
        )}
      </div>

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
              <span className="data">{o.id}</span> <span className="label">{o.label}</span>
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
