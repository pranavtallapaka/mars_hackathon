import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { daysAgoFromUtc } from './liveScene';
import {
  LIVE_DIR,
  loadFallbackScene,
  type LiveSceneMeta,
  type LiveSceneRecord,
} from './liveScene';
import { loadFallbackAnalysis, loadSceneImage, type CachedLivePlan } from './liveAnalyze';
import { assembleReveal, NASA_CREDIT, type LiveRevealView } from '../shared/liveScene/reveal';
import { sceneAnalysisSchema, type SceneAnalysis } from '../shared/liveScene/analysis';
import { createPlanSchema, type Plan } from '../shared/plan';
import { MARS_SURFACE } from '../shared/scenario';

const IMAGE_ID_RE = /^[A-Za-z0-9._-]+$/;

export interface LiveRevealSnapshot {
  view: LiveRevealView;
  filePath: string;
  mime: string;
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

export function assertInsideLiveDir(filePath: string, liveDir = LIVE_DIR): string {
  const resolved = path.resolve(filePath);
  const root = path.resolve(liveDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('refusing path outside the live cache');
  }
  return resolved;
}

function analysisCachePath(liveDir: string, imageId: string): string {
  return path.join(liveDir, `${imageId}.analysis.json`);
}

function parseCachedPlan(raw: string): CachedLivePlan | null {
  try {
    const cached = JSON.parse(raw) as CachedLivePlan;
    const analysis = sceneAnalysisSchema.safeParse(cached.analysis);
    const plan = createPlanSchema(MARS_SURFACE).safeParse(cached.plan);
    if (!analysis.success || !plan.success) return null;
    return { ...cached, analysis: analysis.data, plan: plan.data };
  } catch {
    return null;
  }
}

function loadAnalysisFor(meta: LiveSceneMeta, liveDir: string): CachedLivePlan {
  const local = analysisCachePath(liveDir, meta.imageId);
  if (existsSync(local)) {
    const cached = parseCachedPlan(readFileSync(local, 'utf8'));
    if (cached) return cached;
  }
  const fallback = loadFallbackAnalysis(liveDir);
  if (fallback) return fallback;
  throw new Error(`No analysis cache for ${meta.imageId}`);
}

function sceneFromMeta(
  meta: LiveSceneMeta,
  opts: { isFallback: boolean; now?: Date; location?: LiveSceneMeta },
): LiveRevealView['scene'] {
  const loc = opts.location ?? meta;
  const lat = typeof meta.lat === 'number' ? meta.lat : typeof loc.lat === 'number' ? loc.lat : undefined;
  const lon = typeof meta.lon === 'number' ? meta.lon : typeof loc.lon === 'number' ? loc.lon : undefined;
  const waypointSol =
    typeof meta.waypointSol === 'number'
      ? meta.waypointSol
      : typeof loc.waypointSol === 'number'
        ? loc.waypointSol
        : undefined;
  return {
    imageId: meta.imageId,
    sol: meta.sol,
    camera: meta.camera,
    utcDateTaken: meta.utcDateTaken,
    daysAgo: daysAgoFromUtc(meta.utcDateTaken, opts.now),
    nasaUrl: meta.nasaUrl,
    credit: meta.credit || NASA_CREDIT,
    isFallback: opts.isFallback,
    lat,
    lon,
    waypointSol,
  };
}

function viewFromParts(
  scene: LiveRevealView['scene'],
  analysis: SceneAnalysis,
  plan: Plan,
  delay: { delayMin: number; rangeAu?: number; earthDate?: string },
): LiveRevealView {
  return assembleReveal({
    scene,
    analysis,
    plan,
    delayMin: delay.delayMin,
    rangeAu: delay.rangeAu,
    earthDate: delay.earthDate,
  });
}

export function loadLiveSnapshot(opts: { cached?: boolean; liveDir?: string; now?: Date } = {}): LiveRevealSnapshot {
  const liveDir = opts.liveDir ?? LIVE_DIR;
  const now = opts.now;
  if (opts.cached) {
    const { meta, filePath } = loadFallbackScene(liveDir);
    const cached = loadFallbackAnalysis(liveDir);
    if (!cached) throw new Error('Pinned fallback analysis missing');
    return {
      view: viewFromParts(sceneFromMeta(meta, { isFallback: true, now }), cached.analysis, cached.plan, cached.delay ?? {
        delayMin: 13.65,
        rangeAu: 1.64,
        earthDate: '',
      }),
      filePath: assertInsideLiveDir(filePath, liveDir),
      mime: mimeFor(filePath),
    };
  }

  const { meta, filePath } = loadSceneImage(liveDir);
  const cached = loadAnalysisFor(meta, liveDir);
  let location: LiveSceneMeta | undefined;
  try {
    const fallback = loadFallbackScene(liveDir).meta;
    if (fallback.imageId === meta.imageId) location = fallback;
  } catch {
    location = undefined;
  }
  return {
    view: viewFromParts(sceneFromMeta(meta, { isFallback: false, now, location }), cached.analysis, cached.plan, cached.delay ?? {
      delayMin: 13.65,
      rangeAu: 1.64,
      earthDate: '',
    }),
    filePath: assertInsideLiveDir(filePath, liveDir),
    mime: mimeFor(filePath),
  };
}

export function resolveLiveImage(opts: { cached?: boolean; imageId?: string; liveDir?: string } = {}): {
  filePath: string;
  mime: string;
} {
  const liveDir = opts.liveDir ?? LIVE_DIR;
  if (opts.cached) {
    const { filePath } = loadFallbackScene(liveDir);
    return { filePath: assertInsideLiveDir(filePath, liveDir), mime: mimeFor(filePath) };
  }
  if (opts.imageId) {
    if (!IMAGE_ID_RE.test(opts.imageId)) throw new Error('invalid image id');
    for (const ext of ['.png', '.jpg', '.jpeg']) {
      const candidate = path.join(liveDir, `${opts.imageId}${ext}`);
      if (existsSync(candidate)) {
        return { filePath: assertInsideLiveDir(candidate, liveDir), mime: mimeFor(candidate) };
      }
    }
    const fallbackName = path.join(liveDir, 'fallback', 'scene.png');
    if (existsSync(fallbackName)) {
      return { filePath: assertInsideLiveDir(fallbackName, liveDir), mime: mimeFor(fallbackName) };
    }
  }
  const { filePath } = loadSceneImage(liveDir);
  return { filePath: assertInsideLiveDir(filePath, liveDir), mime: mimeFor(filePath) };
}

export function snapshotJson(snapshot: LiveRevealSnapshot): LiveRevealView {
  return snapshot.view;
}

export function sceneRecordToViewScene(row: LiveSceneRecord): LiveRevealView['scene'] {
  return {
    imageId: row.imageId,
    sol: row.sol,
    camera: row.camera,
    utcDateTaken: row.utcDateTaken,
    daysAgo: row.daysAgo,
    nasaUrl: row.nasaUrl,
    credit: row.credit || NASA_CREDIT,
    isFallback: row.isFallback,
    lat: row.lat,
    lon: row.lon,
    waypointSol: row.waypointSol,
  };
}
