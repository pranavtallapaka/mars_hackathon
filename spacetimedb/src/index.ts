import { schema, table, t } from 'spacetimedb/server';

const dataSource = table(
  { name: 'data_source', public: true },
  {
    name: t.string().primaryKey(),
    source: t.string(),
    version: t.string(),
    retrieved: t.option(t.string()),
    url: t.option(t.string()),
    note: t.option(t.string()),
  },
);

const missionContext = table(
  { name: 'mission_context', public: true },
  {
    id: t.string().primaryKey(),
    siteId: t.string(),
    siteLabel: t.string(),
    startDate: t.string(),
    sols: t.u32(),
    terrainKind: t.string(),
    terrainProductId: t.option(t.string()),
    terrainNote: t.option(t.string()),
    conjunctionThresholdDeg: t.f64(),
    benchmarkAvailable: t.bool(),
    benchmarkKmPerSol: t.option(t.f64()),
    benchmarkNote: t.option(t.string()),
    loadedAt: t.string(),
  },
);

const solConditions = table(
  { name: 'sol_conditions', public: true },
  {
    id: t.string().primaryKey(),
    contextId: t.string().index('btree'),
    solIndex: t.u32(),
    earthDate: t.string(),
    delayMin: t.f64(),
    rangeAu: t.f64(),
    sotDeg: t.f64(),
    comm: t.string(),
    lsDeg: t.f64(),
    season: t.string(),
    msd: t.f64(),
    lmstHours: t.f64(),
    sunElevationDeg: t.f64(),
    daylightHours: t.f64(),
    isDay: t.bool(),
    dataSource: t.string(),
  },
);

const campaignResult = table(
  { name: 'campaign_result', public: true },
  {
    id: t.string().primaryKey(),
    contextId: t.string().index('btree'),
    iteration: t.u32(),
    side: t.string(),
    runs: t.u32(),
    finished: t.u32(),
    unsafe: t.u32(),
    blackoutSols: t.u32(),
    nightSols: t.u32(),
    operationalSols: t.u32(),
    meanRoundTrips: t.f64(),
    meanMissionMin: t.f64(),
    meanBytesDown: t.f64(),
    meanEscalations: t.f64(),
    sols: t.u32(),
    elapsedMs: t.f64(),
    seed: t.u32(),
    writtenAt: t.string(),
  },
);

const failure = table(
  { name: 'failure', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    resultId: t.string().index('btree'),
    contextId: t.string(),
    runIndex: t.u32(),
    seed: t.u32(),
    solIndex: t.u32(),
    cellX: t.i32(),
    cellY: t.i32(),
    reason: t.string(),
    detail: t.string(),
    side: t.string(),
  },
);

const FailureInput = t.object('FailureInput', {
  runIndex: t.u32(),
  seed: t.u32(),
  solIndex: t.u32(),
  cellX: t.i32(),
  cellY: t.i32(),
  reason: t.string(),
  detail: t.string(),
  side: t.string(),
});

const SolConditionInput = t.object('SolConditionInput', {
  solIndex: t.u32(),
  earthDate: t.string(),
  delayMin: t.f64(),
  rangeAu: t.f64(),
  sotDeg: t.f64(),
  comm: t.string(),
  lsDeg: t.f64(),
  season: t.string(),
  msd: t.f64(),
  lmstHours: t.f64(),
  sunElevationDeg: t.f64(),
  daylightHours: t.f64(),
  isDay: t.bool(),
  dataSource: t.string(),
});

const spacetimedb = schema({ dataSource, missionContext, solConditions, campaignResult, failure });
export default spacetimedb;

export const upsertDataSource = spacetimedb.reducer(
  {
    name: t.string(),
    source: t.string(),
    version: t.string(),
    retrieved: t.option(t.string()),
    url: t.option(t.string()),
    note: t.option(t.string()),
  },
  (ctx, args) => {
    const row = {
      name: args.name,
      source: args.source,
      version: args.version,
      retrieved: args.retrieved,
      url: args.url,
      note: args.note,
    };
    if (ctx.db.dataSource.name.find(args.name)) {
      ctx.db.dataSource.name.update(row);
    } else {
      ctx.db.dataSource.insert(row);
    }
  },
);

