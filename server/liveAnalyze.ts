import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPath } from '../client/src/sim/grid';
import type { CellType, SimMap } from '../client/src/sim/types';
import { checkPlanSafety, type SafetyReport } from '../client/src/sim/validator';
import { compilePlan, type CompileResult, type ModelCall } from '../shared/compiler';
import { lookupHorizons, parseHorizonsCsv, type HorizonsRow } from '../shared/envelope/horizons';
import {
  bboxCenterCell,
  briefingFromAnalysis,
  GRID_HEIGHT,
  GRID_WIDTH,
  intentFromAnalysis,
  parseSceneAnalysis,
  planFromAnalysis,
  sceneAnalysisJsonSchema,
  type SceneAnalysis,
} from '../shared/liveScene/analysis';
import type { Plan } from '../shared/plan';
import { MARS_SURFACE } from '../shared/scenario';
import { grokModelCall, grokVisionJson } from './grok';
import { FALLBACK_DIR, LIVE_DIR, LIVE_SCENE_ID, type LiveSceneMeta } from './liveScene';

export const FALLBACK_ANALYSIS_PATH = path.join(FALLBACK_DIR, 'analysis.json');

const HORIZONS_CSV = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../shared/envelope/data/earth-mars-2026-2028.csv'),
  'utf8',
);

const VISION_PROMPT = [
  'You are analyzing a Perseverance Navcam or Front Hazcam frame for rover driving and science planning.',
  'Return JSON only that matches the schema.',
  'hazards: rocks, steep slopes, sand/soft soil, drop-offs, or other driving risks.',
  'Bounding boxes are normalized image coordinates: x,y top-left, w,h size, all in 0..1.',
  'Draw tight boxes around the specific surface feature only. Exclude sky (y < 0.35) and rover hardware (y > 0.78) from all bounding boxes unless the feature genuinely extends there.',
  'targets: scientifically interesting rocks or outcrops a rover might approach. Give a one-line reason. Same tight-box rule applies.',
  'route: 5-8 ordered ground points (x,y) tracing a plausible driving path from the rover position (bottom-center, around x=0.5 y=0.85) to the best target. Stay on visible ground; avoid hazard areas. All points must satisfy y >= 0.35.',
  'altRoute: 5-8 ordered ground points for an alternate path that avoids the main route hazards. Start from the same rover position.',
  'Prefer real, visible features. If unsure, use low confidence and fewer boxes. Do not invent features off-frame.',
  'terrainSummary: one sentence. confidence: overall confidence in this reading.',
].join(' ');

export interface LiveDelay {
  earthDate: string;
  delayMin: number;
  rangeAu: number;
  sotDeg: number;
}

export interface CachedLivePlan {
  imageId: string;
  analysis: SceneAnalysis;
  plan: Plan;
  delay?: LiveDelay;
  compileSource: string;
  validated: boolean;
  validationReasons: string[];
  model: string;
}

export interface AnalyzeResult {
  imageId: string;
  filePath: string;
  analysis: SceneAnalysis;
  plan: Plan;
  briefingNotes: string[];
  delay: LiveDelay;
  safety: SafetyReport;
  compile: CompileResult;
  usedCachedAnalysis: boolean;
  usedFallbackCache: boolean;
  persisted: boolean;
  persistError?: string;
}

export interface AnalyzeOptions {
  liveDir?: string;
  offline?: boolean;
  force?: boolean;
  now?: Date;
  apiKey?: string;
  model?: string;
  effort?: string;
  callVision?: (imageBase64: string, mime: string) => Promise<string>;
  callModel?: ModelCall | null;
  persist?: (row: LiveScenePlanWrite) => Promise<void>;
  horizonsText?: string;
  log?: (line: string) => void;
}

export interface LiveScenePlanWrite {
  id: string;
  imageId: string;
  analysisJson: string;
  planJson: string;
  delayMin: number;
  rangeAu: number;
  earthDate: string;
  validated: boolean;
  validationReasons: string;
  compileSource: string;
  model: string;
  writtenAt: string;
}

