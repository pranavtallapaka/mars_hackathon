import type { MissionConcept } from './types';

export const DEFAULT_CONCEPT: MissionConcept = {
  siteId: 'jezero',
  startDate: '2028-02-01',
  sols: 30,
};

export function missionContextId(concept: MissionConcept): string {
  return `${concept.siteId}:${concept.startDate}:${concept.sols}`;
}

/** Inverse of `missionContextId`. */
export function parseContextId(id: string): MissionConcept | null {
  const [siteId, startDate, solsRaw] = id.split(':');
  if ((siteId !== 'jezero' && siteId !== 'oxia') || !/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '')) return null;
  const sols = Number(solsRaw);
  if (!Number.isInteger(sols) || sols < 1) return null;
  return { siteId, startDate, sols };
}
