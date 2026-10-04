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

const agentJob = table(
  { name: 'agent_job', public: true },
  {
    id: t.string().primaryKey(),
    contextId: t.string().index('btree'),
    status: t.string(),
    iteration: t.u32(),
    budgetIterations: t.u32(),
    budgetRuns: t.u32(),
    runsUsed: t.u32(),
    bestEnvelopeKey: t.string(),
    stopReason: t.string(),
    accepted: t.bool(),
    score: t.f64(),
    unsafe: t.u32(),
    source: t.string(),
    writtenAt: t.string(),
  },
);

const agentLog = table(
  { name: 'agent_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    jobId: t.string().index('btree'),
    contextId: t.string(),
    seq: t.u32(),
    iteration: t.u32(),
    action: t.string(),
    change: t.string(),
    result: t.string(),
    writtenAt: t.string(),
  },
);

const activeEnvelope = table(
  { name: 'active_envelope', public: true },
  {
    id: t.string().primaryKey(),
    envelopeKey: t.string(),
    envelopeId: t.string(),
    version: t.u32(),
    label: t.string(),
    json: t.string(),
    contextId: t.string(),
    writtenAt: t.string(),
  },
);

const envelope = table(
  { name: 'envelope', public: true },
  {
    id: t.string().primaryKey(),
    jobId: t.string().index('btree'),
    contextId: t.string(),
    envelopeId: t.string(),
    version: t.u32(),
    json: t.string(),
    note: t.string(),
    accepted: t.bool(),
    score: t.f64(),
    unsafe: t.u32(),
    writtenAt: t.string(),
  },
);

const liveScene = table(
  { name: 'live_scene', public: true },
  {
    id: t.string().primaryKey(),
    imageId: t.string(),
    sol: t.u32(),
    camera: t.string(),
    utcDateTaken: t.string(),
    localMeanSolarTime: t.string(),
    daysAgo: t.f64(),
    filePath: t.string(),
    nasaUrl: t.string(),
    credit: t.string(),
    isFallback: t.bool(),
    chosenWhy: t.string(),
    lat: t.option(t.f64()),
    lon: t.option(t.f64()),
    waypointSol: t.option(t.u32()),
    ingestedAt: t.string(),
  },
);

