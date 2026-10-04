import type { Envelope } from '../../../shared/envelope/schema';

export interface FailureLike {
  cellX: number;
  cellY: number;
  reason: string;
  detail: string;
  side: string;
  solIndex: number;
}

export interface HeatCell {
  x: number;
  y: number;
  count: number;
  reasons: string[];
}

export interface LimitCause {
  reason: string;
  count: number;
  sample: string;
  limit: string;
}

const LIMIT_FOR: Record<string, string> = {
  hazard: 'terrain / no-go handling',
  no_go: 'no-go zones',
  battery_floor: 'battery floor',
  irreversible: 'irreversible-action approval',
  stuck: 'escalation / recovery',
};

export function aggregateHeat(failures: readonly FailureLike[]): HeatCell[] {
  const map = new Map<string, HeatCell>();
  for (const f of failures) {
    if (f.side !== 'envelope') continue;
    const key = `${f.cellX},${f.cellY}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.reasons.includes(f.reason)) existing.reasons.push(f.reason);
    } else {
      map.set(key, { x: f.cellX, y: f.cellY, count: 1, reasons: [f.reason] });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.y - b.y || a.x - b.x);
}

export function limitsSetBy(failures: readonly FailureLike[]): LimitCause[] {
  const map = new Map<string, LimitCause>();
  for (const f of failures) {
    if (f.side !== 'envelope') continue;
    const existing = map.get(f.reason);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(f.reason, {
        reason: f.reason,
        count: 1,
        sample: f.detail,
        limit: LIMIT_FOR[f.reason] ?? f.reason,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function confidenceOf(escalateWhen: string[]): number | null {
  const entry = escalateWhen.find((e) => e.startsWith('confidence_below:'));
  return entry ? Number(entry.split(':')[1]) : null;
}

export interface EvidenceExport {
  generatedAt: string;
  contextId: string;
  note: string;
  envelope: Envelope | null;
  score: { accepted: boolean; tripsSaved: number; unsafe: number; runs: number } | null;
  limitsSetBy: LimitCause[];
  logs: { seq: number; action: string; change: string; result: string }[];
}

export function buildEvidenceExport(partial: Omit<EvidenceExport, 'generatedAt' | 'note'>): EvidenceExport {
  return {
    generatedAt: new Date().toISOString(),
    note: 'Evidence-backed recommendation from a simplified sim. Not a certification.',
    ...partial,
  };
}
