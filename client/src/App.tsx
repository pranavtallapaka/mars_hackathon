import { createPlanSchema } from '../../shared/plan';
import { MARS_SURFACE } from '../../shared/scenario';
import { ClockBar } from './components/ClockBar';
import { EscalationView } from './components/EscalationView';
import { HealthBadge } from './components/HealthBadge';
import { LinkPanel } from './components/LinkPanel';
import { LogPanel } from './components/LogPanel';
import { MapGrid, MapLegend } from './components/MapGrid';
import { PlanPanel } from './components/PlanPanel';
import { RoverStats } from './components/RoverStats';
import { DEMO_PLAN } from './sim/mars/mission';
import { useSim } from './useSim';

const demoPlan = createPlanSchema(MARS_SURFACE).parse(DEMO_PLAN);

export default function App() {
  const { clock, sim, reset } = useSim();
  const { ground, rover, now } = sim;
  const known = ground.lastState;
  const staleMin = Math.floor(now - known.simTime);
  const latestEscalation = ground.escalations.at(-1);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Mars Latency Mediation</h1>
          <p className="subtitle">Contingency plan · onboard executor · escalation</p>
        </div>
        <HealthBadge />
      </header>

      <ClockBar clock={clock} delayMin={sim.link.oneWayDelayMin} onReset={reset} />

      <div className="panes">
        <section className="pane">
          <div className="pane-head">
            <h2>Mission control · Earth</h2>
            <span className="stale-label">Rover as of {staleMin} min ago</span>
          </div>
          <MapGrid map={sim.map} rover={known.pos} boulders={known.discovered} stale />
          <RoverStats state={known} />
          {latestEscalation && <EscalationView escalation={latestEscalation} />}
          <PlanPanel sim={sim} plan={demoPlan} knownStepId={known.stepId} />
          <LogPanel title="Ground log" entries={sim.groundLog} />
        </section>

        <section className="pane">
          <div className="pane-head">
            <h2>Rover · Mars</h2>
            <span className="live-label">Onboard, live (sim truth)</span>
          </div>
          <MapGrid
            map={sim.map}
            rover={rover.pos}
            path={rover.plannedPath}
            boulders={rover.discovered}
            hidden={rover.undiscovered}
          />
          <RoverStats state={sim.snapshot()} />
          <LogPanel title="Onboard decision log" entries={sim.roverLog} max={14} />
        </section>
      </div>

      <MapLegend />
      <LinkPanel sim={sim} />
    </div>
  );
}
