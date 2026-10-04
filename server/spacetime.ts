import type { CampaignReport, CampaignSideReport } from '../client/src/sim/campaign';
import type { AgentEvent, AgentJobSnapshot, AgentLogEntry } from '../client/src/sim/agent';
import { DbConnection } from '../client/src/module_bindings';
import { missionContextId } from '../shared/envelope/concept';
import { dataSourceWrites, missionContextWrite, solConditionWrites } from '../shared/envelope/persist';
import type { Envelope } from '../shared/envelope/schema';
import type { MissionContext } from '../shared/envelope/types';
import type { LiveScenePlanWrite } from './liveAnalyze';
import { LIVE_SCENE_ID, type LiveSceneRecord } from './liveScene';

const URI = process.env.SPACETIMEDB_URI ?? 'ws://127.0.0.1:3000';
const DB_NAME = process.env.SPACETIMEDB_DB_NAME ?? process.env.SPACETIMEDB_DB_ID ?? 'pranavtallapaka';
const TOKEN = process.env.SPACETIMEDB_TOKEN;
const CONNECT_MS = 8000;

let connected: DbConnection | null = null;
let connecting: Promise<DbConnection> | null = null;

export function spacetimeConfig(): { uri: string; dbName: string } {
  return { uri: URI, dbName: DB_NAME };
}

export function spacetimeConnected(): boolean {
  return connected !== null;
}

export async function getSpacetime(): Promise<DbConnection> {
  if (connected) return connected;
  if (connecting) return connecting;

  connecting = new Promise<DbConnection>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      connecting = null;
      reject(new Error(`SpacetimeDB connect timed out (${URI} / ${DB_NAME})`));
    }, CONNECT_MS);

    let builder = DbConnection.builder().withUri(URI).withDatabaseName(DB_NAME);
    if (TOKEN) builder = builder.withToken(TOKEN);

    builder
      .onConnect((conn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connected = conn;
        connecting = null;
        resolve(conn);
      })
      .onConnectError((_ctx, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connected = null;
        connecting = null;
        reject(err);
      })
      .onDisconnect(() => {
        connected = null;
        connecting = null;
      })
      .build();
  });

  return connecting;
}

export async function persistMissionContext(ctx: MissionContext): Promise<string> {
  const conn = await getSpacetime();
  const loadedAt = new Date().toISOString();
  const id = missionContextId(ctx.concept);

  for (const source of dataSourceWrites(ctx)) {
    await conn.reducers.upsertDataSource(source);
  }
  await conn.reducers.upsertMissionContext(missionContextWrite(ctx, loadedAt));
  await conn.reducers.replaceSolConditions({
    contextId: id,
    rows: solConditionWrites(ctx),
  });
  return id;
}

function resultId(report: CampaignReport, side: CampaignSideReport['side']): string {
  return `${report.contextId}:${report.iteration}:${side}`;
}

function sideWrite(report: CampaignReport, side: CampaignSideReport, writtenAt: string) {
  return {
    id: resultId(report, side.side),
    contextId: report.contextId,
    iteration: report.iteration,
    side: side.side,
    runs: side.runs,
    finished: side.finished,
    unsafe: side.unsafe,
    blackoutSols: side.blackoutSols,
    nightSols: side.nightSols,
    operationalSols: side.operationalSols,
    meanRoundTrips: side.meanRoundTrips,
    meanMissionMin: side.meanMissionMin,
    meanBytesDown: side.meanBytesDown,
    meanEscalations: side.meanEscalations,
    sols: report.sols,
    elapsedMs: report.elapsedMs,
    seed: report.seed,
    writtenAt,
  };
}

export async function persistCampaign(report: CampaignReport): Promise<void> {
  const conn = await getSpacetime();
  const writtenAt = new Date().toISOString();
  await conn.reducers.upsertCampaignResult(sideWrite(report, report.baseline, writtenAt));
  await conn.reducers.upsertCampaignResult(sideWrite(report, report.envelope, writtenAt));
  const baselineId = resultId(report, 'baseline');
  const envelopeId = resultId(report, 'envelope');
  await conn.reducers.replaceFailures({
    resultId: baselineId,
    contextId: report.contextId,
    rows: report.failures.filter((f) => f.side === 'baseline'),
  });
  await conn.reducers.replaceFailures({
    resultId: envelopeId,
    contextId: report.contextId,
    rows: report.failures.filter((f) => f.side === 'envelope'),
  });
}

