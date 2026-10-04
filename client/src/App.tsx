import { useEffect, useMemo, useRef } from 'react';
import { useTable } from 'spacetimedb/react';
import { parseContextId } from '../../shared/envelope/concept';
import { AppNav } from './components/AppNav';
import { BatchPanel } from './components/BatchPanel';
import { ClockBar } from './components/ClockBar';
import { ComparisonBar } from './components/ComparisonBar';
import { EnvelopeBadge } from './components/EnvelopeBadge';
import { HealthBadge } from './components/HealthBadge';
import { IntentPanel } from './components/IntentPanel';
import { MapLegend } from './components/MapGrid';
import { MissionPane } from './components/MissionPane';
import { tables } from './module_bindings';
import { CACHED_DEMO_PLAN } from '../../shared/missions/mars-demo';
import { createPlanSchema } from '../../shared/plan';
import { MARS_SURFACE } from '../../shared/scenario';
import { overlayActiveEnvelope, parseActiveEnvelope } from './sim/activeEnvelope';
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
    alignWindow,
    delayMin,
    distanceKm,
    start,
    decide,
    requestImage,
    reset,
  } = useSim();
  const [activeRows] = useTable(tables.activeEnvelope);
  const activeRow = useMemo(() => [...activeRows][0], [activeRows]);
  const active = useMemo(() => (activeRow ? parseActiveEnvelope(activeRow.json) : null), [activeRow]);
  const snappedContext = useRef<string | null>(null);

  useEffect(() => {
    if (!activeRow) {
      snappedContext.current = null;
      return;
    }
    if (snappedContext.current === activeRow.contextId) return;
    const parsed = parseContextId(activeRow.contextId);
    if (!parsed) return;
    snappedContext.current = activeRow.contextId;
    alignWindow(parsed.startDate, parsed.siteId === 'jezero' ? 'jezero' : 'synthetic');
  }, [activeRow, alignWindow]);

  const compiledDemo = useMemo(() => createPlanSchema(MARS_SURFACE).parse(CACHED_DEMO_PLAN), []);
  const policySource = useMemo(
    () => (active && activeRow ? { envelope: active, label: activeRow.label, terrain, date: ephemerisDate } : null),
    [active, activeRow, terrain, ephemerisDate],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Mars Latency Mediation</h1>
          <p className="subtitle">
            {activeRow
              ? `Running the envelope policy from Envelope · ${activeRow.label}`
              : 'Baseline vs contingency plan · same clock, seed and mission'}
            {terrain === 'jezero' ? ' · Jezero HiRISE DTM' : ' · synthetic map'}
          </p>
        </div>
        <div className="topbar-side">
          <AppNav current="control" />
          <EnvelopeBadge />
          <HealthBadge />
        </div>
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
      <IntentPanel
        started={started}
        checkPlan={(plan) => ours.checkSafety(plan)}
        onApprove={start}
        overlayPlan={(plan) => overlayActiveEnvelope(plan, active, terrain, ephemerisDate)}
        policySource={policySource}
      />
      <ComparisonBar baseline={baseline} ours={ours} envelopeLabel={activeRow?.label} />
      <BatchPanel
        oneWayDelayMin={delayMin}
        terrain={terrain}
        plan={active ? overlayActiveEnvelope(compiledDemo, active, terrain, ephemerisDate) : undefined}
        envelopeActive={Boolean(active)}
      />
      <MapLegend />

      <div className="panes">
        <MissionPane sim={baseline} policyActive={Boolean(active)} />
        <MissionPane sim={ours} onDecide={decide} onRequestImage={requestImage} policyActive={Boolean(active)} />
      </div>
    </div>
  );
}
