import { featureById, findPath } from '../sim/grid';
import type { ReplayRun } from '../sim/replay';
import type { SimMap, Vec } from '../sim/types';

const NOMINAL_TARGETS = ['wp-A', 'outcrop-1'];

/** Geometry of the cached plan's intended drive, not a new planner. */
export function plannedRoute(map: SimMap): Vec[] {
  let from = map.roverStart;
  const cells: Vec[] = [];
  for (const id of NOMINAL_TARGETS) {
    const feature = featureById(map, id);
    if (!feature) continue;
    const path = findPath(map, from, feature.pos);
    if (path) cells.push(...path);
    from = feature.pos;
  }
  return cells;
}

/** Replay trail up to t — geometry only, same samples the 3D rover reads. */
export function drivenPathUntil(run: ReplayRun, t: number): Vec[] {
  const pts: Vec[] = [{ x: run.start.x, y: run.start.y }];
  for (const e of run.events) {
    if (e.type !== 'drive' || e.t > t) continue;
    if (e.tEnd <= t) {
      pts.push({ x: e.to.x, y: e.to.y });
    } else if (t > e.t) {
      const u = (t - e.t) / Math.max(1e-6, e.tEnd - e.t);
      pts.push({
        x: e.from.x + (e.to.x - e.from.x) * u,
        y: e.from.y + (e.to.y - e.from.y) * u,
      });
    }
  }
  return pts;
}
