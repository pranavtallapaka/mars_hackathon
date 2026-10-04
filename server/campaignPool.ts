import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  runCampaignBatch,
  summarizeCampaigns,
  type CampaignOptions,
  type CampaignReport,
  type CampaignRun,
} from '../client/src/sim/campaign';
import type { MissionContext } from '../shared/envelope/types';
import type { CampaignWork } from './campaignWorker';

const WORKER_PATH = fileURLToPath(new URL('./campaignWorker.ts', import.meta.url));

function chunkRanges(runs: number, workers: number): { from: number; to: number }[] {
  const n = Math.max(1, workers);
  const size = Math.ceil(runs / n);
  const ranges: { from: number; to: number }[] = [];
  for (let from = 0; from < runs; from += size) ranges.push({ from, to: Math.min(runs, from + size) });
  return ranges;
}

function runChunk(work: CampaignWork): Promise<{ baseline: CampaignRun; envelope: CampaignRun }[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { execArgv: process.execArgv });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('campaign worker timed out'));
    }, 120_000);
    worker.once('message', (pairs) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(pairs);
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.postMessage(work);
  });
}

export async function runCampaignBatchParallel(
  ctx: MissionContext,
  opts: CampaignOptions = {},
): Promise<CampaignReport> {
  const runs = opts.runs ?? 50;
  const baseSeed = opts.baseSeed ?? 2000;
  const iteration = opts.iteration ?? 0;
  const workers = Math.min(availableParallelism(), runs, 8);
  if (workers <= 1 || runs < 8) return runCampaignBatch(ctx, opts);

  const t0 = performance.now();
  try {
    const chunks = await Promise.all(
      chunkRanges(runs, workers).map((range) =>
        runChunk({ ctx, ...range, baseSeed, envelope: opts.envelope }),
      ),
    );
    return summarizeCampaigns(ctx, chunks.flat(), performance.now() - t0, { baseSeed, iteration });
  } catch {
    return runCampaignBatch(ctx, opts);
  }
}
