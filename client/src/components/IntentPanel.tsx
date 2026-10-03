import { useState } from 'react';
import type { CompileResult } from '../../../shared/compiler';
import { DEMO_INTENT } from '../../../shared/missions/mars-demo';
import { parseOutcome, type Plan } from '../../../shared/plan';
import { compileIntent } from '../api';
import { PlanLimits, PlanSteps } from './PlanPanel';

const SOURCE_LABEL: Record<CompileResult['source'], string> = {
  grok: 'Compiled by Grok',
  grok_retry: 'Compiled by Grok (after one retry)',
  cached: 'Cached known-good plan',
};

/** Everything that makes this plan call home, so the operator sees it before approving. */
function escalationTriggers(plan: Plan): string[] {
  const triggers = plan.steps.flatMap((s) =>
    s.branches.filter((b) => parseOutcome(b.then).type === 'escalate').map((b) => `${s.id}: ${b.if}`),
  );
  for (const e of plan.escalateWhen) {
    triggers.push(e === 'no_branch_matches' ? 'any condition with no branch' : e.replace(':', ' < '));
  }
  return triggers;
}

interface IntentPanelProps {
  started: boolean;
  onApprove: (plan: Plan) => void;
}

export function IntentPanel({ started, onApprove }: IntentPanelProps) {
  const [intent, setIntent] = useState(DEMO_INTENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompileResult | null>(null);

  const compile = async (useCached: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await compileIntent(intent, useCached));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const plan = result?.plan;

  return (
    <section className="intent-panel">
      <div className="intent-input">
        <h3>Mission control · intent</h3>
        <textarea
          value={intent}
          rows={2}
          disabled={started || busy}
          onChange={(e) => {
            setIntent(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && intent.trim()) void compile(false);
          }}
        />
        <div className="intent-actions">
          <button className="primary" disabled={started || busy || !intent.trim()} onClick={() => void compile(false)}>
            {busy ? 'Compiling…' : 'Compile with Grok'}
          </button>
          <button disabled={started || busy || !intent.trim()} onClick={() => void compile(true)}>
            Use cached plan
          </button>
          {error && <span className="bad small">{error}</span>}
        </div>
      </div>

      {plan && result && (
        <div className="preview">
          <div className="preview-head">
            <h3>Plan preview · {plan.planId} v{plan.version}</h3>
            <span className={`chip ${result.source === 'cached' ? 'warn' : 'source-grok'}`}>{SOURCE_LABEL[result.source]}</span>
          </div>
          {(result.fallbackReason || result.attempts.some((a) => !a.ok)) && (
            <ul className="attempts muted small">
              {result.attempts.map((a, i) => (
                <li key={i}>
                  Attempt {i + 1} ({(a.ms / 1000).toFixed(1)} s): {a.ok ? 'valid' : a.errors.slice(0, 3).join('; ')}
                </li>
              ))}
              {result.fallbackReason && <li>Fell back to the cached plan: {result.fallbackReason}.</li>}
            </ul>
          )}
          <PlanSteps plan={plan} />
          <div className="triggers">
            <span className="muted small">Calls home when</span>
            {escalationTriggers(plan).map((t) => (
              <span key={t} className="chip warn">
                {t}
              </span>
            ))}
          </div>
          <PlanLimits plan={plan} />
          <div className="intent-actions">
            <button className="primary" disabled={started} onClick={() => onApprove(plan)}>
              {started ? 'Approved and uplinked' : 'Approve & uplink'}
            </button>
            <span className="muted small">
              Ours gets this plan. The baseline gets the same steps with every branch stripped.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
