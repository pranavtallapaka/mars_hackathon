import { describe, expect, it } from 'vitest';
import { parseContextId } from '../../../shared/envelope/concept';
import { HANDWRITTEN_ENVELOPE } from '../../../shared/envelope/schema';
import { CACHED_DEMO_PLAN } from '../../../shared/missions/mars-demo';
import { createPlanSchema } from '../../../shared/plan';
import { MARS_SURFACE } from '../../../shared/scenario';
import { describePolicyOverlay, envelopeWindowLabel, overlayActiveEnvelope } from './activeEnvelope';

const plan = () => createPlanSchema(MARS_SURFACE).parse(CACHED_DEMO_PLAN);

describe('Agent A6: load envelope into mission control', () => {
  it('applies the matching cell and removing the envelope restores the compiled plan', () => {
    const compiled = plan();
    expect(compiled.limits.batteryFloorPct).toBe(30);
    const loaded = overlayActiveEnvelope(compiled, HANDWRITTEN_ENVELOPE, 'jezero', '2028-02-01');
    expect(loaded.limits.batteryFloorPct).not.toBeUndefined();
    expect(loaded.limits.noGoZones).toContain('sand-1');
    expect(loaded.limits.irreversibleNeedsApproval).toBe(true);
    const removed = overlayActiveEnvelope(compiled, null, 'jezero', '2028-02-01');
    expect(removed.limits.batteryFloorPct).toBe(compiled.limits.batteryFloorPct);
    expect(removed.escalateWhen).toEqual(compiled.escalateWhen);
  });

  it('names the badge the way the design doc does', () => {
    expect(envelopeWindowLabel('jezero', '2028-02-01', 30, 7)).toBe('Jezero Feb–Mar 2028, v7');
  });

  it('parses the Jezero demo context id', () => {
    expect(parseContextId('jezero:2028-02-01:30')).toEqual({ siteId: 'jezero', startDate: '2028-02-01', sols: 30 });
    expect(parseContextId('nope')).toBeNull();
  });

  it('names the long-gap Jezero cell and the compiler → envelope diffs', () => {
    const policy = describePolicyOverlay(plan(), HANDWRITTEN_ENVELOPE, 'jezero', '2028-02-01', 'Jezero Feb–Mar 2028, v1');
    expect(policy.comm).toBe('long_gap');
    expect(policy.delayMin).toBeGreaterThanOrEqual(18);
    expect(policy.changed).toBe(true);
    expect(policy.battery.compiled).toBe(30);
    expect(policy.battery.applied).not.toBe(30);
    expect(policy.useCase).toMatch(/Use case:/);
    expect(policy.useCase).toMatch(/compiler/i);
  });
});
