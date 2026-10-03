import type { RoverSnapshot } from '../sim/types';

export function RoverStats({ state }: { state: RoverSnapshot }) {
  return (
    <dl className="stats">
      <div><dt>Status</dt><dd className={`status-${state.status}`}>{state.status}</dd></div>
      <div><dt>Position</dt><dd>({state.pos.x}, {state.pos.y})</dd></div>
      <div><dt>Battery</dt><dd>{state.batteryPct.toFixed(1)}%</dd></div>
      <div><dt>Command</dt><dd>{state.activeCommandId ?? '—'}{state.target ? ` → ${state.target}` : ''}</dd></div>
    </dl>
  );
}
