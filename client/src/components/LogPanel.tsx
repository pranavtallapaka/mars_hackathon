import { formatClock } from '../format';
import type { LogEntry } from '../sim/sim';

interface LogPanelProps {
  title: string;
  entries: readonly LogEntry[];
  max?: number;
}

export function LogPanel({ title, entries, max = 8 }: LogPanelProps) {
  const recent = entries.slice(-max).reverse();
  return (
    <div className="log">
      <h3>{title}</h3>
      {recent.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul>
          {recent.map((e, i) => (
            <li key={entries.length - i}>
              <span className="mono muted">{formatClock(e.t)}</span> {e.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
