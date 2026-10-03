import { formatClock } from '../format';
import type { SimClock } from '../sim/clock';

const SPEEDS = [0.5, 1, 2, 5, 10];

interface ClockBarProps {
  clock: SimClock;
  delayMin: number;
  onReset: () => void;
  awaitingDecision: boolean;
  autoAnswer: boolean;
  onAutoAnswer: (on: boolean) => void;
}

export function ClockBar({ clock, delayMin, onReset, awaitingDecision, autoAnswer, onAutoAnswer }: ClockBarProps) {
  return (
    <div className="clockbar">
      <div className="clock">
        <span className="label">Sim clock</span>
        <span className="value">{formatClock(clock.now)}</span>
      </div>
      <button
        className="primary"
        onClick={() => {
          clock.paused = !clock.paused;
        }}
      >
        {clock.paused ? 'Resume' : 'Pause'}
      </button>
      <button onClick={onReset}>Reset</button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={clock.speed === s ? 'active' : ''}
            onClick={() => {
              clock.speed = s;
            }}
          >
            {s}×
          </button>
        ))}
      </div>
      <label className="toggle small">
        <input type="checkbox" checked={autoAnswer} onChange={(e) => onAutoAnswer(e.target.checked)} />
        Auto-answer escalations (scripted operator)
      </label>
      {awaitingDecision && <span className="decision-flag">Paused: escalation needs your decision</span>}
      <div className="clock-meta">
        <span>
          1 real s = {clock.simMinPerRealSec * clock.speed} sim min
        </span>
        <span>
          One-way delay <strong>{delayMin} min</strong> · round trip <strong>{delayMin * 2} min</strong>
        </span>
      </div>
    </div>
  );
}
