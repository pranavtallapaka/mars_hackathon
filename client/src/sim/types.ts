export interface Vec {
  x: number;
  y: number;
}

export type CellType = 'ground' | 'rock' | 'sand';

export interface Feature {
  id: string;
  kind: 'waypoint' | 'target';
  label: string;
  tag: string;
  pos: Vec;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoGoZone {
  id: string;
  label: string;
  rect: Rect;
}

export interface SimMap {
  seed: number;
  width: number;
  height: number;
  /** Row-major, y = 0 is north. */
  cells: CellType[];
  features: Feature[];
  noGoZones: NoGoZone[];
  roverStart: Vec;
}

export type RoverStatus = 'idle' | 'driving' | 'holding';

export interface RoverSnapshot {
  /** Sim minute at which the rover measured this state. */
  simTime: number;
  pos: Vec;
  batteryPct: number;
  status: RoverStatus;
  activeCommandId: string | null;
  target: string | null;
}

export type CommandInput =
  | { action: 'drive_to'; args: { target: string } }
  | { action: 'hold' };

export type Command = CommandInput & { id: string };

export type Uplink = { kind: 'command'; command: Command };

export type Downlink =
  | { kind: 'ack'; commandId: string; ok: boolean; reason?: string; state: RoverSnapshot }
  | { kind: 'telemetry'; state: RoverSnapshot };
