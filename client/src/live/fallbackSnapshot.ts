import fallbackAnalysis from '../../../data/live/fallback/analysis.json';
import fallbackScene from '../../../data/live/fallback/scene.json';
import { sceneAnalysisSchema } from '../../../shared/liveScene/analysis';
import {
  assembleReveal,
  daysAgoFromUtc,
  parsePlanJson,
  type LiveRevealView,
} from '../../../shared/liveScene/reveal';

export const CACHED_IMAGE_SRC = '/api/live-scene/image?cached=1';

export function bundledFallbackSnapshot(now = new Date()): LiveRevealView {
  const analysis = sceneAnalysisSchema.parse(fallbackAnalysis.analysis);
  const plan = parsePlanJson(JSON.stringify(fallbackAnalysis.plan));
  if (!plan) throw new Error('Pinned fallback plan is invalid');
  const lat = typeof fallbackScene.lat === 'number' ? fallbackScene.lat : undefined;
  const lon = typeof fallbackScene.lon === 'number' ? fallbackScene.lon : undefined;
  return assembleReveal({
    scene: {
      imageId: fallbackScene.imageId,
      sol: fallbackScene.sol,
      camera: fallbackScene.camera,
      utcDateTaken: fallbackScene.utcDateTaken,
      daysAgo: daysAgoFromUtc(fallbackScene.utcDateTaken, now),
      nasaUrl: fallbackScene.nasaUrl,
      credit: fallbackScene.credit,
      isFallback: true,
      lat,
      lon,
      waypointSol: typeof fallbackScene.waypointSol === 'number' ? fallbackScene.waypointSol : undefined,
    },
    analysis,
    plan,
    delayMin: fallbackAnalysis.delay.delayMin,
    rangeAu: fallbackAnalysis.delay.rangeAu,
    earthDate: fallbackAnalysis.delay.earthDate,
  });
}
