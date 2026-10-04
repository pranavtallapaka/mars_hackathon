import horizonsCsv from '../../../shared/envelope/data/earth-mars-2026-2028.csv?raw';
import { commState, lookupHorizons, parseHorizonsCsv } from '../../../shared/envelope/horizons';
import {
  applyEnvelope,
  classifyTerrain,
  parseEnvelope,
  type Envelope,
  type TerrainClass,
} from '../../../shared/envelope/schema';
import { terrainSummary } from '../../../shared/envelope/sites';
import type { CommState, SiteId } from '../../../shared/envelope/types';
import { confidenceThreshold, type Plan } from '../../../shared/plan';
import type { TerrainId } from './types';

export const ACTIVE_ENVELOPE_ID = 'mission-control';

const HORIZONS = parseHorizonsCsv(horizonsCsv);

export function siteIdForTerrain(terrain: TerrainId): SiteId {
  return terrain === 'jezero' ? 'jezero' : 'oxia';
}

export function commForDate(isoDate: string): CommState {
  return commState(lookupHorizons(HORIZONS, isoDate));
}

/** Overlay the active envelope's matching terrain×comm cell onto a compiled plan. */
export function overlayActiveEnvelope(
  plan: Plan,
  envelope: Envelope | null,
  terrain: TerrainId,
  isoDate: string,
): Plan {
  if (!envelope) return plan;
  return applyEnvelope(plan, envelope, {
    terrain: classifyTerrain(terrainSummary(siteIdForTerrain(terrain))),
    comm: commForDate(isoDate),
  });
}

export function parseActiveEnvelope(json: string): Envelope | null {
  try {
    return parseEnvelope(JSON.parse(json));
  } catch {
    return null;
  }
}

export function envelopeWindowLabel(siteId: SiteId, startDate: string, sols: number, version: number): string {
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(start.getTime() + Math.max(0, sols - 1) * 86_400_000);
  const month = (d: Date) => d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = end.getUTCFullYear();
  const site = siteId === 'jezero' ? 'Jezero' : 'Oxia';
  const span = start.getUTCMonth() === end.getUTCMonth() ? `${month(start)} ${year}` : `${month(start)}–${month(end)} ${year}`;
  return `${site} ${span}, v${version}`;
}

export interface PolicyOverlay {
  label: string;
  terrainClass: TerrainClass;
  comm: CommState;
  delayMin: number;
  battery: { compiled: number; applied: number };
  confidence: { compiled: number | null; applied: number | null };
  changed: boolean;
  useCase: string;
}

const COMM_LABEL: Record<CommState, string> = {
  normal: 'normal comm',
  long_gap: 'long gap',
  conjunction: 'conjunction',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function midpointPct(a: number, b: number): number {
  return Math.round(((a + b) / 2) * 100);
}

function policyUseCase(overlay: Omit<PolicyOverlay, 'label' | 'changed' | 'useCase'>): string {
  const cell = `${overlay.terrainClass} × ${COMM_LABEL[overlay.comm]}`;
  const wait = Math.round(overlay.delayMin * 2);
  const { battery, confidence } = overlay;

  if (confidence.compiled !== null && confidence.applied !== null && confidence.compiled !== confidence.applied) {
    const sample = midpointPct(confidence.compiled, confidence.applied);
    if (confidence.applied < confidence.compiled) {
      return `Use case: the rover IDs a target at ${sample}% confidence. The compiler calls Earth and you wait ${wait} min. The envelope keeps working onboard — the agent already scored this ${cell} cell with 0 unsafe outcomes.`;
    }
    return `Use case: the rover IDs a target at ${sample}% confidence. The compiler would keep going. The envelope calls Earth — the agent tightened this ${cell} cell.`;
  }

  if (battery.compiled !== battery.applied) {
    const sample = Math.round((battery.compiled + battery.applied) / 2);
    if (battery.applied < battery.compiled) {
      return `Use case: battery hits ${sample}%. The compiler stops at ${battery.compiled}%. The envelope keeps working down to ${battery.applied}% so you do not spend ${wait} min on a call the campaign already judged safe.`;
    }
    return `Use case: battery hits ${sample}%. The compiler would continue. The envelope stops at ${battery.applied}% — the agent raised the floor for this ${cell} cell.`;
  }

  return `The envelope cell for ${cell} matches the compiler defaults. Remove the envelope to fly without it.`;
}

/** Name the cell and the compiler → envelope diffs so /control can show the policy, not just apply it. */
export function describePolicyOverlay(
  compiled: Plan,
  envelope: Envelope,
  terrain: TerrainId,
  isoDate: string,
  label: string,
): PolicyOverlay {
  const key = {
    terrain: classifyTerrain(terrainSummary(siteIdForTerrain(terrain))),
    comm: commForDate(isoDate),
  };
  const applied = applyEnvelope(compiled, envelope, key);
  const delayMin = Math.round(lookupHorizons(HORIZONS, isoDate).delayMin * 10) / 10;
  const battery = { compiled: compiled.limits.batteryFloorPct, applied: applied.limits.batteryFloorPct };
  const confidence = {
    compiled: confidenceThreshold(compiled),
    applied: confidenceThreshold(applied),
  };
  const body = { terrainClass: key.terrain, comm: key.comm, delayMin, battery, confidence };
  return {
    label,
    ...body,
    changed: battery.compiled !== battery.applied || confidence.compiled !== confidence.applied,
    useCase: policyUseCase(body),
  };
}

export function formatConfidence(n: number | null): string {
  return n === null ? '—' : pct(n);
}
