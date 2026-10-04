import type { MissionConcept } from './types';

export const DEFAULT_CONCEPT: MissionConcept = {
  siteId: 'jezero',
  startDate: '2028-02-01',
  sols: 30,
};

export function missionContextId(concept: MissionConcept): string {
  return `${concept.siteId}:${concept.startDate}:${concept.sols}`;
}
