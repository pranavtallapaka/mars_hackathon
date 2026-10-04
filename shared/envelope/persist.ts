import { missionContextId } from './concept';
import type { MissionContext, Provenance } from './types';

const SOURCE_VERSION = 'a1';

export interface DataSourceWrite {
  name: string;
  source: string;
  version: string;
  retrieved: string | undefined;
  url: string | undefined;
  note: string | undefined;
}

export interface MissionContextWrite {
  id: string;
  siteId: string;
  siteLabel: string;
  startDate: string;
  sols: number;
  terrainKind: string;
  terrainProductId: string | undefined;
  terrainNote: string | undefined;
  conjunctionThresholdDeg: number;
  benchmarkAvailable: boolean;
  benchmarkKmPerSol: number | undefined;
  benchmarkNote: string | undefined;
  loadedAt: string;
}

export interface SolConditionWrite {
  solIndex: number;
  earthDate: string;
  delayMin: number;
  rangeAu: number;
  sotDeg: number;
  comm: string;
  lsDeg: number;
  season: string;
  msd: number;
  lmstHours: number;
  sunElevationDeg: number;
  daylightHours: number;
  isDay: boolean;
  dataSource: string;
}

function sourceWrite(name: string, p: Provenance): DataSourceWrite {
  return {
    name,
    source: p.source,
    version: p.retrieved ?? SOURCE_VERSION,
    retrieved: p.retrieved,
    url: p.url,
    note: p.note,
  };
}

export function dataSourceWrites(ctx: MissionContext): DataSourceWrite[] {
  return [
    sourceWrite('horizons', ctx.sources.horizons),
    sourceWrite('mars24', ctx.sources.mars24),
    sourceWrite('terrain', ctx.sources.terrain),
    sourceWrite('perseverance', ctx.sources.perseverance),
  ];
}

export function missionContextWrite(ctx: MissionContext, loadedAt: string): MissionContextWrite {
  return {
    id: missionContextId(ctx.concept),
    siteId: ctx.concept.siteId,
    siteLabel: ctx.site.label,
    startDate: ctx.concept.startDate,
    sols: ctx.concept.sols,
    terrainKind: ctx.terrain.site.terrainKind,
    terrainProductId: ctx.site.productId,
    terrainNote: ctx.terrain.source.note,
    conjunctionThresholdDeg: ctx.conjunctionThresholdDeg,
    benchmarkAvailable: ctx.benchmark.available,
    benchmarkKmPerSol: ctx.benchmark.kmPerSol,
    benchmarkNote: ctx.benchmark.source.note,
    loadedAt,
  };
}

export interface AgentJobWrite {
  id: string;
  contextId: string;
  status: string;
  iteration: number;
  budgetIterations: number;
  budgetRuns: number;
  runsUsed: number;
  bestEnvelopeKey: string;
  stopReason: string;
  accepted: boolean;
  score: number;
  unsafe: number;
  source: string;
  writtenAt: string;
}

export interface AgentLogWrite {
  seq: number;
  iteration: number;
  action: string;
  change: string;
  result: string;
  writtenAt: string;
}

export interface EnvelopeWrite {
  id: string;
  jobId: string;
  contextId: string;
  envelopeId: string;
  version: number;
  json: string;
  note: string;
  accepted: boolean;
  score: number;
  unsafe: number;
  writtenAt: string;
}

export function solConditionWrites(ctx: MissionContext): SolConditionWrite[] {
  return ctx.sols.map((s) => ({
    solIndex: s.solIndex,
    earthDate: s.earthDate,
    delayMin: s.delayMin,
    rangeAu: s.rangeAu,
    sotDeg: s.sotDeg,
    comm: s.comm,
    lsDeg: s.lsDeg,
    season: s.season,
    msd: s.msd,
    lmstHours: s.lmstHours,
    sunElevationDeg: s.sunElevationDeg,
    daylightHours: s.daylightHours,
    isDay: s.isDay,
    dataSource: 'horizons,mars24',
  }));
}
