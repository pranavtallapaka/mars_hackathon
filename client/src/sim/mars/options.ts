/**
 * The escalation options a Mars rover can offer. The packet schema only carries a label,
 * so the rover writes labels from here and the ground parses them back with the same table.
 */
export type MarsOptionIntent =
  | { kind: 'alt_site'; site: string }
  | { kind: 'surface_sample' }
  | { kind: 'retry_drill' }
  | { kind: 'approve_step'; stepId: string; action: string }
  | { kind: 'skip_step'; stepId: string }
  | { kind: 'return_to'; waypoint: string }
  | { kind: 'recharge' }
  | { kind: 'hold_for_plan' };

export function optionLabel(intent: MarsOptionIntent): string {
  switch (intent.kind) {
    case 'alt_site':
      return `Drill alternate site ${intent.site}`;
    case 'surface_sample':
      return 'Collect loose surface sample instead';
    case 'retry_drill':
      return 'Retry with higher drill force';
    case 'approve_step':
      return `Approve ${intent.stepId} (${intent.action}) and proceed`;
    case 'skip_step':
      return `Skip ${intent.stepId} and continue the plan`;
    case 'return_to':
      return `Abort and return to ${intent.waypoint}`;
    case 'recharge':
      return 'Hold in place and recharge';
    case 'hold_for_plan':
      return 'Hold for a revised plan';
  }
}

const PARSERS: [RegExp, (m: RegExpMatchArray) => MarsOptionIntent][] = [
  [/^Drill alternate site (\S+)$/, (m) => ({ kind: 'alt_site', site: m[1] })],
  [/^Collect loose surface sample instead$/, () => ({ kind: 'surface_sample' })],
  [/^Retry with higher drill force$/, () => ({ kind: 'retry_drill' })],
  [/^Approve (\S+) \((\S+)\) and proceed$/, (m) => ({ kind: 'approve_step', stepId: m[1], action: m[2] })],
  [/^Skip (\S+) and continue the plan$/, (m) => ({ kind: 'skip_step', stepId: m[1] })],
  [/^Abort and return to (\S+)$/, (m) => ({ kind: 'return_to', waypoint: m[1] })],
  [/^Hold in place and recharge$/, () => ({ kind: 'recharge' })],
  [/^Hold for a revised plan$/, () => ({ kind: 'hold_for_plan' })],
];

export function parseOptionLabel(label: string): MarsOptionIntent | null {
  for (const [re, build] of PARSERS) {
    const m = label.match(re);
    if (m) return build(m);
  }
  return null;
}
