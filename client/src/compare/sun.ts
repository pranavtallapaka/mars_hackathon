import { mars24 } from '../../../shared/envelope/mars24';
import { SITES } from '../../../shared/envelope/sites';

export const MISSION_UTC = '2028-02-01T12:00:00Z';

/** Direction *from* the sun toward the scene, world metres. Mars24 drives elevation; LMST drives azimuth. */
export function sunPosition(simMin: number, distance = 220): { x: number; y: number; z: number; intensity: number } {
  const utc = new Date(Date.parse(MISSION_UTC) + simMin * 60_000);
  const site = SITES.jezero;
  const clock = mars24(utc, site.lat, site.lonEast);
  const el = (clock.sunElevationDeg * Math.PI) / 180;
  const az = ((clock.ltstHours - 12) * 15 * Math.PI) / 180;
  const cosEl = Math.cos(el);
  const above = Math.sin(el) > 0.04;
  return {
    x: Math.sin(az) * cosEl * distance,
    y: above ? Math.sin(el) * distance : 12,
    z: Math.cos(az) * cosEl * distance,
    intensity: above ? 0.55 + 1.45 * Math.sin(el) : 0.32,
  };
}
