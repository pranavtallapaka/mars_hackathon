import type { SeasonName } from './types';

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const MSD_EPOCH = 2405522.0026578;
const SOL_DAYS = 1.0274912517;

export interface MarsClock {
  jdTt: number;
  msd: number;
  mstHours: number;
  lsDeg: number;
  season: SeasonName;
  eotDeg: number;
  lmstHours: number;
  ltstHours: number;
  sunDeclDeg: number;
  sunElevationDeg: number;
  daylightHours: number;
}

function julianDateUtc(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Rough ΔT (TT − UTC) in seconds. Good enough for season and daylight. */
export function deltaTSeconds(utc: Date): number {
  const y = utc.getUTCFullYear() + (utc.getUTCMonth() + 0.5) / 12;
  return 64 + (y - 2000) * 0.4;
}

function wrap360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function wrap24(x: number): number {
  return ((x % 24) + 24) % 24;
}

export function seasonName(lsDeg: number): SeasonName {
  const ls = wrap360(lsDeg);
  if (ls < 90) return 'northern_spring';
  if (ls < 180) return 'northern_summer';
  if (ls < 270) return 'northern_autumn';
  return 'northern_winter';
}

/**
 * Mars24 / Allison & McEwen (2000) as documented by NASA GISS.
 * Lat is north-positive; lonEast is east-positive (converted to west for LMST).
 */
export function mars24(utc: Date, lat: number, lonEast: number): MarsClock {
  const jdUt = julianDateUtc(utc);
  const jdTt = jdUt + deltaTSeconds(utc) / 86400;
  const t = jdTt - J2000;

  const M = (19.3871 + 0.52402075 * t) * DEG;
  const alphaFms = 270.3863 + 0.5240384 * t;
  const pbs =
    0.0071 * Math.cos(((0.985626 * t) / 2.2353 + 49.409) * DEG) +
    0.0057 * Math.cos(((0.985626 * t) / 2.7543 + 168.173) * DEG) +
    0.0039 * Math.cos(((0.985626 * t) / 1.1177 + 191.837) * DEG) +
    0.0037 * Math.cos(((0.985626 * t) / 15.7866 + 21.713) * DEG) +
    0.0021 * Math.cos(((0.985626 * t) / 2.1354 + 15.352) * DEG) +
    0.002 * Math.cos(((0.985626 * t) / 2.4694 + 95.528) * DEG) +
    0.0018 * Math.cos(((0.985626 * t) / 32.8493 + 49.101) * DEG);
  const nuMinusM =
    (10.691 + 3e-7 * t) * Math.sin(M) +
    0.623 * Math.sin(2 * M) +
    0.05 * Math.sin(3 * M) +
    0.005 * Math.sin(4 * M) +
    0.0005 * Math.sin(5 * M) +
    pbs;
  const lsDeg = wrap360(alphaFms + nuMinusM);
  const eotDeg = 2.861 * Math.sin(2 * lsDeg * DEG) - 0.071 * Math.sin(4 * lsDeg * DEG) + 0.002 * Math.sin(6 * lsDeg * DEG) - nuMinusM;

  const msd = (jdTt - MSD_EPOCH) / SOL_DAYS;
  const mstHours = wrap24(24 * msd);
  const lonWest = wrap360(-lonEast);
  const lmstHours = wrap24(mstHours - lonWest / 15);
  const ltstHours = wrap24(lmstHours + eotDeg / 15);

  const eps = (25.192 + 3.45e-7 * t) * DEG;
  const sunDeclDeg = Math.asin(Math.sin(eps) * Math.sin(lsDeg * DEG)) / DEG;
  const lambdaS = wrap360(mstHours * 15 + eotDeg + 180);
  const H = (lonWest - lambdaS) * DEG;
  const phi = lat * DEG;
  const dec = sunDeclDeg * DEG;
  const sinEl = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(H);
  const sunElevationDeg = Math.asin(Math.min(1, Math.max(-1, sinEl))) / DEG;

  const arg = -Math.tan(phi) * Math.tan(dec);
  let daylightHours = 0;
  if (arg <= -1) daylightHours = 24;
  else if (arg >= 1) daylightHours = 0;
  else daylightHours = (2 * Math.acos(arg)) / DEG / 15;

  return {
    jdTt,
    msd,
    mstHours,
    lsDeg,
    season: seasonName(lsDeg),
    eotDeg,
    lmstHours,
    ltstHours,
    sunDeclDeg,
    sunElevationDeg,
    daylightHours,
  };
}

/** Advance `sols` Mars sols from an Earth UTC date (≈ 1.0275 Earth days each). */
export function earthDateForSol(startUtc: Date, sols: number): Date {
  return new Date(startUtc.getTime() + sols * SOL_DAYS * 86400000);
}

export const MARS24_PROVENANCE = {
  source: 'NASA GISS Mars24 / Allison & McEwen 2000',
  url: 'https://www.giss.nasa.gov/tools/mars24/help/algorithm.html',
  note: 'Sol, Ls, LMST and solar elevation from the published Mars24 algorithm.',
} as const;
