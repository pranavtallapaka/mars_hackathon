import type { CompileResult } from '../../shared/compiler';
import type { MissionConcept, MissionContext } from '../../shared/envelope/types';
import type { LiveRevealView } from '../../shared/liveScene/reveal';
import type { Scene } from '../../shared/plan';
import type { ReconstructionResult, SceneVariant } from '../../shared/scene';
import type { SpeakResult, TranscribeResult, VoiceRole } from '../../shared/voice';

export interface CampaignRequest {
  siteId: MissionConcept['siteId'];
  startDate: string;
  sols: number;
  runs?: number;
  seed?: number;
  iteration?: number;
}

export interface CampaignApiReport {
  contextId: string;
  iteration: number;
  runs: number;
  sols: number;
  elapsedMs: number;
  seed: number;
  runsPerMin: number;
  baseline: {
    side: string;
    runs: number;
    finished: number;
    unsafe: number;
    blackoutSols: number;
    operationalSols: number;
    meanRoundTrips: number;
    meanMissionMin: number;
    meanBytesDown: number;
    meanEscalations: number;
  };
  envelope: {
    side: string;
    runs: number;
    finished: number;
    unsafe: number;
    blackoutSols: number;
    operationalSols: number;
    meanRoundTrips: number;
    meanMissionMin: number;
    meanBytesDown: number;
    meanEscalations: number;
  };
  failures: Array<{
    runIndex: number;
    seed: number;
    solIndex: number;
    cellX: number;
    cellY: number;
    reason: string;
    detail: string;
    side: string;
  }>;
}

export interface CampaignResult {
  report: CampaignApiReport;
  persisted: boolean;
  persistError?: string;
}

export interface MissionContextResult {
  context: MissionContext;
  persisted: boolean;
  persistError?: string;
  contextId?: string;
}

export async function postMissionContext(concept: MissionConcept): Promise<MissionContextResult> {
  const res = await fetch('/api/mission-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `mission context failed (HTTP ${res.status})`);
  return body as MissionContextResult;
}

export interface AgentLogRow {
  seq: number;
  iteration: number;
  action: string;
  change: string;
  result: string;
}

export interface AgentApiReport {
  job: {
    id: string;
    contextId: string;
    status: string;
    iteration: number;
    runsUsed: number;
    stopReason: string;
    accepted: boolean;
    score: number;
    unsafe: number;
    source: string;
    bestEnvelopeKey: string;
  };
  contextId: string;
  best: unknown;
  logs: AgentLogRow[];
  tuningSeeds: number[];
  finalSeed: number;
  finalCheck: { accepted: boolean; score: number | null; unsafe: number } | null;
}

export interface AgentResult {
  report: AgentApiReport;
  persisted: boolean;
}

export async function postAgent(concept: {
  siteId: MissionConcept['siteId'];
  startDate: string;
  sols: number;
}): Promise<AgentResult> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `agent failed (HTTP ${res.status})`);
  return json as AgentResult;
}

export async function postActiveEnvelope(body: {
  envelopeKey: string;
  envelopeId: string;
  version: number;
  label: string;
  json: string;
  contextId: string;
}): Promise<{ persisted: boolean }> {
  const res = await fetch('/api/active-envelope', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `active envelope failed (HTTP ${res.status})`);
  return json as { persisted: boolean };
}

export async function deleteActiveEnvelope(): Promise<void> {
  const res = await fetch('/api/active-envelope', { method: 'DELETE' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `clear envelope failed (HTTP ${res.status})`);
}

export async function postCampaign(body: CampaignRequest): Promise<CampaignResult> {
  const res = await fetch('/api/campaign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `campaign failed (HTTP ${res.status})`);
  return json as CampaignResult;
}

export async function fetchLiveScene(cached = false): Promise<LiveRevealView> {
  const res = await fetch(`/api/live-scene${cached ? '?cached=1' : ''}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `live scene failed (HTTP ${res.status})`);
  return body as LiveRevealView;
}

export async function compileIntent(intent: string, useCached = false): Promise<CompileResult> {
  const res = await fetch('/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, useCached }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `compile failed (HTTP ${res.status})`);
  return body as CompileResult;
}

export async function reconstructScene(scene: Scene, variant: SceneVariant = 'reconstruction'): Promise<ReconstructionResult> {
  const res = await fetch('/api/reconstruct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, variant }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `reconstruct failed (HTTP ${res.status})`);
  return body as ReconstructionResult;
}

export async function transcribeIntent(audio: string, mime: string): Promise<TranscribeResult> {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio, mime }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `transcribe failed (HTTP ${res.status})`);
  return body as TranscribeResult;
}

export async function speakText(role: VoiceRole, text: string): Promise<SpeakResult> {
  const res = await fetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `speak failed (HTTP ${res.status})`);
  return body as SpeakResult;
}
