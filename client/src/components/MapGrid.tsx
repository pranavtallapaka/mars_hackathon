import type { SimMap, Vec } from '../sim/types';

interface MapGridProps {
  map: SimMap;
  rover: Vec;
  path?: readonly Vec[];
  target?: string | null;
  stale?: boolean;
}

export function MapGrid({ map, rover, path = [], target, stale = false }: MapGridProps) {
  const pathCells = new Set(path.map((p) => p.y * map.width + p.x));
  const featureAt = new Map(map.features.map((f) => [f.pos.y * map.width + f.pos.x, f]));

  return (
    <div className="map" style={{ gridTemplateColumns: `repeat(${map.width}, 1fr)` }}>
      {map.cells.map((cell, i) => {
        const x = i % map.width;
        const y = Math.floor(i / map.width);
        const feature = featureAt.get(i);
        const classes = ['cell', cell];
        if (pathCells.has(i)) classes.push('path');
        if (feature) classes.push('feature', feature.kind);
        if (feature && feature.id === target) classes.push('target-active');
        return (
          <div key={i} className={classes.join(' ')} title={feature ? `${feature.id}: ${feature.label}` : undefined}>
            {feature && <span className="tag">{feature.tag}</span>}
            {rover.x === x && rover.y === y && <span className={stale ? 'rover stale' : 'rover'} />}
          </div>
        );
      })}
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="legend">
      <span><i className="sw rock" /> rock</span>
      <span><i className="sw sand" /> sand (no-go)</span>
      <span><i className="sw waypoint" /> waypoint</span>
      <span><i className="sw target" /> science target</span>
      <span><i className="sw path" /> planned path</span>
    </div>
  );
}
