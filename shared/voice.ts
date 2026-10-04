import type { EscalationPacket, Plan } from './plan';

export type VoiceRole = 'ground' | 'rover';

export interface SpeakRequest {
  role: VoiceRole;
  text: string;
}

export interface SpeakResult {
  id: string;
  role: VoiceRole;
  url?: string;
  source: 'elevenlabs' | 'cache' | 'unavailable';
  ms?: number;
  model: string;
  reason?: string;
}

export interface TranscribeResult {
  text: string;
  source: 'elevenlabs' | 'unavailable';
  ms?: number;
  model: string;
  reason?: string;
}

const MAX_SPEAK_CHARS = 2500;

/** Turn plan tokens into something a voice can read aloud. */
export function speakable(s: string): string {
  return s
    .replace(/wp-/gi, 'waypoint ')
    .replace(/outcrop-/gi, 'outcrop ')
    .replace(/_/g, ' ')
    .replace(/%/g, ' percent')
    .replace(/(\d+)\s*cm\b/gi, '$1 centimeters')
    .replace(/\s+/g, ' ')
    .trim();
}

function stepLine(step: Plan['steps'][number]): string {
  const args = Object.entries(step.args)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  const branches = step.branches.map((b) => `If ${speakable(b.if)}, ${speakable(b.then)}.`).join(' ');
  const flags = step.irreversible ? ` Irreversible${step.approved ? ', approved' : ', not approved'}.` : '';
  return `${step.id}: ${speakable(step.action)}${args ? ` ${speakable(args)}` : ''}.${flags}${branches ? ` ${branches}` : ''}`;
}

/** Ground assistant script: the compiled plan, read before approval. */
export function planReadback(plan: Plan): string {
  const triggers = [
    ...plan.steps.flatMap((s) =>
      s.branches.filter((b) => b.then === 'escalate').map((b) => `${s.id} ${speakable(b.if)}`),
    ),
    ...plan.escalateWhen.map((e) => (e === 'no_branch_matches' ? 'any condition with no branch' : speakable(e))),
  ];
  const text = [
    `Plan ${plan.planId}, version ${plan.version}.`,
    `Intent: ${speakable(plan.intent)}.`,
    `${plan.steps.length} steps.`,
    ...plan.steps.map(stepLine),
    triggers.length ? `Calls home when: ${triggers.join('; ')}.` : '',
    `Abort means ${speakable(plan.abort.behavior)} to ${speakable(plan.abort.to)}.`,
    'Approve to uplink.',
  ]
    .filter(Boolean)
    .join(' ');
  return text.length > MAX_SPEAK_CHARS ? `${text.slice(0, MAX_SPEAK_CHARS - 1)}…` : text;
}

/** Robot voice script: the escalation packet, read only after the delay. */
export function escalationReadback(packet: EscalationPacket): string {
  const options = packet.options
    .map((o) => {
      const rec = o.id === packet.recommendation ? ' Recommended.' : '';
      return `${o.id}: ${speakable(o.label)}. ${o.risk} risk, ${o.costMin} minutes.${rec}`;
    })
    .join(' ');
  const text = [
    `Rover escalation at step ${packet.stepId}.`,
    speakable(packet.whatHappened) + '.',
    `Options. ${options}`,
  ].join(' ');
  return text.length > MAX_SPEAK_CHARS ? `${text.slice(0, MAX_SPEAK_CHARS - 1)}…` : text;
}

/** Short stable id for a role + script. Used as the cache filename. */
export function voiceKey(role: VoiceRole, text: string): string {
  const input = `${role}\n${text}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
