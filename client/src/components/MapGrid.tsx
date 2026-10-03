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
}

export function MapGrid({ map, rover, path = [], boulders = [], hidden = [], stale = false }: MapGridProps) {
  const key = (p: Vec) => p.y * map.width + p.x;
  const pathCells = new Set(path.map(key));
  const boulderCells = new Set(boulders.map(key));
  const hiddenCells = new Set(hidden.map(key));
  const featureAt = new Map(map.features.map((f) => [key(f.pos), f]));

  return (
    <div className="map" style={{ gridTemplateColumns: `repeat(${map.width}, 1fr)` }}>
      {map.cells.map((cell, i) => {
        const x = i % map.width;
        const y = Math.floor(i / map.width);
        const feature = featureAt.get(i);
        const classes = ['cell', cell];
        if (pathCells.has(i)) classes.push('path');
        if (feature) classes.push('feature', feature.kind);
        if (boulderCells.has(i)) classes.push('boulder');
        else if (hiddenCells.has(i)) classes.push('hidden-obstacle');
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
      <span><i className="sw boulder" /> boulder (sensed)</span>
      <span><i className="sw hidden-obstacle" /> staged surprise (not yet sensed)</span>
    </div>
  );
}
