import { MARS_DEMO_BRIEFING } from '../../../shared/missions/mars-demo';
import { findPath } from './grid';
import { mulberry32 } from './rng';
import type { CellType, Feature, NoGoZone, SimMap, Vec } from './types';

export const MAP_WIDTH = 24;
export const MAP_HEIGHT = 16;
const ROCK_DENSITY = 0.12;
const MAX_ATTEMPTS = 100;

// Named features are fixed so the scripted mission is stable; only rock scatter is seeded.
const ROVER_START: Vec = MARS_DEMO_BRIEFING.roverStart;
const FEATURES: Feature[] = MARS_DEMO_BRIEFING.features;
const NO_GO_ZONES: NoGoZone[] = MARS_DEMO_BRIEFING.noGoZones;

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
