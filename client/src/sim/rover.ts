import { BATTERY_PCT_PER_CELL, ROVER_CELLS_PER_MIN, TELEMETRY_PERIOD_MIN } from './config';
import { featureById, findPath } from './grid';
import type { Command, Downlink, RoverSnapshot, RoverStatus, SimMap, Vec } from './types';

const EPS = 1e-9;

export class Rover {
  pos: Vec;
  batteryPct = 100;
  status: RoverStatus = 'idle';
  activeCommandId: string | null = null;
  target: string | null = null;

  private path: Vec[] = [];
  private progress = 0;
  private lastTelemetryAt = 0;

  constructor(
    private readonly map: SimMap,
    private readonly log: (text: string) => void,
  ) {
    this.pos = { ...map.roverStart };
  }

  get plannedPath(): readonly Vec[] {
    return this.path;
  }

  snapshot(now: number): RoverSnapshot {
    return {
      simTime: now,
      pos: { ...this.pos },
      batteryPct: Math.round(this.batteryPct * 10) / 10,
      status: this.status,
      activeCommandId: this.activeCommandId,
      target: this.target,
    };
  }

  receive(command: Command, now: number): Downlink[] {
    switch (command.action) {
      case 'drive_to': {
        const feature = featureById(this.map, command.args.target);
        if (!feature) return [this.reject(command, now, `unknown target ${command.args.target}`)];
        const path = findPath(this.map, this.pos, feature.pos);
        if (!path) return [this.reject(command, now, `no safe path to ${feature.id}`)];
        this.path = path;
        this.progress = 0;
        this.status = path.length ? 'driving' : 'idle';
        this.activeCommandId = command.id;
        this.target = feature.id;
        this.log(`${command.id} received: drive_to ${feature.id}, ${path.length} cells`);
        return [this.ack(command, now)];
      }
      case 'hold': {
        this.path = [];
        this.status = 'holding';
        this.activeCommandId = command.id;
        this.target = null;
        this.log(`${command.id} received: hold`);
        return [this.ack(command, now)];
      }
    }
  }

  step(dt: number, now: number): Downlink[] {
    const out: Downlink[] = [];

    if (this.status === 'driving') {
      this.progress += dt * ROVER_CELLS_PER_MIN;
      while (this.progress >= 1 - EPS && this.path.length) {
        this.pos = this.path.shift()!;
        this.progress -= 1;
        this.batteryPct = Math.max(0, this.batteryPct - BATTERY_PCT_PER_CELL);
      }
      if (!this.path.length) {
        this.status = 'idle';
        this.log(`${this.activeCommandId} done: arrived at ${this.target}`);
        out.push(this.telemetry(now));
      }
    }

    if (now - this.lastTelemetryAt >= TELEMETRY_PERIOD_MIN - EPS) out.push(this.telemetry(now));
    return out;
  }

  private telemetry(now: number): Downlink {
    this.lastTelemetryAt = now;
    return { kind: 'telemetry', state: this.snapshot(now) };
  }

  private ack(command: Command, now: number): Downlink {
    return { kind: 'ack', commandId: command.id, ok: true, state: this.snapshot(now) };
  }

  private reject(command: Command, now: number, reason: string): Downlink {
    this.log(`${command.id} rejected: ${reason}`);
    return { kind: 'ack', commandId: command.id, ok: false, reason, state: this.snapshot(now) };
  }
}