function jobWrite(job: AgentJobSnapshot, writtenAt: string) {
  return {
    id: job.id,
    contextId: job.contextId,
    status: job.status,
    iteration: job.iteration,
    budgetIterations: job.budgetIterations,
    budgetRuns: job.budgetRuns,
    runsUsed: job.runsUsed,
    bestEnvelopeKey: job.bestEnvelopeKey,
    stopReason: job.stopReason,
    accepted: job.accepted,
    score: job.score,
    unsafe: job.unsafe,
    source: job.source,
    writtenAt,
  };
}

export async function persistAgentEvent(event: AgentEvent): Promise<void> {
  const conn = await getSpacetime();
  const writtenAt = new Date().toISOString();
  await conn.reducers.upsertAgentJob(jobWrite(event.job, writtenAt));
  await conn.reducers.replaceAgentLogs({
    jobId: event.job.id,
    contextId: event.job.contextId,
    rows: event.logs.map((row: AgentLogEntry) => ({
      seq: row.seq,
      iteration: row.iteration,
      action: row.action,
      change: row.change,
      result: row.result,
      writtenAt,
    })),
  });
  if (event.envelope) {
    const env: Envelope = event.envelope.envelope;
    await conn.reducers.upsertEnvelope({
      id: `${event.job.id}:v${env.version}`,
      jobId: event.job.id,
      contextId: event.job.contextId,
      envelopeId: env.envelopeId,
      version: env.version,
      json: JSON.stringify(env),
      note: env.note ?? '',
      accepted: event.envelope.accepted,
      score: event.envelope.score,
      unsafe: event.envelope.unsafe,
      writtenAt,
    });
  }
  if (event.campaign) await persistCampaign(event.campaign);
}

export const ACTIVE_ENVELOPE_ROW = 'mission-control';

export interface ActiveEnvelopeWrite {
  envelopeKey: string;
  envelopeId: string;
  version: number;
  label: string;
  json: string;
  contextId: string;
}

export async function persistActiveEnvelope(row: ActiveEnvelopeWrite): Promise<void> {
  const conn = await getSpacetime();
  await conn.reducers.setActiveEnvelope({
    id: ACTIVE_ENVELOPE_ROW,
    envelopeKey: row.envelopeKey,
    envelopeId: row.envelopeId,
    version: row.version,
    label: row.label,
    json: row.json,
    contextId: row.contextId,
    writtenAt: new Date().toISOString(),
  });
}

export async function clearPersistedActiveEnvelope(): Promise<void> {
  const conn = await getSpacetime();
  await conn.reducers.clearActiveEnvelope({ id: ACTIVE_ENVELOPE_ROW });
}

export function disconnectSpacetime(): void {
  connected?.disconnect();
  connected = null;
  connecting = null;
}

export async function persistLiveScene(row: LiveSceneRecord): Promise<void> {
  const conn = await getSpacetime();
  await conn.reducers.upsertLiveScene({
    id: row.id || LIVE_SCENE_ID,
    imageId: row.imageId,
    sol: row.sol,
    camera: row.camera,
    utcDateTaken: row.utcDateTaken,
    localMeanSolarTime: row.localMeanSolarTime,
    daysAgo: row.daysAgo,
    filePath: row.filePath,
    nasaUrl: row.nasaUrl,
    credit: row.credit,
    isFallback: row.isFallback,
    chosenWhy: row.chosenWhy,
    lat: row.lat,
    lon: row.lon,
    waypointSol: row.waypointSol,
    ingestedAt: row.ingestedAt,
  });
}

export async function persistLiveScenePlan(row: LiveScenePlanWrite): Promise<void> {
  const conn = await getSpacetime();
  await conn.reducers.upsertLiveScenePlan({
    id: row.id || LIVE_SCENE_ID,
    imageId: row.imageId,
    analysisJson: row.analysisJson,
    planJson: row.planJson,
    delayMin: row.delayMin,
    rangeAu: row.rangeAu,
    earthDate: row.earthDate,
    validated: row.validated,
    validationReasons: row.validationReasons,
    compileSource: row.compileSource,
    model: row.model,
    writtenAt: row.writtenAt,
  });
}
