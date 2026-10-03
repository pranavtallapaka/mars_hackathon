import { CACHED_DEMO_PLAN } from '../../../../shared/missions/mars-demo';
import { featureById, findPath } from '../grid';
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

// Fraction along the route to wp-A where the staged boulder sits.
const BOULDER_ROUTE_FRACTION = 0.6;

export function buildMarsMission(map: SimMap): MarsMission {
  const wpA = featureById(map, 'wp-A')!;
  const route = findPath(map, map.roverStart, wpA.pos)!;
  const boulder = route[Math.floor(route.length * BOULDER_ROUTE_FRACTION)];

  return {
    hiddenObstacles: [boulder],
    sites: {
      'outcrop-1': {
        drillStallCm: 4,
        confidence: 0.85,
        scene: {
          objects: ['layered outcrop face 1 m ahead'],
          slopeDeg: 18,
          terrain: 'loose regolith right',
        },
      },
      'outcrop-2': {
        confidence: 0.8,
        scene: { slopeDeg: 9, terrain: 'exposed bedrock' },
      },
    },
  };
}
