import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { postCampaign } from '../api';
import { tables } from '../module_bindings';
import { CAMPAIGN_RUNS } from '../sim/campaign';
import type { MissionConcept } from '../../../shared/envelope/types';

interface CampaignPanelProps {
  concept: MissionConcept;
  contextId: string;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

export function CampaignPanel({ concept, contextId }: CampaignPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [results, resultsReady] = useTable(tables.campaignResult.where((r) => r.contextId.eq(contextId)));
  const [failures, failuresReady] = useTable(tables.failure.where((r) => r.contextId.eq(contextId)));

  const latest = useMemo(() => {
    const rows = [...results].sort((a, b) => b.iteration - a.iteration || a.side.localeCompare(b.side));
    const iteration = rows[0]?.iteration;
    if (iteration === undefined) return null;
    return {
      iteration,
      baseline: rows.find((r) => r.side === 'baseline' && r.iteration === iteration),
      envelope: rows.find((r) => r.side === 'envelope' && r.iteration === iteration),
    };
  }, [results]);

  const latestFailures = useMemo(() => {
    if (!latest) return [];
    return [...failures]
      .filter((f) => f.resultId.endsWith(`:${latest.iteration}:baseline`) || f.resultId.endsWith(`:${latest.iteration}:envelope`))
      .sort((a, b) => a.solIndex - b.solIndex || a.runIndex - b.runIndex);
  }, [failures, latest]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setPersistError(null);
    try {
      const result = await postCampaign({ ...concept, runs: CAMPAIGN_RUNS });
      if (!result.persisted) setPersistError(result.persistError ?? 'SpacetimeDB write failed');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const base = latest?.baseline;
  const ours = latest?.envelope;

  return (
    <section className="envelope-campaign">
      <div className="batch-head">
        <div>
          <h2>Campaign simulator</h2>
          <p className="muted small">
            {CAMPAIGN_RUNS} seeded campaigns through this window · cached plan · real delay, conjunction and daylight.
            Envelope here is the contingency plan; A3 will swap in a scored envelope.
          </p>
        </div>
        <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Running campaigns…' : `Run ${CAMPAIGN_RUNS} campaigns`}
        </button>
      </div>
      {error && <p className="bad small">{error}</p>}
      {persistError && <p className="bad small">{persistError}</p>}
      {!resultsReady || !failuresReady ? (
        <p className="muted small">Subscribing to campaign_result…</p>
      ) : base && ours ? (
        <div className="batch-body">
          <p className="batch-verdict">
            <strong>
              {fmt(base.meanRoundTrips - ours.meanRoundTrips, 1)} fewer trips · {ours.unsafe} / {ours.runs} envelope
              unsafe
            </strong>
          </p>
          <p className="muted small">
            {fmt(ours.elapsedMs / 1000, 1)} s · live subscription · iteration {ours.iteration}
          </p>
          <dl className="batch-stats">
            <div>
              <dt>Baseline trips</dt>
              <dd>{fmt(base.meanRoundTrips)}</dd>
            </div>
            <div>
              <dt>Envelope trips</dt>
              <dd>{fmt(ours.meanRoundTrips)}</dd>
            </div>
            <div>
              <dt>Blackout sols</dt>
              <dd>{ours.blackoutSols}</dd>
            </div>
            <div>
              <dt>Failures</dt>
              <dd>{latestFailures.length}</dd>
            </div>
          </dl>
          {latestFailures.length > 0 && (
            <div className="sol-table-wrap">
              <table className="sol-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Sol</th>
                    <th>Cell</th>
                    <th>Reason</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {latestFailures.slice(0, 20).map((f) => (
                    <tr key={String(f.id)}>
                      <td>{f.side}</td>
                      <td>{f.solIndex}</td>
                      <td>
                        {f.cellX},{f.cellY}
                      </td>
                      <td>{f.reason}</td>
                      <td>{f.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <p className="muted small">No campaign written yet. Run one to fill campaign_result and failure.</p>
      )}
    </section>
  );
}
