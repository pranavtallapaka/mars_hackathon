import { formatClock } from '../format';
import type { LogEntry } from '../sim/sim';

const MAX_ENTRIES = 8;

export function LogPanel({ title, entries }: { title: string; entries: readonly LogEntry[] }) {
  const recent = entries.slice(-MAX_ENTRIES).reverse();
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