export const upsertMissionContext = spacetimedb.reducer(
  {
    id: t.string(),
    siteId: t.string(),
    siteLabel: t.string(),
    startDate: t.string(),
    sols: t.u32(),
    terrainKind: t.string(),
    terrainProductId: t.option(t.string()),
    terrainNote: t.option(t.string()),
    conjunctionThresholdDeg: t.f64(),
    benchmarkAvailable: t.bool(),
    benchmarkKmPerSol: t.option(t.f64()),
    benchmarkNote: t.option(t.string()),
    loadedAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      siteId: args.siteId,
      siteLabel: args.siteLabel,
      startDate: args.startDate,
      sols: args.sols,
      terrainKind: args.terrainKind,
      terrainProductId: args.terrainProductId,
      terrainNote: args.terrainNote,
      conjunctionThresholdDeg: args.conjunctionThresholdDeg,
      benchmarkAvailable: args.benchmarkAvailable,
      benchmarkKmPerSol: args.benchmarkKmPerSol,
      benchmarkNote: args.benchmarkNote,
      loadedAt: args.loadedAt,
    };
    if (ctx.db.missionContext.id.find(args.id)) {
      ctx.db.missionContext.id.update(row);
    } else {
      ctx.db.missionContext.insert(row);
    }
  },
);

export const replaceSolConditions = spacetimedb.reducer(
  { contextId: t.string(), rows: t.array(SolConditionInput) },
  (ctx, { contextId, rows }) => {
    for (const existing of ctx.db.solConditions.contextId.filter(contextId)) {
      ctx.db.solConditions.id.delete(existing.id);
    }
    for (const row of rows) {
      ctx.db.solConditions.insert({
        id: `${contextId}:${row.solIndex}`,
        contextId,
        ...row,
      });
    }
  },
);

export const upsertCampaignResult = spacetimedb.reducer(
  {
    id: t.string(),
    contextId: t.string(),
    iteration: t.u32(),
    side: t.string(),
    runs: t.u32(),
    finished: t.u32(),
    unsafe: t.u32(),
    blackoutSols: t.u32(),
    nightSols: t.u32(),
    operationalSols: t.u32(),
    meanRoundTrips: t.f64(),
    meanMissionMin: t.f64(),
    meanBytesDown: t.f64(),
    meanEscalations: t.f64(),
    sols: t.u32(),
    elapsedMs: t.f64(),
    seed: t.u32(),
    writtenAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      contextId: args.contextId,
      iteration: args.iteration,
      side: args.side,
      runs: args.runs,
      finished: args.finished,
      unsafe: args.unsafe,
      blackoutSols: args.blackoutSols,
      nightSols: args.nightSols,
      operationalSols: args.operationalSols,
      meanRoundTrips: args.meanRoundTrips,
      meanMissionMin: args.meanMissionMin,
      meanBytesDown: args.meanBytesDown,
      meanEscalations: args.meanEscalations,
      sols: args.sols,
      elapsedMs: args.elapsedMs,
      seed: args.seed,
      writtenAt: args.writtenAt,
    };
    if (ctx.db.campaignResult.id.find(args.id)) {
      ctx.db.campaignResult.id.update(row);
    } else {
      ctx.db.campaignResult.insert(row);
    }
  },
);

export const replaceFailures = spacetimedb.reducer(
  { resultId: t.string(), contextId: t.string(), rows: t.array(FailureInput) },
  (ctx, { resultId, contextId, rows }) => {
    for (const existing of ctx.db.failure.resultId.filter(resultId)) {
      ctx.db.failure.id.delete(existing.id);
    }
    for (const row of rows) {
      ctx.db.failure.insert({
        id: 0n,
        resultId,
        contextId,
        runIndex: row.runIndex,
        seed: row.seed,
        solIndex: row.solIndex,
        cellX: row.cellX,
        cellY: row.cellY,
        reason: row.reason,
        detail: row.detail,
        side: row.side,
      });
    }
  },
);
