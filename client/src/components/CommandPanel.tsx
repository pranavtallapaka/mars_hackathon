import { formatClock, formatMin } from '../format';
import { describeCommand, type SentCommand, type Sim } from '../sim/sim';

function commandStatus(c: SentCommand, now: number): string {
  switch (c.status) {
    case 'in_flight':
      return now < c.arrivesAt ? `uplink in flight, arrives in ${formatMin(c.arrivesAt - now)}` : 'awaiting ack';
    case 'accepted':
      return `accepted at rover ${formatClock(c.roverReceivedAt!)}, ack ${formatClock(c.ackReceivedAt!)}`;
    case 'rejected':
      return `rejected: ${c.reason}`;
  }
}

export function CommandPanel({ sim }: { sim: Sim }) {
  return (
    <div className="commands">
      <h3>Send command</h3>
      <div className="cmd-buttons">
        {sim.map.features.map((f) => (
          <button key={f.id} onClick={() => sim.sendCommand({ action: 'drive_to', args: { target: f.id } })}>
            drive_to {f.id}
          </button>
        ))}
        <button onClick={() => sim.sendCommand({ action: 'hold' })}>hold</button>
      </div>
      {sim.ground.commands.length > 0 && (
        <ul className="cmd-list">
          {[...sim.ground.commands].reverse().map((c) => (
            <li key={c.command.id} className={`cmd-${c.status}`}>
              <span className="mono">{c.command.id}</span> {describeCommand(c.command)}
              <span className="muted"> · {commandStatus(c, sim.now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
