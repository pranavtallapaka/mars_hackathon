import { parentPort } from 'node:worker_threads';
import { runCampaignRange, type CampaignOptions } from '../client/src/sim/campaign';
import type { MissionContext } from '../shared/envelope/types';

export interface CampaignWork {
  ctx: MissionContext;
  from: number;
  to: number;
  baseSeed: number;
}

parentPort?.on('message', (work: CampaignWork) => {
  const pairs = runCampaignRange(work.ctx, work.from, work.to, {
    baseSeed: work.baseSeed,
  } satisfies Pick<CampaignOptions, 'baseSeed'>);
  parentPort?.postMessage(pairs);
});
