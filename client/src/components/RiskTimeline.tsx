import { useMemo } from 'react';
import type { SolState } from '../../../shared/envelope/types';

interface TimelineSol {
  solIndex: number;
  comm: string;
  daylightHours: number;
  season: string;
  earthDate: string;
  delayMin: number;
  lsDeg: number;
}

interface RiskTimelineProps {
  sols: TimelineSol[];
  fromSubscription: boolean;
}

const COMM_LABEL: Record<string, string> = {
  normal: 'normal',
  long_gap: 'long gap',
  conjunction: 'conjunction',
};

function seasonLabel(s: string): string {
  return s.replace('northern_', 'NH ');
}

export function RiskTimeline({ sols, fromSubscription }: RiskTimelineProps) {
  const summary = useMemo(() => {
    const counts = { normal: 0, long_gap: 0, conjunction: 0, lowLight: 0 };
    for (const s of sols) {
      if (s.comm in counts) counts[s.comm as SolState['comm']]++;
      if (s.daylightHours < 8) counts.lowLight++;
    }
    return counts;
  }, [sols]);
  const maxDay = Math.max(12, ...sols.map((s) => s.daylightHours));
  const first = sols[0];
  const last = sols.at(-1);

  if (!sols.length) return null;

  return (
    <section className="envelope-timeline">
      <h2>Risk windows</h2>
      <p className="muted small">
        {first?.earthDate} to {last?.earthDate} · {seasonLabel(first?.season ?? '')} · Ls {first?.lsDeg}° · delay{' '}
        {first?.delayMin}–{sols.reduce((m, s) => Math.max(m, s.delayMin), 0)} min
        {fromSubscription ? ' · live subscription' : ''}
      </p>
      <div className="risk-chart" role="img" aria-label="Per-sol communication and daylight">
        <div className="risk-row-label">Link</div>
        <div className="risk-strip">
          {sols.map((s) => (
            <span
              key={`c-${s.solIndex}`}
              className="risk-sol"
              data-comm={s.comm}
              title={`Sol ${s.solIndex} ${s.earthDate}: ${COMM_LABEL[s.comm] ?? s.comm}, ${s.delayMin} min delay`}
            />
          ))}
        </div>
        <div className="risk-row-label">Light</div>
        <div className="risk-strip risk-daylight">
          {sols.map((s) => (
            <span
              key={`d-${s.solIndex}`}
              className="risk-sol risk-day"
              data-low={s.daylightHours < 8 ? 'true' : 'false'}
              style={{ height: `${Math.max(12, (s.daylightHours / maxDay) * 100)}%` }}
              title={`Sol ${s.solIndex}: ${s.daylightHours} h daylight`}
            />
          ))}
        </div>
      </div>
      <p className="heat-legend">
        <span className="heat-swatch comm-normal" /> normal
        <span className="heat-swatch comm-gap" /> long gap
        <span className="heat-swatch comm-conj" /> conjunction
        <span className="heat-swatch day-low" /> low light (&lt; 8 h)
      </p>
      <p className="muted small">
        {summary.conjunction} conjunction · {summary.long_gap} long gap · {summary.lowLight} low-light sols
      </p>
    </section>
  );
}
