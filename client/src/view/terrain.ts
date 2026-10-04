import * as THREE from 'three';
import heightmap from '../../../shared/mars/jezero.heightmap.json';
import type { SimMap, Vec } from '../sim/types';

const HI_W = heightmap.width;
const HI_H = heightmap.height;
const HI_ELEV = heightmap.elevations.map((v) => v ?? 0);
const HI_MIN = HI_ELEV.reduce((a, b) => Math.min(a, b), Infinity);
/** Slight vertical exaggeration so relief reads at mast height. */
const RELIEF_SCALE = 1.45;

export const PLOT_BLUE = 0x2554c7;
export const HAZARD_AMBER = 0xd9831a;
export const MARS_SKY = '#c4a06a';
export const MARS_FOG = '#d8b892';

export const MARS_ASSETS = {
  sky: '/assets/mars/sky.png',
  regolith: '/assets/mars/regolith.png',
  rocks: '/assets/mars/rocks.png',
  dust: '/assets/mars/dust.png',
} as const;

export function cellMetersOf(map: SimMap): number {
  return map.cellMeters ?? 2;
}

export function worldSize(map: SimMap): { w: number; d: number } {
  const m = cellMetersOf(map);
  return { w: map.width * m, d: map.height * m };
}

/** Grid (fractional cell coords) → world metres. y=0 is north. */
export function worldFromGrid(map: SimMap, x: number, y: number): { x: number; y: number; z: number } {
  const m = cellMetersOf(map);
  return { x: x * m, y: sampleElev(map, x, y), z: y * m };
}

export function sampleElev(map: SimMap, gx: number, gy: number): number {
  const { w, d } = worldSize(map);
  if (map.source?.id === 'DTEEC_048842_1985_048908_1985_U01') {
    const u = (gx * cellMetersOf(map)) / w;
    const v = (gy * cellMetersOf(map)) / d;
    return (bilinear(HI_ELEV, HI_W, HI_H, u, v) - HI_MIN) * RELIEF_SCALE;
  }
  if (map.elevations?.length === map.width * map.height) {
    const min = map.elevations.reduce((a, b) => Math.min(a, b), Infinity);
    const x = Math.max(0, Math.min(map.width - 1, gx));
    const y = Math.max(0, Math.min(map.height - 1, gy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(map.width - 1, x0 + 1);
    const y1 = Math.min(map.height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const e00 = map.elevations[y0 * map.width + x0];
    const e10 = map.elevations[y0 * map.width + x1];
    const e01 = map.elevations[y1 * map.width + x0];
    const e11 = map.elevations[y1 * map.width + x1];
    return ((e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty - min) * RELIEF_SCALE;
  }
  return 0;
}

function bilinear(data: number[], w: number, h: number, u: number, v: number): number {
  const x = Math.max(0, Math.min(w - 1, u * (w - 1)));
  const y = Math.max(0, Math.min(h - 1, v * (h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  return (data[y0 * w + x0] * (1 - tx) + data[y0 * w + x1] * tx) * (1 - ty) + (data[y1 * w + x0] * (1 - tx) + data[y1 * w + x1] * tx) * ty;
}

export function buildTerrainGeometry(map: SimMap): THREE.BufferGeometry {
  const { w: worldW, d: worldD } = worldSize(map);
  const jezero = map.source?.id === 'DTEEC_048842_1985_048908_1985_U01';
  const cols = jezero ? HI_W : map.width;
  const rows = jezero ? HI_H : map.height;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const v = j / (rows - 1);
      const x = u * worldW;
      const z = v * worldD;
      const gx = u * map.width;
      const gy = v * map.height;
      let y = sampleElev(map, gx, gy);
      y += Math.sin(x * 0.85) * Math.cos(z * 0.63) * 0.18 + Math.sin(x * 2.4 + z * 1.7) * 0.07;
      const k = (j * cols + i) * 3;
      positions[k] = x;
      positions[k + 1] = y;
      positions[k + 2] = z;
      uvs[(j * cols + i) * 2] = u;
      uvs[(j * cols + i) * 2 + 1] = 1 - v;
      const t = Math.max(0, Math.min(1, y / 90));
      colors[k] = 0.7 + t * 0.12;
      colors[k + 1] = 0.5 + t * 0.08;
      colors[k + 2] = 0.32 + t * 0.04;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const normals = geo.getAttribute('normal');
  const slope = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) slope[i] = 1 - (normals.getY(i) ?? 1);
  geo.setAttribute('slope', new THREE.BufferAttribute(slope, 1));
  return geo;
}

export function mappedRocks(map: SimMap): Vec[] {
  const out: Vec[] = [];
  map.cells.forEach((cell, i) => {
    if (cell === 'rock') out.push({ x: i % map.width, y: Math.floor(i / map.width) });
  });
  return out;
}

export function sandCells(map: SimMap): Vec[] {
  const out: Vec[] = [];
  map.cells.forEach((cell, i) => {
    if (cell === 'sand') out.push({ x: i % map.width, y: Math.floor(i / map.width) });
  });
  return out;
}

export function pathPoints(map: SimMap, path: readonly Vec[], from: { x: number; y: number }): THREE.Vector3[] {
  const pts = [from, ...path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }))];
  return pts.map((p) => {
    const w = worldFromGrid(map, p.x, p.y);
    return new THREE.Vector3(w.x, w.y + 0.12, w.z);
  });
}

/** Pebbles around the current cell so the mast camera sees a rocky near field. */
export function nearPebbles(
  map: SimMap,
  cellX: number,
  cellY: number,
  count = 620,
): { x: number; y: number; z: number; s: number; rx: number; ry: number }[] {
  const m = cellMetersOf(map);
  const out = [];
  for (let i = 0; i < count; i++) {
    const ang = (i * 2.399963) % (Math.PI * 2);
    const r = 0.6 + ((i * 47 + cellX * 13 + cellY * 29) % 240) * 0.26;
    const gx = cellX + 0.5 + (Math.sin(ang) * r) / m;
    const gy = cellY + 0.5 + (Math.cos(ang) * r) / m;
    const s = 0.18 + ((i * 17) % 17) * 0.08 + (i % 9 === 0 ? 0.55 : 0);
    const w = worldFromGrid(map, gx, gy);
    out.push({
      x: w.x,
      y: w.y + s * 0.28,
      z: w.z,
      s,
      rx: (i * 0.37) % 1.4,
      ry: (i * 0.61) % 2.2,
    });
  }
  return out;
}