const liveScenePlan = table(
  { name: 'live_scene_plan', public: true },
  {
    id: t.string().primaryKey(),
    imageId: t.string().index('btree'),
    analysisJson: t.string(),
    planJson: t.string(),
    delayMin: t.f64(),
    rangeAu: t.f64(),
    earthDate: t.string(),
    validated: t.bool(),
    validationReasons: t.string(),
    compileSource: t.string(),
    model: t.string(),
    writtenAt: t.string(),
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

const AgentLogInput = t.object('AgentLogInput', {
  seq: t.u32(),
  iteration: t.u32(),
  action: t.string(),
  change: t.string(),
  result: t.string(),
  writtenAt: t.string(),
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

const spacetimedb = schema({
  dataSource,
  missionContext,
  solConditions,
  campaignResult,
  failure,
  agentJob,
  agentLog,
  envelope,
  activeEnvelope,
  liveScene,
  liveScenePlan,
});
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

export const upsertAgentJob = spacetimedb.reducer(
  {
    id: t.string(),
    contextId: t.string(),
    status: t.string(),
    iteration: t.u32(),
    budgetIterations: t.u32(),
    budgetRuns: t.u32(),
    runsUsed: t.u32(),
    bestEnvelopeKey: t.string(),
    stopReason: t.string(),
    accepted: t.bool(),
    score: t.f64(),
    unsafe: t.u32(),
    source: t.string(),
    writtenAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      contextId: args.contextId,
      status: args.status,
      iteration: args.iteration,
      budgetIterations: args.budgetIterations,
      budgetRuns: args.budgetRuns,
      runsUsed: args.runsUsed,
      bestEnvelopeKey: args.bestEnvelopeKey,
      stopReason: args.stopReason,
      accepted: args.accepted,
      score: args.score,
      unsafe: args.unsafe,
      source: args.source,
      writtenAt: args.writtenAt,
    };
    if (ctx.db.agentJob.id.find(args.id)) {
      ctx.db.agentJob.id.update(row);
    } else {
      ctx.db.agentJob.insert(row);
    }
  },
);

export const replaceAgentLogs = spacetimedb.reducer(
  { jobId: t.string(), contextId: t.string(), rows: t.array(AgentLogInput) },
  (ctx, { jobId, contextId, rows }) => {
    for (const existing of ctx.db.agentLog.jobId.filter(jobId)) {
      ctx.db.agentLog.id.delete(existing.id);
    }
    for (const row of rows) {
      ctx.db.agentLog.insert({
        id: 0n,
        jobId,
        contextId,
        seq: row.seq,
        iteration: row.iteration,
        action: row.action,
        change: row.change,
        result: row.result,
        writtenAt: row.writtenAt,
      });
    }
  },
);

export const upsertEnvelope = spacetimedb.reducer(
  {
    id: t.string(),
    jobId: t.string(),
    contextId: t.string(),
    envelopeId: t.string(),
    version: t.u32(),
    json: t.string(),
    note: t.string(),
    accepted: t.bool(),
    score: t.f64(),
    unsafe: t.u32(),
    writtenAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      jobId: args.jobId,
      contextId: args.contextId,
      envelopeId: args.envelopeId,
      version: args.version,
      json: args.json,
      note: args.note,
      accepted: args.accepted,
      score: args.score,
      unsafe: args.unsafe,
      writtenAt: args.writtenAt,
    };
    if (ctx.db.envelope.id.find(args.id)) {
      ctx.db.envelope.id.update(row);
    } else {
      ctx.db.envelope.insert(row);
    }
  },
);

export const setActiveEnvelope = spacetimedb.reducer(
  {
    id: t.string(),
    envelopeKey: t.string(),
    envelopeId: t.string(),
    version: t.u32(),
    label: t.string(),
    json: t.string(),
    contextId: t.string(),
    writtenAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      envelopeKey: args.envelopeKey,
      envelopeId: args.envelopeId,
      version: args.version,
      label: args.label,
      json: args.json,
      contextId: args.contextId,
      writtenAt: args.writtenAt,
    };
    if (ctx.db.activeEnvelope.id.find(args.id)) {
      ctx.db.activeEnvelope.id.update(row);
    } else {
      ctx.db.activeEnvelope.insert(row);
    }
  },
);

export const clearActiveEnvelope = spacetimedb.reducer({ id: t.string() }, (ctx, { id }) => {
  if (ctx.db.activeEnvelope.id.find(id)) ctx.db.activeEnvelope.id.delete(id);
});

export const upsertLiveScene = spacetimedb.reducer(
  {
    id: t.string(),
    imageId: t.string(),
    sol: t.u32(),
    camera: t.string(),
    utcDateTaken: t.string(),
    localMeanSolarTime: t.string(),
    daysAgo: t.f64(),
    filePath: t.string(),
    nasaUrl: t.string(),
    credit: t.string(),
    isFallback: t.bool(),
    chosenWhy: t.string(),
    lat: t.option(t.f64()),
    lon: t.option(t.f64()),
    waypointSol: t.option(t.u32()),
    ingestedAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      imageId: args.imageId,
      sol: args.sol,
      camera: args.camera,
      utcDateTaken: args.utcDateTaken,
      localMeanSolarTime: args.localMeanSolarTime,
      daysAgo: args.daysAgo,
      filePath: args.filePath,
      nasaUrl: args.nasaUrl,
      credit: args.credit,
      isFallback: args.isFallback,
      chosenWhy: args.chosenWhy,
      lat: args.lat,
      lon: args.lon,
      waypointSol: args.waypointSol,
      ingestedAt: args.ingestedAt,
    };
    if (ctx.db.liveScene.id.find(args.id)) {
      ctx.db.liveScene.id.update(row);
    } else {
      ctx.db.liveScene.insert(row);
    }
  },
);

export const upsertLiveScenePlan = spacetimedb.reducer(
  {
    id: t.string(),
    imageId: t.string(),
    analysisJson: t.string(),
    planJson: t.string(),
    delayMin: t.f64(),
    rangeAu: t.f64(),
    earthDate: t.string(),
    validated: t.bool(),
    validationReasons: t.string(),
    compileSource: t.string(),
    model: t.string(),
    writtenAt: t.string(),
  },
  (ctx, args) => {
    const row = {
      id: args.id,
      imageId: args.imageId,
      analysisJson: args.analysisJson,
      planJson: args.planJson,
      delayMin: args.delayMin,
      rangeAu: args.rangeAu,
      earthDate: args.earthDate,
      validated: args.validated,
      validationReasons: args.validationReasons,
      compileSource: args.compileSource,
      model: args.model,
      writtenAt: args.writtenAt,
    };
    if (ctx.db.liveScenePlan.id.find(args.id)) {
      ctx.db.liveScenePlan.id.update(row);
    } else {
      ctx.db.liveScenePlan.insert(row);
    }
  },
);