export function todayLightTime(now = new Date(), horizonsText = HORIZONS_CSV): LiveDelay {
  const rows = parseHorizonsCsv(horizonsText);
  const earthDate = now.toISOString().slice(0, 10);
  const row: HorizonsRow = lookupHorizons(rows, earthDate);
  return { earthDate, delayMin: row.delayMin, rangeAu: row.rangeAu, sotDeg: row.sotDeg };
}

export function mapFromAnalysis(analysis: SceneAnalysis, imageId: string): SimMap {
  const { briefing } = briefingFromAnalysis(analysis, imageId);
  const cells: CellType[] = new Array(GRID_WIDTH * GRID_HEIGHT).fill('ground');
  const index = (x: number, y: number) => y * GRID_WIDTH + x;
  const protectedCells = new Set(briefing.features.map((f) => `${f.pos.x},${f.pos.y}`));
  protectedCells.add(`${briefing.roverStart.x},${briefing.roverStart.y}`);

  const keptZones: SimMap['noGoZones'] = [];
  for (const zone of briefing.noGoZones) {
    const trial = cells.slice();
    const { x, y, w, h } = zone.rect;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (protectedCells.has(`${xx},${yy}`)) continue;
        trial[index(xx, yy)] = 'sand';
      }
    }
    const trialMap: SimMap = {
      seed: 0,
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      cells: trial,
      features: briefing.features.map((f) => ({ ...f, pos: { ...f.pos } })),
      noGoZones: [...keptZones, zone],
      roverStart: { ...briefing.roverStart },
    };
    const reachable = briefing.features.every((f) => findPath(trialMap, trialMap.roverStart, f.pos));
    if (!reachable) continue;
    cells.splice(0, cells.length, ...trial);
    keptZones.push(zone);
  }

  for (const hazard of analysis.hazards) {
    if (hazard.type !== 'rock') continue;
    const pos = bboxCenterCell(hazard.bbox);
    if (protectedCells.has(`${pos.x},${pos.y}`)) continue;
    if (cells[index(pos.x, pos.y)] === 'ground') cells[index(pos.x, pos.y)] = 'rock';
  }

  const map: SimMap = {
    seed: 0,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    cells,
    features: briefing.features.map((f) => ({ ...f, pos: { ...f.pos } })),
    noGoZones: keptZones.map((z) => ({ ...z, rect: { ...z.rect } })),
    roverStart: { ...briefing.roverStart },
  };

  for (const feature of map.features) {
    if (findPath(map, map.roverStart, feature.pos)) continue;
    carvePath(map, map.roverStart, feature.pos);
  }
  return map;
}

function carvePath(map: SimMap, from: { x: number; y: number }, to: { x: number; y: number }): void {
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    if (x !== to.x) x += Math.sign(to.x - x);
    else y += Math.sign(to.y - y);
    map.cells[y * map.width + x] = 'ground';
  }
}

export function loadFallbackAnalysis(liveDir = LIVE_DIR): CachedLivePlan | null {
  const file = path.join(liveDir, 'fallback', 'analysis.json');
  if (!existsSync(file)) return null;
  const cached = JSON.parse(readFileSync(file, 'utf8')) as CachedLivePlan;
  const parsed = parseSceneAnalysis(JSON.stringify(cached.analysis));
  if (!parsed.analysis) return null;
  return { ...cached, analysis: parsed.analysis };
}

export function writeFallbackAnalysis(cache: CachedLivePlan, liveDir = LIVE_DIR): void {
  const dir = path.join(liveDir, 'fallback');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(cache, null, 2));
}

function analysisCachePath(liveDir: string, imageId: string): string {
  return path.join(liveDir, `${imageId}.analysis.json`);
}

export function loadSceneImage(liveDir = LIVE_DIR): { meta: LiveSceneMeta; filePath: string } {
  const liveMeta = newestLiveMeta(liveDir);
  if (liveMeta) return liveMeta;
  const fallbackMeta = path.join(liveDir, 'fallback', 'scene.json');
  if (!existsSync(fallbackMeta)) throw new Error('No live scene cache and no pinned fallback');
  const meta = JSON.parse(readFileSync(fallbackMeta, 'utf8')) as LiveSceneMeta;
  return { meta, filePath: path.join(liveDir, 'fallback', meta.fileName) };
}

