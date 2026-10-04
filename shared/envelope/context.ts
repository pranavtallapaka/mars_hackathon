import { DEFAULT_CONCEPT, missionContextId, parseContextId } from './concept';
import { earthDateForSol, mars24, MARS24_PROVENANCE } from './mars24';
import { commState, HORIZONS_PROVENANCE, lookupHorizons, parseHorizonsCsv } from './horizons';
import { emptyBenchmark, perseveranceBenchmark } from './perseverance';
import { SITES, terrainSummary } from './sites';
import type { MissionConcept, MissionContext, SiteId, SolState } from './types';

const SOL_MS = 1.0274912517 * 86400000;

export function parseIsoDate(iso: string): Date {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad date ${iso}`);
  return d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** One mission window: terrain + per-sol comms/delay/daylight + optional Perseverance pace. */
export function loadMissionContext(
  concept: MissionConcept,
  horizonsText?: string,
  conjunctionDeg?: number,
): MissionContext {
  const site = SITES[concept.siteId];
  if (!site) throw new Error(`unknown site ${concept.siteId}`);
  if (concept.sols < 1 || concept.sols > 400) throw new Error('sols must be 1–400');
  if (!horizonsText) throw new Error('horizons CSV text is required');
  const start = parseIsoDate(concept.startDate);
  const table = parseHorizonsCsv(horizonsText);
  const terrain = terrainSummary(concept.siteId);
  const sols: SolState[] = [];

  for (let i = 0; i < concept.sols; i++) {
    const when = new Date(start.getTime() + i * SOL_MS);
    const earthDate = isoDay(when);
    const row = lookupHorizons(table, earthDate);
    const clock = mars24(when, site.lat, site.lonEast);
    sols.push({
      solIndex: i,
      earthDate,
      delayMin: Math.round(row.delayMin * 10) / 10,
      rangeAu: row.rangeAu,
      sotDeg: row.sotDeg,
      comm: commState(row, conjunctionDeg),
      lsDeg: Math.round(clock.lsDeg * 10) / 10,
      season: clock.season,
      msd: Math.round(clock.msd * 1000) / 1000,
      lmstHours: Math.round(clock.lmstHours * 100) / 100,
      sunElevationDeg: Math.round(clock.sunElevationDeg * 10) / 10,
      daylightHours: Math.round(clock.daylightHours * 10) / 10,
      isDay: clock.sunElevationDeg > 0,
    });
  }

  const benchmark = concept.siteId === 'jezero' ? perseveranceBenchmark() : emptyBenchmark('Perseverance traverse is a Jezero benchmark only.');

  return {
    concept,
    site,
    terrain,
    sols,
    benchmark,
    sources: {
      horizons: HORIZONS_PROVENANCE,
      mars24: MARS24_PROVENANCE,
      terrain: terrain.source,
      perseverance: benchmark.source,
    },
    conjunctionThresholdDeg: conjunctionDeg ?? 3,
  };
}

export function siteIds(): SiteId[] {
  return Object.keys(SITES) as SiteId[];
}

export { DEFAULT_CONCEPT, earthDateForSol, missionContextId, parseContextId, SITES };
