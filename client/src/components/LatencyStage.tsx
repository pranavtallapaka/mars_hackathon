import type { Sim } from '../sim/sim';
import { RoverView } from '../view/RoverView';
import { EscalationView } from './EscalationView';
import { MapGrid } from './MapGrid';

interface LatencyStageProps {
  sim: Sim;
  onDecide?: (optionId: string) => void;
  onRequestImage?: (stepId: string) => void;
}

export function LatencyStage({ sim, onDecide, onRequestImage }: LatencyStageProps) {
  const { ground, rover, now } = sim;
  const known = ground.lastState;
  const staleMin = Math.floor(now - known.simTime);
  const latest = ground.escalations.at(-1);
  const answer = latest && ground.uplinks.find((u) => u.sentAt >= latest.receivedAt);
  const boulders = [...rover.discovered, ...rover.undiscovered];

  return (
    <section className="latency-stage">
      <div className="stage-now">
        <div className="stage-head">
          <h2>Mars, now</h2>
          <span className="live-label">mast camera · along the plan</span>
        </div>
        <p className="muted small stage-kicker">What the rover sees ahead as it drives the planned route. Earth does not have this yet.</p>
        <div className="rover-view" aria-label="First-person rover mast camera looking along the planned route">
          <RoverView map={sim.map} pose={rover.pose} path={rover.plannedPath} boulders={boulders} />
        </div>
      </div>
      <div className="stage-then">
        <div className="stage-head">
          <h2>Mission control</h2>
          <span className="stale-label">as of {staleMin} min ago</span>
        </div>
        <p className="muted small stage-kicker">Earth’s picture is one delay old. The rover may already have moved.</p>
        <MapGrid
          map={sim.map}
          rover={rover.pos}
          ghost={known.pos}
          path={rover.plannedPath}
          boulders={rover.discovered}
          hidden={rover.undiscovered}
          stale
          caption={`${sim.map.source?.label ?? 'Synthetic map'} · Earth's view (dashed) as of ${staleMin} min ago`}
        />
        {latest && (
          <EscalationView
            escalation={latest}
            title="Escalation"
            answeredAt={answer?.sentAt}
            onDecide={sim.awaitingDecision === latest ? onDecide : undefined}
            decisionMin={sim.decisionMin}
            pending={sim.pendingAnswer}
            blockedReasons={
              ground.lastBlocked && ground.lastBlocked.at >= latest.receivedAt ? ground.lastBlocked.reasons : undefined
            }
            onRequestImage={onRequestImage}
            imageRequest={ground.imageRequests.find((r) => r.stepId === latest.packet.stepId)}
          />
        )}
      </div>
    </section>
  );
}
