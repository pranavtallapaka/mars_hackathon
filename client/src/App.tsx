import { ClockBar } from './components/ClockBar';
import { ComparisonBar } from './components/ComparisonBar';
import { HealthBadge } from './components/HealthBadge';
import { MapLegend } from './components/MapGrid';
import { MissionPane } from './components/MissionPane';
import { useSim } from './useSim';

export default function App() {
  const { clock, baseline, ours, started, start, reset } = useSim();

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Mars Latency Mediation</h1>
          <p className="subtitle">Baseline vs contingency plan · same clock, seed and mission</p>
        </div>
        <HealthBadge />
      </header>

      <ClockBar clock={clock} delayMin={ours.link.oneWayDelayMin} onReset={reset} started={started} onStart={start} />
      <ComparisonBar baseline={baseline} ours={ours} />
      <MapLegend />

      <div className="panes">
        <MissionPane sim={baseline} />
        <MissionPane sim={ours} />
      </div>
    </div>
  );
}
