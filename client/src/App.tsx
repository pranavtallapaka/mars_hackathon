import { ClockBar } from './components/ClockBar';
import { ComparisonBar } from './components/ComparisonBar';
import { HealthBadge } from './components/HealthBadge';
import { IntentPanel } from './components/IntentPanel';
import { MapLegend } from './components/MapGrid';
import { MissionPane } from './components/MissionPane';
import { useSim } from './useSim';

export default function App() {
  const {
    clock,
    baseline,
    ours,
    started,
    awaitingDecision,
    autoAnswer,
    setAutoAnswer,
    ephemerisDate,
    setDate,
    terrain,
    setTerrain,
    delayMin,
    distanceKm,
    start,
    decide,
    requestImage,
    reset,
  } = useSim();

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Mars Latency Mediation</h1>
          <p className="subtitle">
            Baseline vs contingency plan · same clock, seed and mission
            {terrain === 'jezero' ? ' · Jezero HiRISE DTM' : ' · synthetic map'}
          </p>
        </div>
        <HealthBadge />
      </header>

      <ClockBar
        clock={clock}
        delayMin={delayMin}
        ephemerisDate={ephemerisDate}
        distanceKm={distanceKm}
        terrain={terrain}
        onReset={reset}
        onDate={setDate}
        onTerrain={setTerrain}
        awaitingDecision={awaitingDecision}
        autoAnswer={autoAnswer}
        onAutoAnswer={setAutoAnswer}
      />
      <IntentPanel started={started} checkPlan={(plan) => ours.checkSafety(plan)} onApprove={start} />
      <ComparisonBar baseline={baseline} ours={ours} />
      <MapLegend />

      <div className="panes">
        <MissionPane sim={baseline} />
        <MissionPane sim={ours} onDecide={decide} onRequestImage={requestImage} />
      </div>
    </div>
  );
}
