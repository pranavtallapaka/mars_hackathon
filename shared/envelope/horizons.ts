import type { CommState, Provenance } from './types';

export const CONJUNCTION_SOT_DEG = 3;
export const LONG_GAP_SOT_DEG = 10;
export const LONG_GAP_DELAY_MIN = 18;

export interface HorizonsRow {
  date: string;
  rangeAu: number;
  delayMin: number;
  sotDeg: number;
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/** Parse a JPL Horizons table ($$SOE…$$EOE) or a simple CSV of date, r_au, lt_min, sot_deg. */
export function parseHorizonsCsv(text: string): HorizonsRow[] {
  const start = text.indexOf('$$SOE');
  const end = text.indexOf('$$EOE');
  const body = start >= 0 ? text.slice(start + 5, end >= 0 ? end : undefined) : text;
  const rows: HorizonsRow[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('*') || line.startsWith('Date')) continue;
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 4) continue;
    const date = toIsoDate(parts[0]);
    const rangeAu = Number(parts[1]);
    const delayMin = Number(parts[2]);
    const sotDeg = Number(parts[3]);
    if (!date || ![rangeAu, delayMin, sotDeg].every((n) => Number.isFinite(n))) continue;
    rows.push({ date, rangeAu, delayMin, sotDeg });
  }
  if (!rows.length) throw new Error('Horizons table had no usable rows');
  return rows;
}

function toIsoDate(token: string): string | null {
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const hor = token.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})/);
  if (!hor) return null;
  const month = MONTHS[hor[2]];
  if (month === undefined) return null;
  return `${hor[1]}-${String(month + 1).padStart(2, '0')}-${hor[3].padStart(2, '0')}`;
}

export function commState(row: HorizonsRow, conjunctionDeg = CONJUNCTION_SOT_DEG): CommState {
  if (row.sotDeg < conjunctionDeg) return 'conjunction';
  if (row.sotDeg < LONG_GAP_SOT_DEG || row.delayMin >= LONG_GAP_DELAY_MIN) return 'long_gap';
  return 'normal';
}

/** Nearest daily row; dates are civil UTC. */
export function lookupHorizons(rows: HorizonsRow[], isoDate: string): HorizonsRow {
  if (!rows.length) throw new Error('empty Horizons table');
  const target = Date.parse(`${isoDate}T12:00:00Z`);
  let best = rows[0];
  let bestD = Infinity;
  for (const row of rows) {
    const d = Math.abs(Date.parse(`${row.date}T12:00:00Z`) - target);
    if (d < bestD) {
      best = row;
      bestD = d;
    }
  }
  return best;
}

export const HORIZONS_PROVENANCE: Provenance = {
  source: 'JPL Horizons-format Earth–Mars table',
  url: 'https://ssd.jpl.nasa.gov/horizons/',
  retrieved: '2026-10-04',
  note: 'Daily geocentric range, one-way light time and Sun–Observer–Target angle. Bundled table generated with astronomy-engine (DE441-class); a live Horizons export parses the same way.',
};
