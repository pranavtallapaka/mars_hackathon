import type { Sim } from '../sim/sim';
import { EscalationView } from './EscalationView';
import { LinkPanel } from './LinkPanel';
import { LogPanel } from './LogPanel';
import { MapGrid } from './MapGrid';
import { PlanPanel } from './PlanPanel';
import { RoverStats } from './RoverStats';

const COPY = {
  baseline: {
    title: 'Baseline · conventional sequence',
    tagline: 'Full command sequence, no contingencies. Any surprise: stop and wait a round trip.',
    stopTitle: 'Stopped, waiting for Earth',
  },
  contingency: {
    title: 'Ours · contingency plan + onboard executor',
    tagline: 'Branches handle expected surprises onboard; escalate only when no branch fits.',
    stopTitle: 'Escalation',
  },
} as const;

export function Counters({ sim }: { sim: Sim }) {
  const m = sim.metrics;
  const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
  return (
    <dl className="counters">
      <div className="big">
        <dt>Mission time</dt>
        <dd className={m.complete ? 'good' : ''}>
          {Math.floor(m.missionMin)} min{m.complete ? ' ✓' : ''}
        </dd>
      </div>
      <div className="big">
        <dt>Round trips</dt>
        <dd>{m.roundTrips}</dd>
      </div>
      <div>
        <dt>Bytes up / down</dt>
        <dd>
          {kb(m.bytesUp)} / {kb(m.bytesDown)}
        </dd>
      </div>
      <div>
        <dt>Escalations</dt>
        <dd>{m.escalations}</dd>
      </div>
      <div>
        <dt>Unsafe blocked</dt>
        <dd>{m.unsafeBlocked}</dd>
      </div>
    </dl>
  );
}

export function MissionPane({ sim }: { sim: Sim }) {
  const { ground, rover, now } = sim;
  const copy = COPY[sim.mode];
  const known = ground.lastState;
  const staleMin = Math.floor(now - known.simTime);
  const staleText = `as of ${staleMin} min ago`;
  const latest = ground.escalations.at(-1);
  const answer = latest && ground.uplinks.find((u) => u.sentAt >= latest.receivedAt);

  return (
    <section className={`pane pane-${sim.mode}`}>
      <div className="pane-head">
        <h2>{copy.title}</h2>
      </div>
      <p className="muted small tagline">{copy.tagline}</p>
      <Counters sim={sim} />

      <MapGrid
        map={sim.map}
        rover={rover.pos}
        ghost={known.pos}
        path={rover.plannedPath}
        boulders={rover.discovered}
        hidden={rover.undiscovered}
        caption={`Earth's view (dashed) ${staleText}`}
      />

      <div className="views">
        <div>
          <div className="view-head">
            <h3>Earth's view of rover</h3>
            <span className="stale-label">{staleText}</span>
          </div>
          <RoverStats state={known} />
        </div>
        <div>
          <div className="view-head">
            <h3>Rover onboard</h3>
            <span className="live-label">live · sim truth, Earth can't see this</span>
          </div>
          <RoverStats state={sim.snapshot()} />
        </div>
      </div>

      {latest && <EscalationView escalation={latest} title={copy.stopTitle} answeredAt={answer?.sentAt} />}
      {ground.currentPlan ? (
        <PlanPanel sim={sim} plan={ground.currentPlan} knownStepId={known.stepId} />
      ) : (
        <p className="muted">No plan uplinked yet. Press Start mission.</p>
      )}
      <LinkPanel sim={sim} compact />
      <LogPanel title="Ground log" entries={sim.groundLog} max={6} />
      <LogPanel title="Onboard decision log" entries={sim.roverLog} max={8} />
    </section>
  );
}
