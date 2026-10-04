import type { PolicyOverlay } from '../sim/activeEnvelope';
import { formatConfidence } from '../sim/activeEnvelope';

const COMM_LABEL = {
  normal: 'normal comm',
  long_gap: 'long gap',
  conjunction: 'conjunction',
} as const;

interface PolicyCalloutProps {
  policy: PolicyOverlay;
}

/** The one sentence plus compiler → envelope numbers. This is the demo walk. */
export function PolicyCallout({ policy }: PolicyCalloutProps) {
  const batteryChanged = policy.battery.applied !== policy.battery.compiled;
  const confChanged = policy.confidence.applied !== policy.confidence.compiled;

  return (
    <aside className="policy-callout" aria-live="polite">
      <h3>This mission uses the envelope policy</h3>
      <p className="muted small">
        {policy.label} · {policy.terrainClass} terrain × {COMM_LABEL[policy.comm]} · {policy.delayMin} min one-way
      </p>
      <dl className="policy-diff">
        <div className={batteryChanged ? 'changed' : undefined}>
          <dt>Battery floor</dt>
          <dd>
            {policy.battery.applied}%
            {batteryChanged && <span className="was">compiler {policy.battery.compiled}%</span>}
          </dd>
        </div>
        <div className={confChanged ? 'changed' : undefined}>
          <dt>Call home if ID below</dt>
          <dd>
            {formatConfidence(policy.confidence.applied)}
            {confChanged && <span className="was">compiler {formatConfidence(policy.confidence.compiled)}</span>}
          </dd>
        </div>
      </dl>
      <p>{policy.useCase}</p>
    </aside>
  );
}
