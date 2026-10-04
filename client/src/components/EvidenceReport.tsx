import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { postActiveEnvelope } from '../api';
import { tables } from '../module_bindings';
import { envelopeWindowLabel } from '../sim/activeEnvelope';
import { buildEvidenceExport, confidenceOf, limitsSetBy } from '../sim/evidence';
import { parseEnvelope, type Envelope } from '../../../shared/envelope/schema';
import type { SiteId } from '../../../shared/envelope/types';

interface EvidenceReportProps {
  contextId: string;
  siteId: SiteId;
  startDate: string;
  sols: number;
}

function parseStored(json: string): Envelope | null {
  try {
    return parseEnvelope(JSON.parse(json));
  } catch {
    return null;
  }
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function EvidenceReport({ contextId, siteId, startDate, sols }: EvidenceReportProps) {
  const [jobs] = useTable(tables.agentJob.where((r) => r.contextId.eq(contextId)));
  const [envelopes] = useTable(tables.envelope.where((r) => r.jobId.eq(contextId)));
  const [results] = useTable(tables.campaignResult.where((r) => r.contextId.eq(contextId)));
  const [failures] = useTable(tables.failure.where((r) => r.contextId.eq(contextId)));
  const [logs] = useTable(tables.agentLog);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingControl, setLoadingControl] = useState(false);

  const job = useMemo(() => [...jobs].sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))[0], [jobs]);
  const stored = useMemo(
    () => (job?.bestEnvelopeKey ? [...envelopes].find((e) => e.id === job.bestEnvelopeKey) : undefined),
    [envelopes, job],
  );
  const envelope = stored ? parseStored(stored.json) : null;
  const pair = useMemo(() => {
    const rows = [...results].sort((a, b) => b.iteration - a.iteration);
    const iteration = rows[0]?.iteration;
    if (iteration === undefined) return null;
    return {
      iteration,
      baseline: rows.find((r) => r.side === 'baseline' && r.iteration === iteration),
      envelope: rows.find((r) => r.side === 'envelope' && r.iteration === iteration),
    };
  }, [results]);
  const envelopeFailures = useMemo(
    () => [...failures].filter((f) => f.side === 'envelope'),
    [failures],
  );
  const causes = useMemo(() => limitsSetBy(envelopeFailures), [envelopeFailures]);
  const logRows = useMemo(
    () =>
      [...logs]
        .filter((row) => row.jobId === contextId || row.contextId === contextId)
        .sort((a, b) => a.seq - b.seq),
    [logs, contextId],
  );

  if (!job && !pair) {
    return (
      <section className="envelope-report">
        <h2>Evidence report</h2>
        <p className="muted small">Run the agent to produce an envelope and the numbers behind it.</p>
      </section>
    );
  }

  const base = pair?.baseline;
  const ours = pair?.envelope;
  const tripsSaved = base && ours ? base.meanRoundTrips - ours.meanRoundTrips : job?.score;
  const minSaved = base && ours ? base.meanMissionMin - ours.meanMissionMin : null;
  const unsafe = ours?.unsafe ?? job?.unsafe ?? 0;
  const runs = ours?.runs ?? 0;
  const accepted = (ours ? ours.unsafe === 0 : job?.accepted) ?? false;

  const exportReport = () => {
    downloadJson(
      `envelope-${contextId.replaceAll(':', '-')}.json`,
      buildEvidenceExport({
        contextId,
        envelope,
        score:
          tripsSaved === undefined || tripsSaved === null
            ? null
            : { accepted, tripsSaved, unsafe, runs },
        limitsSetBy: causes,
        logs: logRows.map((row) => ({
          seq: row.seq,
          action: row.action,
          change: row.change,
          result: row.result,
        })),
      }),
    );
  };

  return (
    <section className="envelope-report">
      <div className="batch-head">
        <div>
          <h2>Evidence report</h2>
          <p className="muted small">
            Round trips and sols saved vs conventional ops. Not a certification — the sim is simplified.
          </p>
        </div>
        <div className="report-actions no-print">
          <button
            type="button"
            className="primary"
            disabled={!stored || !envelope || loadingControl}
            onClick={() => {
              if (!stored || !envelope) return;
              setLoadingControl(true);
              setLoadError(null);
              void postActiveEnvelope({
                envelopeKey: stored.id,
                envelopeId: stored.envelopeId,
                version: stored.version,
                label: envelopeWindowLabel(siteId, startDate, sols, stored.version),
                json: stored.json,
                contextId,
              })
                .then(() => {
                  window.location.hash = 'control';
                })
                .catch((err) => {
                  setLoadError((err as Error).message);
                  setLoadingControl(false);
                });
            }}
          >
            {loadingControl ? 'Loading…' : 'Load policy into mission control'}
          </button>
          <button type="button" onClick={exportReport} disabled={!envelope && !pair}>
            Export JSON
          </button>
          <button type="button" onClick={() => window.print()}>
            Print report
          </button>
        </div>
      </div>
      {loadError && <p className="bad small">{loadError}</p>}
      <p className="batch-verdict">
        <strong>
          {accepted
            ? `${Number(tripsSaved ?? 0).toFixed(1)} fewer trips · ${unsafe} of ${runs || 0} unsafe`
            : `Rejected · ${unsafe} unsafe`}
        </strong>
      </p>
      <dl className="batch-stats">
        <div>
          <dt>Baseline trips</dt>
          <dd>{base ? base.meanRoundTrips.toFixed(1) : '—'}</dd>
        </div>
        <div>
          <dt>Envelope trips</dt>
          <dd>{ours ? ours.meanRoundTrips.toFixed(1) : '—'}</dd>
        </div>
        <div>
          <dt>Mission min saved</dt>
          <dd>{minSaved !== null ? minSaved.toFixed(0) : '—'}</dd>
        </div>
        <div>
          <dt>Envelope</dt>
          <dd>
            {stored ? `v${stored.version}` : '—'}
          </dd>
        </div>
      </dl>
      {envelope && (
        <div className="sol-table-wrap">
          <table className="sol-table">
            <thead>
              <tr>
                <th>Terrain</th>
                <th>Link</th>
                <th>Floor</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>default</td>
                <td>—</td>
                <td>{envelope.defaults.limits.batteryFloorPct}%</td>
                <td>{confidenceOf(envelope.defaults.escalateWhen) ?? '—'}</td>
              </tr>
              {envelope.rules.map((rule) => (
                <tr key={`${rule.terrain}:${rule.comm}`}>
                  <td>{rule.terrain}</td>
                  <td>{rule.comm.replace('_', ' ')}</td>
                  <td>{rule.limits.batteryFloorPct}%</td>
                  <td>{confidenceOf(rule.escalateWhen) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {causes.length > 0 ? (
        <div className="sol-table-wrap">
          <table className="sol-table">
            <thead>
              <tr>
                <th>Failure</th>
                <th>Limit it set</th>
                <th>n</th>
                <th>Sample</th>
              </tr>
            </thead>
            <tbody>
              {causes.map((c) => (
                <tr key={c.reason}>
                  <td>{c.reason}</td>
                  <td>{c.limit}</td>
                  <td>{c.count}</td>
                  <td>{c.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No envelope-side failures set a tighter limit in this window.</p>
      )}
      <p className="muted small report-honest">
        Simplified physics and sim-only surprises. Perseverance pace is a rough benchmark and also reflects science
        stops this sim does not model. Never treat this envelope as a certification.
      </p>
    </section>
  );
}
