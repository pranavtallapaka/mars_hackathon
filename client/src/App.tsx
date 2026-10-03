import { ClockBar } from './components/ClockBar';
import { CommandPanel } from './components/CommandPanel';
import { HealthBadge } from './components/HealthBadge';
import { LinkPanel } from './components/LinkPanel';
import { LogPanel } from './components/LogPanel';
import { MapGrid, MapLegend } from './components/MapGrid';
import { RoverStats } from './components/RoverStats';
import { useSim } from './useSim';

export default function App() {
  const { clock, sim } = useSim();
  const { ground, rover, now } = sim;
  const staleMin = Math.floor(now - ground.lastState.simTime);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Mars Latency Mediation</h1>
          <p className="subtitle">Sim core · clock · delay link</p>
        </div>
        <HealthBadge />
      </header>

      <ClockBar clock={clock} delayMin={sim.link.oneWayDelayMin} />

      <div className="panes">
        <section className="pane">
          <div className="pane-head">
            <h2>Mission control · Earth</h2>
            <span className="stale-label">Rover as of {staleMin} min ago</span>
          </div>
          <MapGrid map={sim.map} rover={ground.lastState.pos} target={ground.lastState.target} stale />
          <RoverStats state={ground.lastState} />
          <CommandPanel sim={sim} />
          <LogPanel title="Ground log" entries={sim.groundLog} />
        </section>

        <section className="pane">
          <div className="pane-head">
            <h2>Rover · Mars</h2>
            <span className="live-label">Onboard, live (sim truth)</span>
          </div>
          <MapGrid map={sim.map} rover={rover.pos} path={rover.plannedPath} target={rover.target} />
          <RoverStats state={rover.snapshot(now)} />
          <LogPanel title="Onboard log" entries={sim.roverLog} />
        </section>
      </div>

      <MapLegend />
      <LinkPanel sim={sim} />
    </div>
  );
}
