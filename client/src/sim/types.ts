import type { EscalationPacket, Plan } from '../../../shared/plan';
import type { ExecutorMode } from './executor';

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

export type TerrainId = 'synthetic' | 'jezero';

export interface MapSource {
  id: string;
  label: string;
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
  /** Metres per cell. Synthetic maps use the config default. */
  cellMeters?: number;
  elevations?: number[];
  slopesDeg?: number[];
  source?: MapSource;
}

export interface RoverSnapshot {
  /** Sim minute at which the rover measured this state. */
  simTime: number;
  pos: Vec;
  batteryPct: number;
  mode: ExecutorMode;
  planId: string | null;
  planVersion: number | null;
  stepId: string | null;
  activity: string;
  imagesTaken: number;
  discovered: Vec[];
}

export type Uplink =
  | { kind: 'plan'; plan: Plan }
  | { kind: 'image_request'; planId: string; stepId: string };

export type Downlink =
  | { kind: 'ack'; planId: string; version: number; ok: boolean; reason?: string; state: RoverSnapshot }
  | { kind: 'telemetry'; state: RoverSnapshot }
  /** `condition` is link metadata (like a fault code); the packet itself stays exactly the §3 schema. */
  | { kind: 'escalation'; packet: EscalationPacket; condition: string | null; state: RoverSnapshot }
  /** Metadata only; byte cost is the real camera-frame size, not the JSON. */
  | { kind: 'image'; planId: string; stepId: string; bytes: number; state: RoverSnapshot };
