import { DEFAULT_ONE_WAY_DELAY_MIN, DEMO_SEED, TICKS_PER_MIN } from './config';
import { DelayLink, type LinkMessage } from './link';
import { generateMap } from './map';
import { Rover } from './rover';
import type { Command, CommandInput, Downlink, RoverSnapshot, SimMap, Uplink } from './types';

export interface LogEntry {
  t: number;
  text: string;
}

export interface SentCommand {
  command: Command;
  sentAt: number;
  arrivesAt: number;
  status: 'in_flight' | 'accepted' | 'rejected';
  reason?: string;
  roverReceivedAt?: number;
  ackReceivedAt?: number;
}

/** Everything mission control knows. It only changes when a downlink message arrives. */
export interface GroundView {
  lastState: RoverSnapshot;
  receivedAt: number;
  commands: SentCommand[];
}

export interface SimOptions {
  seed?: number;
  oneWayDelayMin?: number;
}

export function describeCommand(c: CommandInput): string {
  return c.action === 'drive_to' ? `drive_to ${c.args.target}` : c.action;
}

/** One mission world: map, rover, delay link and ground view, stepped in fixed ticks up to the clock's time. */
export class Sim {
  readonly map: SimMap;
  readonly link: DelayLink<Uplink, Downlink>;
  readonly rover: Rover;
  readonly ground: GroundView;
  readonly groundLog: LogEntry[] = [];
  readonly roverLog: LogEntry[] = [];

  private ticks = 0;
  private nextCommandNum = 1;

  constructor({ seed = DEMO_SEED, oneWayDelayMin = DEFAULT_ONE_WAY_DELAY_MIN }: SimOptions = {}) {
    this.map = generateMap(seed);
    this.link = new DelayLink(oneWayDelayMin);
    this.rover = new Rover(this.map, (text) => this.roverLog.push({ t: this.now, text }));
    // Pre-mission knowledge: ground knows the start state at T+0.
    this.ground = { lastState: this.rover.snapshot(0), receivedAt: 0, commands: [] };
  }

  get now(): number {
    return this.ticks / TICKS_PER_MIN;
  }

  sendCommand(input: CommandInput): Command {
    const command: Command = { ...input, id: `c${this.nextCommandNum++}` };
    const msg = this.link.up.send({ kind: 'command', command }, this.now);
    this.ground.commands.push({
      command,
      sentAt: this.now,
      arrivesAt: msg.deliverAt,
      status: 'in_flight',
    });
    this.groundLog.push({
      t: this.now,
      text: `Uplinked ${command.id}: ${describeCommand(command)} (${msg.bytes} B), reaches rover in ${this.link.oneWayDelayMin} min`,
    });
    return command;
  }

  stepTo(simTime: number): void {
    const target = Math.floor(simTime * TICKS_PER_MIN + 1e-6);
    while (this.ticks < target) {
      this.ticks++;
      this.tick(1 / TICKS_PER_MIN);
    }
  }

  private tick(dt: number): void {
    const now = this.now;
    for (const msg of this.link.up.takeDue(now)) {
      for (const reply of this.rover.receive(msg.payload.command, now)) this.link.down.send(reply, now);
    }
    for (const out of this.rover.step(dt, now)) this.link.down.send(out, now);
    for (const msg of this.link.down.takeDue(now)) this.receiveDownlink(msg);
  }

  private receiveDownlink({ payload }: LinkMessage<Downlink>): void {
    const now = this.now;
    if (payload.state.simTime >= this.ground.lastState.simTime) {
      this.ground.lastState = payload.state;
      this.ground.receivedAt = now;
    }
    if (payload.kind !== 'ack') return;

    const sent = this.ground.commands.find((c) => c.command.id === payload.commandId);
    if (!sent) return;
    sent.status = payload.ok ? 'accepted' : 'rejected';
    sent.reason = payload.reason;
    sent.roverReceivedAt = payload.state.simTime;
    sent.ackReceivedAt = now;
    const ago = Math.round(now - payload.state.simTime);
    this.groundLog.push({
      t: now,
      text: payload.ok
        ? `Ack ${sent.command.id}: rover accepted it ${ago} min ago`
        : `Ack ${sent.command.id}: rover rejected it ${ago} min ago (${payload.reason})`,
    });
  }
}
