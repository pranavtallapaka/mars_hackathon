import jezeroMap from '../mars/jezero.map.json';
import type { Provenance, SiteDef, SiteId, TerrainSummary } from './types';

export const SITES: Record<SiteId, SiteDef> = {
  jezero: {
    id: 'jezero',
    label: 'Jezero crater',
    lat: (jezeroMap.source.bbox.north + jezeroMap.source.bbox.south) / 2,
    lonEast: (jezeroMap.source.bbox.east + jezeroMap.source.bbox.west) / 2,
    terrainKind: 'hirise',
    productId: jezeroMap.source.productId,
    dataset: jezeroMap.source.dataset,
    cellMeters: jezeroMap.cellMeters,
  },
  oxia: {
    id: 'oxia',
    label: 'Oxia Planum',
    lat: 18.16,
    lonEast: 335.37,
    terrainKind: 'synthetic',
    cellMeters: 25,
  },
};

function frac(cells: readonly string[], kind: string): number {
  if (!cells.length) return 0;
  return cells.filter((c) => c === kind).length / cells.length;
}

export function terrainSummary(id: SiteId): TerrainSummary {
  const site = SITES[id];
  if (id === 'jezero') {
    const slopes = jezeroMap.slopesDeg.map((v) => v ?? 0).sort((a, b) => a - b);
    const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;
    const p90 = slopes[Math.floor(slopes.length * 0.9)] ?? 0;
    const source: Provenance = {
      source: `HiRISE DTM ${jezeroMap.source.productId}`,
      url: 'https://www.uahirise.org/dtm/',
      note: `${jezeroMap.source.site}. Elevations metres above the Mars 2000 areoid.`,
    };
    return {
      site,
      slopeMeanDeg: Math.round(mean * 10) / 10,
      slopeP90Deg: Math.round(p90 * 10) / 10,
      rockFrac: Math.round(frac(jezeroMap.cells, 'rock') * 1000) / 1000,
      sandFrac: Math.round(frac(jezeroMap.cells, 'sand') * 1000) / 1000,
      source,
    };
  }
  return {
    site,
    source: {
      source: 'Synthetic operational grid',
      note: 'No HiRISE DTM in-repo for Oxia Planum. Coordinates are the ESA Rosalind Franklin landing site; Mars24 and Horizons still use the real location.',
    },
  };
}
