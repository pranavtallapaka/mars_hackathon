const EPS = 1e-9;
const encoder = new TextEncoder();

export interface LinkMessage<T> {
  id: number;
  payload: T;
  sentAt: number;
  deliverAt: number;
  bytes: number;
}

/** One direction of the link. Delay is fixed per message at send time, in sim minutes. */
export class DelayChannel<T> {
  totalBytes = 0;
  private queue: LinkMessage<T>[] = [];
  private nextId = 1;

  constructor(private readonly getDelay: () => number) {}

  get inFlight(): readonly LinkMessage<T>[] {
    return this.queue;
  }

  send(payload: T, now: number): LinkMessage<T> {
    const bytes = encoder.encode(JSON.stringify(payload)).length;
    const msg: LinkMessage<T> = {
      id: this.nextId++,
      payload,
      sentAt: now,
      deliverAt: now + this.getDelay(),
      bytes,
    };
    this.queue.push(msg);
    this.totalBytes += bytes;
    return msg;
  }

  takeDue(now: number): LinkMessage<T>[] {
    const due: LinkMessage<T>[] = [];
    const pending: LinkMessage<T>[] = [];
    for (const m of this.queue) (m.deliverAt <= now + EPS ? due : pending).push(m);
    this.queue = pending;
    return due.sort((a, b) => a.deliverAt - b.deliverAt || a.id - b.id);
  }
}

export class DelayLink<Up, Down> {
  readonly up: DelayChannel<Up>;
  readonly down: DelayChannel<Down>;

  constructor(public oneWayDelayMin: number) {
    this.up = new DelayChannel<Up>(() => this.oneWayDelayMin);
    this.down = new DelayChannel<Down>(() => this.oneWayDelayMin);
  }
}
