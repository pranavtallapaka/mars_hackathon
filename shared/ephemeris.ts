import { Body, HelioVector, KM_PER_AU } from 'astronomy-engine';

/** Speed of light, km/s. */
export const C_KM_PER_S = 299_792.458;

export interface LightTime {
  date: string;
  distanceKm: number;
  delayMin: number;
}

/** Earth–Mars distance at 12:00 UTC on the civil date, then one-way light time. */
export function earthMarsLightTime(isoDate: string): LightTime {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`bad date ${isoDate}`);
  const earth = HelioVector(Body.Earth, date);
  const mars = HelioVector(Body.Mars, date);
  const distanceKm = Math.hypot(earth.x - mars.x, earth.y - mars.y, earth.z - mars.z) * KM_PER_AU;
  const delayMin = Math.round((distanceKm / C_KM_PER_S / 60) * 10) / 10;
  return { date: isoDate, distanceKm, delayMin };
}

export const DEFAULT_EPHEMERIS_DATE = '2026-10-03';
