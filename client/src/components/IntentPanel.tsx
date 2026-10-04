import { useState } from 'react';
import type { CompileResult } from '../../../shared/compiler';
import { DEMO_INTENT, STAGED_UNSAFE_INTENT, STAGED_UNSAFE_PLAN } from '../../../shared/missions/mars-demo';
import { createPlanSchema, parseOutcome, type Plan } from '../../../shared/plan';
import { MARS_SURFACE } from '../../../shared/scenario';
import { compileIntent } from '../api';
import type { SendResult } from '../sim/sim';
import type { SafetyReport } from '../sim/validator';
import { PlanLimits, PlanSteps } from './PlanPanel';

type PreviewSource = CompileResult['source'] | 'staged';

const SOURCE_LABEL: Record<PreviewSource, string> = {
  grok: 'Compiled by Grok',
  grok_retry: 'Compiled by Grok (after one retry)',
  cached: 'Cached known-good plan',
  staged: 'Staged unsafe command (scripted)',
};

interface Preview {
  plan: Plan;
  source: PreviewSource;
  attempts: CompileResult['attempts'];
  fallbackReason?: string;
}

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
  checkPlan: (plan: Plan) => SafetyReport;
  onApprove: (plan: Plan) => SendResult;
}

export function IntentPanel({ started, checkPlan, onApprove }: IntentPanelProps) {
  const [intent, setIntent] = useState(DEMO_INTENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const show = (next: Preview | null) => {
    setPreview(next);
    setSendResult(null);
  };

  const compile = async (useCached: boolean) => {
    setBusy(true);
    setError(null);
    try {
      show(await compileIntent(intent, useCached));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadStaged = () => {
    setIntent(STAGED_UNSAFE_INTENT);
    setError(null);
    show({ plan: createPlanSchema(MARS_SURFACE).parse(STAGED_UNSAFE_PLAN), source: 'staged', attempts: [] });
  };

  const plan = preview?.plan;
  const safety = plan ? checkPlan(plan) : null;
  const blocked = sendResult && !sendResult.ok;

  return (
    <section className="intent-panel">
      <div className="intent-input">
        <h3>Mission control · intent</h3>
        <textarea
          value={intent}
          rows={3}
          disabled={started || busy}
          onChange={(e) => {
            setIntent(e.target.value);
            show(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && intent.trim()) void compile(false);
          }}
        />
        <p className="muted small">Type the intent. Cmd/Ctrl+Enter compiles with Grok.</p>
        <div className="intent-actions">
          <button className="primary" disabled={started || busy || !intent.trim()} onClick={() => void compile(false)}>
            {busy ? 'Compiling…' : 'Compile with Grok'}
          </button>
          <button disabled={started || busy || !intent.trim()} onClick={() => void compile(true)}>
            Use cached plan
          </button>
          <button className="danger" disabled={started || busy} onClick={loadStaged}>
            Staged unsafe command
          </button>
          {error && <span className="bad small">{error}</span>}
        </div>
      </div>

      {plan && preview && safety && (
        <div className="preview">
          <div className="preview-head">
            <h3>Plan preview · {plan.planId} v{plan.version}</h3>
            <span className={`chip ${preview.source === 'staged' ? 'bad' : preview.source === 'cached' ? '' : 'source-grok'}`}>
              {SOURCE_LABEL[preview.source]}
            </span>
          </div>
          {(preview.fallbackReason || preview.attempts.some((a) => !a.ok)) && (
            <ul className="attempts muted small">
              {preview.attempts.map((a, i) => (
                <li key={i}>
                  Attempt {i + 1} ({(a.ms / 1000).toFixed(1)} s): {a.ok ? 'valid' : a.errors.slice(0, 3).join('; ')}
                </li>
              ))}
              {preview.fallbackReason && <li>Fell back to the cached plan: {preview.fallbackReason}.</li>}
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

          <div className={safety.ok ? 'safety ok' : 'safety fail'}>
            <strong>{safety.ok ? 'Safety validator: passes' : 'Safety validator: will block this plan'}</strong>
            <span className="muted small">
              {' '}
              · forecast {safety.forecast.endBatteryPct}% battery at the end, ~{safety.forecast.minutes} min nominal
            </span>
            {!safety.ok && (
              <ul>
                {safety.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="intent-actions">
            <button
              className="primary"
              disabled={started || Boolean(blocked)}
              onClick={() => {
                setSendResult(onApprove(plan));
              }}
            >
              {started ? 'Approved and uplinked' : blocked ? 'Blocked before uplink' : 'Approve & uplink'}
            </button>
            <span className={blocked ? 'bad small' : 'muted small'}>
              {blocked
                ? 'Nothing was sent. Counted under "Unsafe blocked". Fix the intent and compile again.'
                : 'Ours gets this plan. The baseline gets the same steps with every branch stripped.'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
