import { formatClock } from '../format';
import type { SimClock } from '../sim/clock';

const SPEEDS = [0.5, 1, 2, 5, 10];

interface ClockBarProps {
  clock: SimClock;
  delayMin: number;
  onReset: () => void;
  started: boolean;
  onStart: () => void;
}

export function ClockBar({ clock, delayMin, onReset, started, onStart }: ClockBarProps) {
  return (
    <div className="clockbar">
      <div className="clock">
        <span className="label">Sim clock</span>
        <span className="value">{formatClock(clock.now)}</span>
      </div>
      <button className="primary" disabled={started} onClick={onStart}>
        {started ? 'Mission running' : 'Start mission'}
      </button>
      <button
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
