import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { deleteActiveEnvelope } from '../api';
import { tables } from '../module_bindings';
import { ACTIVE_ENVELOPE_ID } from '../sim/activeEnvelope';

/** Names the loaded envelope policy and how to take it off. */
export function EnvelopeBadge() {
  const [rows] = useTable(tables.activeEnvelope);
  const [error, setError] = useState<string | null>(null);
  const active = useMemo(
    () => [...rows].find((r) => r.id === ACTIVE_ENVELOPE_ID) ?? [...rows][0],
    [rows],
  );
  if (!active) return null;

  return (
    <div className="envelope-badge" role="status">
      <div>
        <strong>Using envelope policy</strong>
        <span>{active.label}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          void deleteActiveEnvelope().catch((err) => setError((err as Error).message));
        }}
      >
        Remove
      </button>
      {error && <span className="bad small">{error}</span>}
    </div>
  );
}
