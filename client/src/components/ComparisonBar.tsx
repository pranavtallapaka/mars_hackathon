import { formatClock } from '../format';
import type { Sim } from '../sim/sim';

interface ComparisonBarProps {
  baseline: Sim;
  ours: Sim;
}

function finish(sim: Sim): string {
  const { completedAt, confirmedAt } = sim.metrics;
  if (sim.startedAt === null) return 'not started';
  if (completedAt === null) return 'in progress';
  return `done ${formatClock(completedAt)}${confirmedAt === null ? '' : ` · Earth knows ${formatClock(confirmedAt)}`}`;
}

export function ComparisonBar({ baseline, ours }: ComparisonBarProps) {
  const b = baseline.metrics;
  const o = ours.metrics;
  const bothDone = b.complete && o.complete;
  const saved = Math.round(b.missionMin - o.missionMin);
  const tripsSaved = b.roundTrips - o.roundTrips;
  const roundTripMin = ours.link.oneWayDelayMin * 2;

  return (
    <section className="compare">
      <div>
        <h3>Baseline</h3>
        <span className="mono">{finish(baseline)}</span>
      </div>
      <div className="verdict">
        {bothDone ? (
          <>
            <strong>
              {saved} min saved · {tripsSaved} fewer round trip{tripsSaved === 1 ? '' : 's'}
            </strong>
            <span className="muted small">
              Same seed, mission, delay and operator decisions. Each round trip here costs {roundTripMin} min of
              light time plus the operator's decision.
            </span>
          </>
        ) : (
          <span className="muted">
            {o.roundTrips === 0 ? 'Approve a plan to run both systems on the same clock.' : 'Running both systems on the same clock…'}
          </span>
        )}
      </div>
      <div className="right">
        <h3>Ours</h3>
        <span className="mono">{finish(ours)}</span>
      </div>
    </section>
  );
}
