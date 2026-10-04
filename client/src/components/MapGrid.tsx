import type { CSSProperties } from 'react';
import type { SimMap, Vec } from '../sim/types';

interface MapGridProps {
  map: SimMap;
  rover: Vec;
  path?: readonly Vec[];
  /** Obstacles the rover has sensed (and reported, on the ground view). */
  boulders?: readonly Vec[];
  /** Staged obstacles nobody has seen yet; only shown on the sim-truth view. */
  hidden?: readonly Vec[];
  stale?: boolean;
  /** Where Earth last heard the rover was, drawn over the true position. */
  ghost?: Vec;
  /** Overlay caption, e.g. the staleness of the ghost. */
  caption?: string;
}

export function MapGrid({ map, rover, path = [], boulders = [], hidden = [], stale = false, ghost, caption }: MapGridProps) {
  const key = (p: Vec) => p.y * map.width + p.x;
  const pathCells = new Set(path.map(key));
  const boulderCells = new Set(boulders.map(key));
  const hiddenCells = new Set(hidden.map(key));
  const featureAt = new Map(map.features.map((f) => [key(f.pos), f]));
  const elevs = map.elevations;
  const elevMin = elevs?.reduce((a, b) => Math.min(a, b), Infinity);
  const elevMax = elevs?.reduce((a, b) => Math.max(a, b), -Infinity);
  const elevStyle = (i: number, cell: string): CSSProperties | undefined => {
    if (cell !== 'ground' || !elevs || elevMin === undefined || elevMax === undefined || elevMax === elevMin) return undefined;
    const t = (elevs[i] - elevMin) / (elevMax - elevMin);
    const l = Math.round(226 - t * 110);
    return { backgroundColor: `rgb(${l}, ${l}, ${l - 3})` };
  };

  return (
    <div className="map" style={{ gridTemplateColumns: `repeat(${map.width}, 1fr)` }}>
      {caption && <span className="map-caption">{caption}</span>}
      {map.cells.map((cell, i) => {
        const x = i % map.width;
        const y = Math.floor(i / map.width);
        const feature = featureAt.get(i);
        const classes = ['cell', cell];
        if (pathCells.has(i)) classes.push('path');
        if (feature) classes.push('feature', feature.kind);
        if (boulderCells.has(i)) classes.push('boulder');
        else if (hiddenCells.has(i)) classes.push('hidden-obstacle');
        const title = [
          feature ? `${feature.id}: ${feature.label}` : undefined,
          map.elevations ? `${map.elevations[i].toFixed(1)} m` : undefined,
          map.slopesDeg ? `slope ${map.slopesDeg[i].toFixed(1)}°` : undefined,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={i} className={classes.join(' ')} style={elevStyle(i, cell)} title={title || undefined}>
            {feature && <span className="tag">{feature.tag}</span>}
            {rover.x === x && rover.y === y && <span className={stale ? 'rover stale' : 'rover'} />}
            {ghost && ghost.x === x && ghost.y === y && <span className="rover stale" />}
          </div>
        );
      })}
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="legend">
      <span><i className="sw rover-live" /> rover (true position)</span>
      <span><i className="sw rover-ghost" /> rover as Earth last heard</span>
      <span><i className="sw relief" /> HiRISE elevation</span>
      <span><i className="sw rock" /> rock</span>
      <span><i className="sw sand" /> sand (no-go)</span>
      <span><i className="sw waypoint" /> waypoint</span>
      <span><i className="sw target" /> science target</span>
      <span><i className="sw path" /> planned path</span>
      <span><i className="sw boulder" /> boulder (sensed)</span>
      <span><i className="sw hidden-obstacle" /> staged surprise (not yet sensed)</span>
    </div>
  );
}
