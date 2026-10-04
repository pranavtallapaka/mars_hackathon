import { validateEnvelope, type Envelope } from '../../../shared/envelope/schema';
import type { MissionContext } from '../../../shared/envelope/types';
import {
  runCampaignBatch,
  type CampaignFailure,
  type CampaignOptions,
  type CampaignReport,
} from './campaign';

export interface EnvelopeScore {
  envelopeId: string;
  version: number;
  accepted: boolean;
  /** Round trips saved vs baseline; null when the envelope is rejected. */
  score: number | null;
  roundTripsSaved: number;
  missionMinSaved: number;
  unsafe: number;
  errors: string[];
  failures: CampaignFailure[];
  campaign: CampaignReport | null;
}

/** Maximize trips saved vs baseline, subject to zero envelope-side unsafe outcomes. */
export function scoreEnvelope(
  envelope: unknown,
  ctx: MissionContext,
  opts: CampaignOptions = {},
): EnvelopeScore {
  const checked = validateEnvelope(envelope);
  if (!checked.ok) {
    const id = (envelope as { envelopeId?: unknown } | null)?.envelopeId;
    const version = (envelope as { version?: unknown } | null)?.version;
    return {
      envelopeId: typeof id === 'string' ? id : 'invalid',
      version: typeof version === 'number' ? version : 0,
      accepted: false,
      score: null,
      roundTripsSaved: 0,
      missionMinSaved: 0,
      unsafe: 0,
      errors: checked.errors,
      failures: [],
      campaign: null,
    };
  }
  return scoreValidated(checked.envelope, ctx, opts);
}

function scoreValidated(envelope: Envelope, ctx: MissionContext, opts: CampaignOptions): EnvelopeScore {
  const campaign = runCampaignBatch(ctx, { ...opts, envelope });
  const unsafe = campaign.envelope.unsafe;
  const roundTripsSaved = campaign.baseline.meanRoundTrips - campaign.envelope.meanRoundTrips;
  const accepted = unsafe === 0;
  return {
    envelopeId: envelope.envelopeId,
    version: envelope.version,
    accepted,
    score: accepted ? roundTripsSaved : null,
    roundTripsSaved,
    missionMinSaved: campaign.baseline.meanMissionMin - campaign.envelope.meanMissionMin,
    unsafe,
    errors: accepted ? [] : [`${unsafe} unsafe envelope campaign(s)`],
    failures: campaign.failures.filter((f) => f.side === 'envelope'),
    campaign,
  };
}
