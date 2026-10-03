import { findPath } from './grid';
import { mulberry32 } from './rng';
import type { CellType, Feature, NoGoZone, SimMap, Vec } from './types';

export const MAP_WIDTH = 24;
export const MAP_HEIGHT = 16;
const ROCK_DENSITY = 0.12;
const MAX_ATTEMPTS = 100;

// Named features are fixed so the scripted mission is stable; only rock scatter is seeded.
const ROVER_START: Vec = { x: 2, y: 13 };

const FEATURES: Feature[] = [
  { id: 'wp-home', kind: 'waypoint', label: 'Landing site', tag: 'H', pos: { ...ROVER_START } },
  { id: 'wp-A', kind: 'waypoint', label: 'Approach to outcrop', tag: 'A', pos: { x: 16, y: 5 } },
  { id: 'wp-A-alt', kind: 'waypoint', label: 'Alternate approach', tag: "A'", pos: { x: 14, y: 9 } },
  { id: 'wp-B', kind: 'waypoint', label: 'West ridge', tag: 'B', pos: { x: 4, y: 3 } },
  { id: 'wp-C', kind: 'waypoint', label: 'South flats', tag: 'C', pos: { x: 19, y: 12 } },
  { id: 'outcrop-1', kind: 'target', label: 'Layered outcrop', tag: 'O1', pos: { x: 20, y: 2 } },
  { id: 'outcrop-2', kind: 'target', label: 'Secondary outcrop', tag: 'O2', pos: { x: 21, y: 6 } },
];

const NO_GO_ZONES: NoGoZone[] = [{ id: 'sand-1', label: 'Sand', rect: { x: 7, y: 5, w: 5, h: 5 } }];

export function generateMap(seed: number): SimMap {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = buildMap(seed, attempt);
    if (map.features.every((f) => findPath(map, map.roverStart, f.pos))) return map;
  }
  throw new Error(`No connected map for seed ${seed}`);
}

function buildMap(seed: number, attempt: number): SimMap {
  const rand = mulberry32(seed * 1000 + attempt);
  const cells: CellType[] = new Array(MAP_WIDTH * MAP_HEIGHT).fill('ground');

  for (const zone of NO_GO_ZONES) {
    const { x, y, w, h } = zone.rect;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) cells[yy * MAP_WIDTH + xx] = 'sand';
    }
  }

  const anchors = [ROVER_START, ...FEATURES.map((f) => f.pos)];
  const nearAnchor = (x: number, y: number) =>
    anchors.some((a) => Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1);

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = y * MAP_WIDTH + x;
      if (cells[i] !== 'ground' || nearAnchor(x, y)) continue;
      if (rand() < ROCK_DENSITY) cells[i] = 'rock';
    }
  }

  return {
    seed,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    cells,
    features: FEATURES.map((f) => ({ ...f, pos: { ...f.pos } })),
    noGoZones: NO_GO_ZONES.map((z) => ({ ...z, rect: { ...z.rect } })),
    roverStart: { ...ROVER_START },
  };
}
