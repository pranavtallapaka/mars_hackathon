import type { RoverSnapshot } from '../sim/types';

export function RoverStats({ state }: { state: RoverSnapshot }) {
  return (
    <dl className="stats">
      <div><dt>Mode</dt><dd className={`mode-${state.mode}`}>{state.mode.replace('_', ' ')}</dd></div>
      <div><dt>Step</dt><dd>{state.stepId ?? '—'}</dd></div>
      <div><dt>Position</dt><dd>({state.pos.x}, {state.pos.y})</dd></div>
      <div><dt>Battery</dt><dd>{state.batteryPct.toFixed(1)}%</dd></div>
      <div className="wide"><dt>Activity</dt><dd>{state.activity}</dd></div>
      <div><dt>Images</dt><dd>{state.imagesTaken}</dd></div>
    </dl>
  );
}
