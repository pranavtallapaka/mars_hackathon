import type { CellType, Feature, SimMap, Vec } from './types';

export const cellIndex = (map: SimMap, p: Vec) => p.y * map.width + p.x;

export const inBounds = (map: SimMap, p: Vec) =>
  p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;

export const cellAt = (map: SimMap, p: Vec): CellType => map.cells[cellIndex(map, p)];

export const isPassable = (map: SimMap, p: Vec) => inBounds(map, p) && cellAt(map, p) === 'ground';

export const featureById = (map: SimMap, id: string): Feature | undefined =>
  map.features.find((f) => f.id === id);

export const samePos = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;

// N, E, S, W: fixed order keeps paths deterministic.
const DIRS: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export const zoneAt = (map: SimMap, p: Vec) =>
  map.noGoZones.find(({ rect: r }) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h);

/**
 * Shortest 4-connected path. Excludes `from`; null if unreachable.
 * By default rocks and sand are impassable; callers can pass a stricter `blocked` test.
 */
export function findPath(
  map: SimMap,
  from: Vec,
  to: Vec,
  blocked: (p: Vec) => boolean = (p) => !isPassable(map, p),
): Vec[] | null {
  const isOpen = (p: Vec) => inBounds(map, p) && !blocked(p);
  if (!isOpen(to)) return null;
  if (samePos(from, to)) return [];

  const prev = new Int32Array(map.width * map.height).fill(-1);
  const start = cellIndex(map, from);
  const goal = cellIndex(map, to);
  prev[start] = start;
  const queue = [start];

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goal) break;
    const cx = cur % map.width;
    const cy = Math.floor(cur / map.width);
    for (const d of DIRS) {
      const next = { x: cx + d.x, y: cy + d.y };
      if (!isOpen(next)) continue;
      const ni = cellIndex(map, next);
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }

  if (prev[goal] === -1) return null;
  const path: Vec[] = [];
  for (let i = goal; i !== start; i = prev[i]) {
    path.push({ x: i % map.width, y: Math.floor(i / map.width) });
  }
  return path.reverse();
}
