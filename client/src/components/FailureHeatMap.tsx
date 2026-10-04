import { useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { aggregateHeat } from '../sim/evidence';
import { createMap } from '../sim/map';
import type { SiteId } from '../../../shared/envelope/types';
import type { CellType } from '../sim/types';

interface FailureHeatMapProps {
  contextId: string;
  siteId: SiteId;
}

function cellFill(kind: CellType, elevation: number | undefined, minE: number, span: number): string {
  if (kind === 'rock') return '#6a6f72';
  if (kind === 'sand') return '#b5b9bb';
  if (elevation === undefined || span <= 0) return '#d5d8d6';
  const t = (elevation - minE) / span;
  const v = Math.round(214 - t * 90);
  return `rgb(${v},${v + 1},${v})`;
}

export function FailureHeatMap({ contextId, siteId }: FailureHeatMapProps) {
  const [failures] = useTable(tables.failure.where((r) => r.contextId.eq(contextId)));
  const map = useMemo(() => createMap(42, siteId === 'jezero' ? 'jezero' : 'synthetic'), [siteId]);
  const heat = useMemo(() => aggregateHeat([...failures]), [failures]);

  const elevations = map.elevations;
  const minE = elevations ? Math.min(...elevations) : 0;
  const maxE = elevations ? Math.max(...elevations) : 0;
  const span = maxE - minE;
  const maxCount = heat[0]?.count ?? 0;
  const cell = 1;
  const maxHits = Math.max(1, maxCount);

  return (
    <section className="envelope-heat">
      <h2>Escalation heat map</h2>
      <p className="muted small">
        {map.source?.label ?? 'Synthetic operational grid'} · {map.cellMeters ?? 25} m / cell · amber is envelope-side
        unsafe ends · live subscription
      </p>
      <svg
        className="heat-svg"
        viewBox={`-0.6 -0.6 ${map.width + 1.2} ${map.height + 1.4}`}
        role="img"
        aria-label={`Terrain grid ${map.width} by ${map.height} with ${heat.length} unsafe cells`}
      >
        {map.cells.map((kind, i) => {
          const x = i % map.width;
          const y = Math.floor(i / map.width);
          return (
            <rect
              key={`t-${i}`}
              x={x}
              y={y}
              width={cell}
              height={cell}
              fill={cellFill(kind, elevations?.[i], minE, span)}
            />
          );
        })}
        {map.noGoZones.map((z) => (
          <rect
            key={z.id}
            className="heat-nogo"
            x={z.rect.x}
            y={z.rect.y}
            width={z.rect.w}
            height={z.rect.h}
          />
        ))}
        {heat.map((h) => (
          <rect
            key={`h-${h.x}-${h.y}`}
            className="heat-hit"
            x={h.x}
            y={h.y}
            width={cell}
            height={cell}
            opacity={0.25 + (0.65 * h.count) / maxHits}
          >
            <title>
              {h.x},{h.y} · {h.count} · {h.reasons.join(', ')}
            </title>
          </rect>
        ))}
        {map.features.map((f) => (
          <text key={f.id} className="heat-label" x={f.pos.x + 0.5} y={f.pos.y + 0.72}>
            {f.tag}
          </text>
        ))}
        <text className="heat-axis" x={0} y={map.height + 0.85}>
          0,0
        </text>
        <text className="heat-axis" x={map.width} y={map.height + 0.85} textAnchor="end">
          {map.width - 1},{map.height - 1}
        </text>
      </svg>
      <p className="heat-legend">
        <span className="heat-swatch rock" /> rock
        <span className="heat-swatch sand" /> sand / no-go
        <span className="heat-swatch hit" /> unsafe end
        <span className="heat-scale">scale 100 m = {Math.round(100 / (map.cellMeters ?? 25))} cells</span>
      </p>
      <p className="muted small">
        {heat.length === 0
          ? 'No envelope-side unsafe cells in this window.'
          : `${heat.length} cells · peak ${maxCount} at ${heat[0].x},${heat[0].y}`}
      </p>
    </section>
  );
}
