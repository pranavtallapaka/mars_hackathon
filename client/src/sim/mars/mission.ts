import { CACHED_DEMO_PLAN } from '../../../../shared/missions/mars-demo';
import { DEMO_SEED } from '../config';
import { cellIndex, featureById, findPath, samePos } from '../grid';
import { mulberry32 } from '../rng';
import type { SimMap, Vec } from '../types';

export interface SiteProps {
  /** Drill stalls at this depth: the staged hard-rock surprise. */
  drillStallCm?: number;
  /** Target-identification confidence when imaged. */
  confidence?: number;
  scene?: { objects?: string[]; slopeDeg?: number; terrain?: string };
}

/** Ground truth the ground's map doesn't show. Same for every run of a seed. */
export interface MarsMission {
  hiddenObstacles: Vec[];
  sites: Record<string, SiteProps>;
}

export const DEMO_PLAN: unknown = CACHED_DEMO_PLAN;

// Fraction along the route to wp-A where the scripted demo boulder sits.
const DEMO_BOULDER_FRACTION = 0.6;

function slopeAt(map: SimMap, id: string, fallback: number): number {
  const f = featureById(map, id);
  if (!f || !map.slopesDeg) return fallback;
  return Math.round(map.slopesDeg[cellIndex(map, f.pos)] * 10) / 10;
}

function demoSites(map: SimMap, drillStallCm?: number): Record<string, SiteProps> {
  return {
    'outcrop-1': {
      ...(drillStallCm !== undefined ? { drillStallCm } : {}),
      confidence: 0.85,
      scene: {
        objects: ['layered outcrop face 1 m ahead'],
        slopeDeg: slopeAt(map, 'outcrop-1', 18),
        terrain: 'loose regolith right',
      },
    },
    'outcrop-2': {
      confidence: 0.8,
      scene: { slopeDeg: slopeAt(map, 'outcrop-2', 9), terrain: 'exposed bedrock' },
    },
  };
}

/** Cell along the path from `from` to `targetId`, excluding the endpoints. */
export function cellOnRoute(map: SimMap, from: Vec, targetId: string, fraction: number): Vec | null {
  const dest = featureById(map, targetId);
  if (!dest) return null;
  const route = findPath(map, from, dest.pos);
  if (!route || route.length < 3) return null;
  const i = Math.max(1, Math.min(route.length - 2, Math.floor(route.length * fraction)));
  return route[i];
}

function pushUnique(into: Vec[], cell: Vec | null): void {
  if (!cell || into.some((p) => samePos(p, cell))) return;
  into.push(cell);
}

/** Ground truth for a seed. Seed 42 is the scripted demo; every other seed randomizes surprises. */
export function buildMarsMission(map: SimMap, seed = DEMO_SEED): MarsMission {
  if (seed === DEMO_SEED) {
    return {
      hiddenObstacles: [cellOnRoute(map, map.roverStart, 'wp-A', DEMO_BOULDER_FRACTION)!],
      sites: demoSites(map, 4),
    };
  }

  const rng = mulberry32(seed);
  const hidden: Vec[] = [];
  if (rng() < 0.8) {
    pushUnique(hidden, cellOnRoute(map, map.roverStart, 'wp-A', 0.35 + rng() * 0.45));
  }
  // Alternate approach blocked: the cached plan's s1b has no further branch, so this escalates.
  if (rng() < 0.25) {
    pushUnique(hidden, cellOnRoute(map, map.roverStart, 'wp-A-alt', 0.4 + rng() * 0.4));
  }

  const drillStallCm = rng() < 0.3 ? undefined : 3 + Math.floor(rng() * 3);
  return { hiddenObstacles: hidden, sites: demoSites(map, drillStallCm) };
}
