export type CommState = 'normal' | 'long_gap' | 'conjunction';

export type SeasonName = 'northern_spring' | 'northern_summer' | 'northern_autumn' | 'northern_winter';

export interface Provenance {
  source: string;
  url?: string;
  retrieved?: string;
  note?: string;
}

export type SiteId = 'jezero' | 'oxia';

export interface SiteDef {
  id: SiteId;
  label: string;
  /** Planetocentric latitude, degrees north. */
  lat: number;
  /** Planetocentric longitude, degrees east. */
  lonEast: number;
  terrainKind: 'hirise' | 'synthetic';
  productId?: string;
  dataset?: string;
  cellMeters: number;
}

export interface TerrainSummary {
  site: SiteDef;
  slopeMeanDeg?: number;
  slopeP90Deg?: number;
  rockFrac?: number;
  sandFrac?: number;
  source: Provenance;
}

export interface SolState {
  solIndex: number;
  earthDate: string;
  delayMin: number;
  rangeAu: number;
  sotDeg: number;
  comm: CommState;
  lsDeg: number;
  season: SeasonName;
  msd: number;
  lmstHours: number;
  sunElevationDeg: number;
  daylightHours: number;
  isDay: boolean;
}

export interface BenchmarkStats {
  available: boolean;
  solFirst?: number;
  solLast?: number;
  driveSols?: number;
  distanceKm?: number;
  kmPerSol?: number;
  source: Provenance;
}

export interface MissionConcept {
  siteId: SiteId;
  startDate: string;
  sols: number;
}

export interface MissionContext {
  concept: MissionConcept;
  site: SiteDef;
  terrain: TerrainSummary;
  sols: SolState[];
  benchmark: BenchmarkStats;
  sources: {
    horizons: Provenance;
    mars24: Provenance;
    terrain: Provenance;
    perseverance: Provenance;
  };
  conjunctionThresholdDeg: number;
}
