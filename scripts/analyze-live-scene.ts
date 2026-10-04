import dotenv from 'dotenv';
import { analyzeLiveScene } from '../server/liveAnalyze';
import { disconnectSpacetime, persistLiveScenePlan } from '../server/spacetime';

dotenv.config({ override: true, quiet: true });

const offline = process.argv.includes('--offline') || process.argv.includes('--cached');
const force = process.argv.includes('--force');

const result = await analyzeLiveScene({
  offline,
  force,
  apiKey: process.env.XAI_API_KEY,
  model: process.env.XAI_MODEL ?? 'grok-4.7',
  effort: process.env.XAI_REASONING_EFFORT ?? 'low',
  persist: persistLiveScenePlan,
});
disconnectSpacetime();

console.log(
  JSON.stringify(
    {
      imageId: result.imageId,
      filePath: result.filePath,
      terrainSummary: result.analysis.terrainSummary,
      confidence: result.analysis.confidence,
      hazards: result.analysis.hazards,
      targets: result.analysis.targets,
      delayMin: result.delay.delayMin,
      earthDate: result.delay.earthDate,
      compileSource: result.compile.source,
      validated: result.safety.ok,
      validationReasons: result.safety.reasons,
      planId: result.plan.planId,
      steps: result.plan.steps.map((s) => ({ id: s.id, action: s.action, args: s.args, branches: s.branches })),
      usedCachedAnalysis: result.usedCachedAnalysis,
      usedFallbackCache: result.usedFallbackCache,
      persisted: result.persisted,
      persistError: result.persistError,
    },
    null,
    2,
  ),
);

if (!result.persisted || !result.safety.ok) process.exitCode = 1;