function newestLiveMeta(liveDir: string): { meta: LiveSceneMeta; filePath: string } | null {
  if (!existsSync(liveDir)) return null;
  const files = readdirSync(liveDir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.analysis.json'))
    .map((name) => path.join(liveDir, name));
  let best: { meta: LiveSceneMeta; filePath: string; mtime: number } | null = null;
  for (const file of files) {
    const meta = JSON.parse(readFileSync(file, 'utf8')) as LiveSceneMeta;
    if (!meta.imageId || !meta.fileName) continue;
    const imagePath = path.join(liveDir, meta.fileName);
    if (!existsSync(imagePath)) continue;
    const mtime = statSync(imagePath).mtimeMs;
    if (!best || mtime > best.mtime) best = { meta, filePath: imagePath, mtime };
  }
  return best ? { meta: best.meta, filePath: best.filePath } : null;
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

async function analyzeImage(
  imageBase64: string,
  mime: string,
  opts: AnalyzeOptions,
  log: (line: string) => void,
): Promise<SceneAnalysis> {
  const call =
    opts.callVision ??
    (async (b64: string, imageMime: string) => {
      if (!opts.apiKey) throw new Error('no xAI key on the server');
      return grokVisionJson({
        apiKey: opts.apiKey,
        model: opts.model ?? 'grok-4.7',
        effort: opts.effort ?? 'low',
        prompt: VISION_PROMPT,
        imageBase64: b64,
        mime: imageMime,
        schema: sceneAnalysisJsonSchema,
        schemaName: 'live_scene_analysis',
      });
    });

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await call(imageBase64, mime);
    const parsed = parseSceneAnalysis(raw);
    if (parsed.analysis) {
      log(`vision: ${parsed.analysis.targets.length} target(s), ${parsed.analysis.hazards.length} hazard(s), confidence ${parsed.analysis.confidence}`);
      return parsed.analysis;
    }
    lastErrors = parsed.errors;
    log(`vision: invalid JSON attempt ${attempt + 1}: ${parsed.errors.join('; ')}`);
  }
  throw new Error(`scene analysis failed validation: ${lastErrors.join('; ')}`);
}

export async function analyzeLiveScene(opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const log = opts.log ?? console.log;
  const liveDir = opts.liveDir ?? LIVE_DIR;
  const model = opts.model ?? 'grok-4.7';
  const { meta, filePath } = loadSceneImage(liveDir);
  const delay = todayLightTime(opts.now, opts.horizonsText ?? HORIZONS_CSV);
  log(`scene: ${meta.camera} ${meta.imageId} sol ${meta.sol}`);
  log(`delay: ${delay.delayMin} min one-way on ${delay.earthDate} (${delay.rangeAu} AU)`);

  let analysis: SceneAnalysis | undefined;
  let usedCachedAnalysis = false;
  let usedFallbackCache = false;
  const fallback = loadFallbackAnalysis(liveDir);
  const localCachePath = analysisCachePath(liveDir, meta.imageId);

  if (opts.offline) {
    if (!fallback) throw new Error('Pinned fallback analysis missing; run a live analyze once to cache it');
    analysis = fallback.analysis;
    usedFallbackCache = true;
    log('analysis: using pinned demo cache (offline)');
  } else if (!opts.force && existsSync(localCachePath)) {
    const cached = JSON.parse(readFileSync(localCachePath, 'utf8')) as CachedLivePlan;
    const parsed = parseSceneAnalysis(JSON.stringify(cached.analysis));
    if (parsed.analysis) {
      analysis = parsed.analysis;
      usedCachedAnalysis = true;
      log(`analysis: using disk cache ${localCachePath}`);
    }
  }

  if (!analysis) {
    const bytes = readFileSync(filePath);
    analysis = await analyzeImage(bytes.toString('base64'), mimeFor(filePath), opts, log);
    writeFileSync(
      localCachePath,
      JSON.stringify({ imageId: meta.imageId, analysis, model, compileSource: 'pending' }, null, 2),
    );
  }

  const { briefing, bestTargetId } = briefingFromAnalysis(analysis, meta.imageId);
  const cachedPlan = planFromAnalysis(analysis, meta.imageId);
  const intent = intentFromAnalysis(analysis, bestTargetId);
  const callModel =
    opts.callModel !== undefined
      ? opts.callModel
      : opts.offline || usedFallbackCache
        ? null
        : opts.apiKey
          ? grokModelCall(opts.apiKey, model, opts.effort ?? 'low')
          : null;

  const compile =
    opts.offline || usedFallbackCache
      ? {
          plan: cachedPlan,
          source: 'cached' as const,
          attempts: [],
          fallbackReason: 'pinned demo cache',
          model,
        }
      : await compilePlan({
          intent,
          scenario: MARS_SURFACE,
          briefing,
          cachedPlan,
          callModel,
          model,
          planId: `live-${meta.imageId.slice(0, 12)}`,
        });
  log(`compile: ${compile.source}` + (compile.fallbackReason ? ` (${compile.fallbackReason})` : ''));

  const map = mapFromAnalysis(analysis, meta.imageId);
  let plan = compile.plan;
  let safety = checkPlanSafety(
    plan,
    map,
    briefing.flightRules,
    { pos: briefing.roverStart, batteryPct: 100, knownObstacles: [] },
    MARS_SURFACE.irreversibleActions,
  );
  if (!safety.ok) {
    log(`safety: compiled plan failed (${safety.reasons.join('; ')}); using analysis-derived plan`);
    plan = cachedPlan;
    safety = checkPlanSafety(
      plan,
      map,
      briefing.flightRules,
      { pos: briefing.roverStart, batteryPct: 100, knownObstacles: [] },
      MARS_SURFACE.irreversibleActions,
    );
  }
  log(`safety: ${safety.ok ? 'pass' : 'fail'} · forecast ${safety.forecast.minutes} min, battery ${safety.forecast.endBatteryPct}%`);

  const cache: CachedLivePlan = {
    imageId: meta.imageId,
    analysis,
    plan,
    delay,
    compileSource: compile.source,
    validated: safety.ok,
    validationReasons: safety.reasons,
    model,
  };
  writeFileSync(analysisCachePath(liveDir, meta.imageId), JSON.stringify(cache, null, 2));
  if (fallback?.imageId === meta.imageId || !fallback) {
    writeFallbackAnalysis(cache, liveDir);
    log('fallback: cached analysis/plan for the pinned demo scene');
  }

  const writtenAt = (opts.now ?? new Date()).toISOString();
  const write: LiveScenePlanWrite = {
    id: LIVE_SCENE_ID,
    imageId: meta.imageId,
    analysisJson: JSON.stringify(analysis),
    planJson: JSON.stringify(plan),
    delayMin: delay.delayMin,
    rangeAu: delay.rangeAu,
    earthDate: delay.earthDate,
    validated: safety.ok,
    validationReasons: safety.reasons.join(' | '),
    compileSource: compile.source,
    model,
    writtenAt,
  };

  if (!opts.persist) {
    return {
      imageId: meta.imageId,
      filePath,
      analysis,
      plan,
      briefingNotes: briefing.notes,
      delay,
      safety,
      compile,
      usedCachedAnalysis,
      usedFallbackCache,
      persisted: false,
    };
  }
  try {
    await opts.persist(write);
    log(`spacetime: wrote live_scene_plan id=${write.id} linked to ${write.imageId}`);
    return {
      imageId: meta.imageId,
      filePath,
      analysis,
      plan,
      briefingNotes: briefing.notes,
      delay,
      safety,
      compile,
      usedCachedAnalysis,
      usedFallbackCache,
      persisted: true,
    };
  } catch (err) {
    const persistError = (err as Error).message;
    log(`spacetime: persist failed (${persistError})`);
    return {
      imageId: meta.imageId,
      filePath,
      analysis,
      plan,
      briefingNotes: briefing.notes,
      delay,
      safety,
      compile,
      usedCachedAnalysis,
      usedFallbackCache,
      persisted: false,
      persistError,
    };
  }
}
