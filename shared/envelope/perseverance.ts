import waypointsFile from './data/M20_waypoints.json';
import type { BenchmarkStats, Provenance } from './types';

interface Waypoint {
  sol: number;
  lat: number;
  lon: number;
  dist_total_m: number;
}

interface WaypointFile {
  source: { name: string; url: string; retrieved: string; note: string };
  waypoints: Waypoint[];
}

const file = waypointsFile as WaypointFile;

function provenance(): Provenance {
  return {
    source: file.source.name,
    url: file.source.url,
    retrieved: file.source.retrieved,
    note: file.source.note,
  };
}

export function perseveranceBenchmark(): BenchmarkStats {
  const pts = file.waypoints;
  if (!pts.length) {
    return { available: false, source: provenance() };
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const driveSols = Math.max(1, last.sol - first.sol);
  const distanceKm = last.dist_total_m / 1000;
  return {
    available: true,
    solFirst: first.sol,
    solLast: last.sol,
    driveSols,
    distanceKm: Math.round(distanceKm * 100) / 100,
    kmPerSol: Math.round((distanceKm / driveSols) * 1000) / 1000,
    source: provenance(),
  };
}

export function emptyBenchmark(reason: string): BenchmarkStats {
  return {
    available: false,
    source: {
      source: file.source.name,
      url: file.source.url,
      note: reason,
    },
  };
}
