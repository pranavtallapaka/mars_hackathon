import { formatClock, formatMin } from '../format';
import type { LinkMessage } from '../sim/link';
import type { Sim } from '../sim/sim';
import type { Downlink, Uplink } from '../sim/types';

interface Lane {
  title: string;
  dir: 'up' | 'down';
  messages: readonly LinkMessage<Uplink | Downlink>[];
  totalBytes: number;
}

function describePayload(payload: Uplink | Downlink): string {
  switch (payload.kind) {
    case 'plan':
      return `plan ${payload.plan.planId} v${payload.plan.version}`;
    case 'ack':
      return `ack ${payload.planId} v${payload.version}${payload.ok ? '' : ' (rejected)'}`;
    case 'telemetry':
      return `status ${formatClock(payload.state.simTime)}`;
    case 'escalation':
      return `escalation ${payload.packet.stepId}`;
    case 'image_request':
      return `image request ${payload.stepId}`;
    case 'image':
      return `camera frame ${payload.stepId}`;
  }
}

export function LinkPanel({ sim, compact = false }: { sim: Sim; compact?: boolean }) {
  const { link, now } = sim;
  const lanes: Lane[] = [
    {
      title: 'Uplink · Earth → Mars',
      dir: 'up',
      messages: link.up.inFlight,
      totalBytes: link.up.totalBytes,
    },
    {
      title: 'Downlink · Mars → Earth',
      dir: 'down',
      messages: link.down.inFlight,
      totalBytes: link.down.totalBytes,
    },
  ];

  return (
    <section className={compact ? 'link compact' : 'link'}>
      <div className="link-ends">
        <span>Earth · mission control</span>
        <span>Mars · rover</span>
      </div>
      {lanes.map((lane) => (
        <div key={lane.dir} className={`lane lane-${lane.dir}`}>
          <div className="lane-head">
            <h3>{lane.title}</h3>
            <span className="muted">
              {lane.messages.length} in flight · {lane.totalBytes} B sent total
            </span>
          </div>
          <div className="track">
            {lane.messages.map((m, i) => {
              const frac = Math.min(1, Math.max(0, (now - m.sentAt) / (m.deliverAt - m.sentAt)));
              const left = lane.dir === 'up' ? frac : 1 - frac;
              return (
                <div key={m.id} className={`packet row-${i % 3} kind-${m.payload.kind}`} style={{ left: `${left * 100}%` }}>
                  <span className="packet-dot" />
                  <span className="packet-label">
                    {describePayload(m.payload)}
                    {compact ? '' : ` · ${m.bytes} B · ${formatMin(m.deliverAt - now)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
