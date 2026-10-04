import { useState } from 'react';
import { BATCH_RUNS, runBatchAsync, type BatchReport, type MetricSpread } from '../sim/batch';
import type { TerrainId } from '../sim/types';

interface BatchPanelProps {
  oneWayDelayMin: number;
  terrain: TerrainId;
  plan?: unknown;
  envelopeActive?: boolean;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

function spreadLine(s: MetricSpread, unit: string, digits = 1): string {
  return `${fmt(s.mean, digits)} ${unit}  ·  IQR ${fmt(s.p25, digits)}–${fmt(s.p75, digits)}`;
}

function TripChart({ report }: { report: BatchReport }) {
  const max = Math.max(1, ...report.pairs.flatMap((p) => [p.baseline.roundTrips, p.ours.roundTrips]));
  const h = 72;
  const gap = 2;
  const n = report.pairs.length;
  const w = Math.max(n * 6, 240);
  const col = w / n;
  return (
    <svg className="batch-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Round trips per seeded mission, baseline vs ours">
      {report.pairs.map((p, i) => {
        const x = i * col + col / 2;
        const baseH = (p.baseline.roundTrips / max) * (h - 10);
        const oursH = (p.ours.roundTrips / max) * (h - 10);
        return (
          <g key={p.seed}>
            <rect className="batch-bar-base" x={x - col / 2 + gap / 2} y={h - baseH} width={col / 2 - gap} height={baseH} />
            <rect className="batch-bar-ours" x={x + gap / 2} y={h - oursH} width={col / 2 - gap} height={oursH} />
          </g>
        );
      })}
    </svg>
  );
}

export function BatchPanel({ oneWayDelayMin, terrain, plan, envelopeActive = false }: BatchPanelProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const next = await runBatchAsync({ runs: BATCH_RUNS, oneWayDelayMin, terrain, plan }, setProgress);
      setReport(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="batch-panel">
      <div className="batch-head">
        <div>
          <h3>Batch evidence</h3>
          <p className="muted small">
            {BATCH_RUNS} seeded missions · {envelopeActive ? 'envelope policy on the cached plan' : 'cached plan'} · no
            LLM. Surprises the plan does not cover escalate.
          </p>
        </div>
        <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? `Running ${progress} / ${BATCH_RUNS}…` : `Run ${BATCH_RUNS} missions`}
        </button>
      </div>
      {error && <p className="bad small">{error}</p>}
      {report && (
        <div className="batch-body">
          <p className="batch-verdict">
            <strong>
              {fmt(report.saved.missionMin, 0)} min saved · {fmt(report.saved.roundTrips, 1)} fewer trips
            </strong>
            <span className="muted small">
              {' '}
              mean of {report.runs} runs in {(report.elapsedMs / 1000).toFixed(1)} s · {report.ours.finished}/{report.runs}{' '}
              ours finished · {report.baseline.finished}/{report.runs} baseline
            </span>
          </p>
          <dl className="batch-stats">
            <div>
              <dt>Ours · round trips</dt>
              <dd>{spreadLine(report.ours.roundTrips, '')}</dd>
            </div>
            <div>
              <dt>Baseline · round trips</dt>
              <dd>{spreadLine(report.baseline.roundTrips, '')}</dd>
            </div>
            <div>
              <dt>Ours · mission time</dt>
              <dd>{spreadLine(report.ours.missionMin, 'min', 0)}</dd>
            </div>
            <div>
              <dt>Baseline · mission time</dt>
              <dd>{spreadLine(report.baseline.missionMin, 'min', 0)}</dd>
            </div>
            <div>
              <dt>Ours · bytes down</dt>
              <dd>{spreadLine(report.ours.bytesDown, 'B', 0)}</dd>
            </div>
            <div>
              <dt>Baseline · bytes down</dt>
              <dd>{spreadLine(report.baseline.bytesDown, 'B', 0)}</dd>
            </div>
            <div>
              <dt>Ours · escalations</dt>
              <dd>{spreadLine(report.ours.escalations, '', 1)}</dd>
            </div>
            <div>
              <dt>Baseline · escalations</dt>
              <dd>{spreadLine(report.baseline.escalations, '', 1)}</dd>
            </div>
          </dl>
          <TripChart report={report} />
          <p className="muted small batch-caption">
            Each pair of ticks is one seed: relief grey is baseline, plot blue is ours.
          </p>
        </div>
      )}
    </section>
  );
}
