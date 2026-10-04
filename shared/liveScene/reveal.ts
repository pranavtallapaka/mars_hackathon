import { createPlanSchema, type Plan, type PlanStep } from '../plan';
import { MARS_SURFACE } from '../scenario';
import { pickBestTarget, sceneAnalysisSchema, type SceneAnalysis } from './analysis';

export const LIVE_DISCLAIMER =
  'We are not commanding Perseverance. This is the plan our system would send for the scene it last photographed.';

export const NASA_CREDIT = 'NASA/JPL-Caltech';

export const HIRISE_FRAME = {
  south: 18.44915793155509,
  west: 77.4929141157377,
  north: 18.45588901477327,
  east: 77.5033754296448,
  productId: 'DTEEC_048842_1985_048908_1985_U01',
};

/** Wide enough to hold the current traverse west of the landing-site DTM crop. */
export const JEZERO_INSET = {
  south: 18.35,
  north: 18.5,
  west: 77.18,
  east: 77.56,
};

export interface LiveRevealScene {
  imageId: string;
  sol: number;
  camera: string;
  utcDateTaken: string;
  daysAgo: number;
  nasaUrl: string;
  credit: string;
  isFallback: boolean;
  lat?: number;
  lon?: number;
  waypointSol?: number;
}

export interface LiveRevealView {
  scene: LiveRevealScene;
  analysis: SceneAnalysis;
  plan: Plan;
  delayMin: number;
  rangeAu: number;
  earthDate: string;
  chosenTargetId: string;
}

export interface BranchHazardLink {
  condition: string;
  then: string;
  hazards: Array<{ type: string; reason: string; severity?: string }>;
}

export function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const rec = value as { some?: unknown; value?: unknown };
    if (typeof rec.some === 'number' && Number.isFinite(rec.some)) return rec.some;
    if (typeof rec.value === 'number' && Number.isFinite(rec.value)) return rec.value;
  }
  return undefined;
}

export function cameraShortName(camera: string): string {
  const upper = camera.toUpperCase();
  if (upper.includes('NAVCAM')) return 'Navcam';
  if (upper.includes('HAZCAM')) return 'Hazcam';
  return camera.replaceAll('_', ' ') || 'Navcam';
}

export function daysAgoFromUtc(utc: string, now = new Date()): number {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(utc) ? utc : `${utc}Z`;
  const taken = Date.parse(normalized);
  if (!Number.isFinite(taken)) return 0;
  return Math.max(0, Math.round(((now.getTime() - taken) / 86_400_000) * 1000) / 1000);
}

export function daysAgoPhrase(days: number): string {
  if (!Number.isFinite(days) || days < 0.5) return 'today';
  if (days < 1.5) return '1 day ago';
  return `${Math.round(days)} days ago`;
}

export function sceneCaption(scene: Pick<LiveRevealScene, 'sol' | 'daysAgo' | 'camera'>): string {
  return `Taken by Perseverance on Mars, sol ${scene.sol}, ${daysAgoPhrase(scene.daysAgo)}. ${cameraShortName(scene.camera)}.`;
}

export function formatLightTime(delayMin: number): { minutes: number; seconds: number; label: string } {
  const totalSec = Math.max(0, Math.round(delayMin * 60));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return { minutes, seconds, label: `${minutes} min ${seconds} s` };
}

export function delaySentence(delayMin: number): string {
  return `Today, this plan would take ${formatLightTime(delayMin).label} to reach Mars.`;
}

export function oneLine(text: string, max = 110): string {
  const first = (text.split(/(?<=\.)\s/)[0] ?? text).trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1).trimEnd()}…`;
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${ns} ${Math.abs(lon).toFixed(3)}°${ew}`;
}

export function lonLatToPct(
  lat: number,
  lon: number,
  box: { south: number; west: number; north: number; east: number } = JEZERO_INSET,
): { x: number; y: number; inside: boolean } {
  const x = (lon - box.west) / (box.east - box.west);
  const y = (box.north - lat) / (box.north - box.south);
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    inside: x >= 0 && x <= 1 && y >= 0 && y <= 1,
  };
}

export function hazardsForCondition(condition: string, hazards: SceneAnalysis['hazards']): SceneAnalysis['hazards'] {
  if (condition === 'path_blocked') return hazards.filter((h) => h.type === 'rock');
  if (condition === 'hazard_detected') {
    const ranked = hazards.filter(
      (h) => h.type === 'steep_slope' || h.type === 'sand_soft_soil' || h.type === 'drop_off' || h.severity !== 'low',
    );
    return ranked.length ? ranked : hazards.filter((h) => h.type !== 'rock');
  }
  return [];
}

export function branchLinks(step: PlanStep, hazards: SceneAnalysis['hazards']): BranchHazardLink[] {
  return step.branches.map((branch) => ({
    condition: branch.if,
    then: branch.then,
    hazards: hazardsForCondition(branch.if, hazards).map((h) => ({
      type: h.type,
      reason: oneLine(h.reason),
      severity: h.severity,
    })),
  }));
}

export function chosenTargetLabel(analysis: SceneAnalysis, fallback = 'the chosen target'): string {
  const best = pickBestTarget(analysis);
  if (!best) return fallback;
  return best.type.replaceAll('_', ' ');
}

export function parseAnalysisJson(raw: string): SceneAnalysis | null {
  try {
    const parsed = sceneAnalysisSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parsePlanJson(raw: string): Plan | null {
  try {
    const parsed = createPlanSchema(MARS_SURFACE).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function assembleReveal(input: {
  scene: LiveRevealScene;
  analysis: SceneAnalysis;
  plan: Plan;
  delayMin: number;
  rangeAu?: number;
  earthDate?: string;
}): LiveRevealView {
  const best = pickBestTarget(input.analysis);
  const chosenTargetId =
    best && input.plan.steps[0]?.args.target
      ? String(input.plan.steps[0].args.target)
      : best
        ? best.type
        : 'target';
  return {
    scene: input.scene,
    analysis: input.analysis,
    plan: input.plan,
    delayMin: input.delayMin,
    rangeAu: input.rangeAu ?? 0,
    earthDate: input.earthDate ?? '',
    chosenTargetId,
  };
}
