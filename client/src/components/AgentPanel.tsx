import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { postAgent } from '../api';
import { tables } from '../module_bindings';
import { AGENT_RUNS } from '../sim/agent';
import type { MissionConcept } from '../../../shared/envelope/types';

interface AgentPanelProps {
  concept: MissionConcept;
  contextId: string;
}

export function AgentPanel({ concept, contextId }: AgentPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, jobsReady] = useTable(tables.agentJob.where((r) => r.contextId.eq(contextId)));
  const [logs, logsReady] = useTable(tables.agentLog);
  const [envelopes] = useTable(tables.envelope.where((r) => r.jobId.eq(contextId)));

  const job = useMemo(() => [...jobs].sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))[0], [jobs]);
  const rows = useMemo(
    () =>
      [...logs]
        .filter((row) => row.jobId === contextId || row.contextId === contextId)
        .sort((a, b) => a.seq - b.seq),
    [logs, contextId],
  );
  const best = useMemo(
    () => (job?.bestEnvelopeKey ? [...envelopes].find((e) => e.id === job.bestEnvelopeKey) : undefined),
    [envelopes, job],
  );

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await postAgent(concept);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="envelope-agent">
      <div className="batch-head">
        <div>
          <h2>Envelope agent</h2>
          <p className="muted small">
            Propose → simulate → inspect → widen or tighten. Stops at zero unsafe and a flat score, then a fresh-seed
            check. Not a certification.
          </p>
        </div>
        <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Agent running…' : `Run agent (${AGENT_RUNS} campaigns / iteration)`}
        </button>
      </div>
      {error && <p className="bad small">{error}</p>}
      {!jobsReady || !logsReady ? (
        <p className="muted small">Subscribing to agent_job…</p>
      ) : job ? (
        <div className="batch-body">
          <p className="batch-verdict">
            <strong>
              {job.accepted
                ? `Best score ${job.score.toFixed(1)} · 0 unsafe · ${job.status}`
                : `${job.status} · ${job.unsafe} unsafe`}
            </strong>
          </p>
          <p className="muted small">
            {job.stopReason || 'in progress'} · {job.runsUsed} runs · {job.source} · live subscription
          </p>
          {best && (
            <p className="muted small">
              Envelope {best.envelopeId} v{best.version}
              {best.note ? ` — ${best.note}` : ''}
            </p>
          )}
          {rows.length > 0 && (
            <div className="sol-table-wrap">
              <table className="sol-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Action</th>
                    <th>Change</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.id)}>
                      <td>{row.seq}</td>
                      <td>{row.action}</td>
                      <td>{row.change}</td>
                      <td>{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <p className="muted small">No agent job yet. Run one to fill agent_job, agent_log and envelope.</p>
      )}
    </section>
  );
}
