import { useMemo, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { postMissionContext } from '../api';
import { tables } from '../module_bindings';
import { DEFAULT_CONCEPT, missionContextId } from '../../../shared/envelope/concept';
import { SITES } from '../../../shared/envelope/sites';
import type { MissionConcept, MissionContext, SiteId, SolState } from '../../../shared/envelope/types';
import { AppNav } from './AppNav';
import { AgentPanel } from './AgentPanel';
import { CampaignPanel } from './CampaignPanel';

const COMM_LABEL: Record<SolState['comm'], string> = {
  normal: 'normal',
  long_gap: 'long gap',
  conjunction: 'conjunction',
};

function seasonLabel(s: string): string {
  return s.replace('northern_', 'NH ');
}

export function EnvelopePage() {
  const [siteId, setSiteId] = useState<SiteId>(DEFAULT_CONCEPT.siteId);
  const [startDate, setStartDate] = useState(DEFAULT_CONCEPT.startDate);
  const [sols, setSols] = useState(DEFAULT_CONCEPT.sols);
  const [ctx, setCtx] = useState<MissionContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { isActive } = useSpacetimeDB();
  const contextId = missionContextId({ siteId, startDate, sols });
  const [liveSols, solsReady] = useTable(tables.solConditions.where((r) => r.contextId.eq(contextId)));
  const [liveSources] = useTable(tables.dataSource);

  const load = async () => {
    setError(null);
    setPersistError(null);
    setLoading(true);
    try {
      const concept: MissionConcept = { siteId, startDate, sols };
      const result = await postMissionContext(concept);
      setCtx(result.context);
      if (!result.persisted) {
        setPersistError(result.persistError ?? 'SpacetimeDB write failed');
      }
    } catch (err) {
      setCtx(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const subscribedSols = useMemo(
    () => [...liveSols].sort((a, b) => a.solIndex - b.solIndex),
    [liveSols],
  );
  const displaySols = subscribedSols.length ? subscribedSols : (ctx?.sols ?? []);
  const fromSubscription = subscribedSols.length > 0;

  const commCounts = useMemo(() => {
    const counts = { normal: 0, long_gap: 0, conjunction: 0 };
    for (const s of displaySols) {
      if (s.comm in counts) counts[s.comm as SolState['comm']]++;
    }
    return counts;
  }, [displaySols]);

  const sourceNote = (name: string, fallback?: string) =>
    liveSources.find((s) => s.name === name)?.note ?? fallback;

  return (
    <div className="app envelope-page">
      <header className="topbar">
        <div>
          <h1>Autonomy envelope</h1>
          <p className="subtitle">Which decisions this rover can make alone, at this site, in this window.</p>
        </div>
        <AppNav current="envelope" />
      </header>

      <section className="envelope-concept">
        <h2>Mission concept</h2>
        <p className="muted small">
          Load the real sources first. The agent proposes and tunes an envelope from this context. This is not a
          certification.
        </p>
        <div className="envelope-form">
          <label>
            Site
            <select value={siteId} onChange={(e) => setSiteId(e.target.value as SiteId)}>
              {(Object.keys(SITES) as SiteId[]).map((id) => (
                <option key={id} value={id}>
                  {SITES[id].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start (UTC)
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            Sols
            <input
              type="number"
              min={1}
              max={400}
              value={sols}
              onChange={(e) => setSols(Number(e.target.value))}
            />
          </label>
          <button type="button" className="primary" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Load sources'}
          </button>
        </div>
        <p className="stdb-live" data-ready={isActive && solsReady ? 'true' : 'false'}>
          {isActive && solsReady
            ? `SpacetimeDB live · ${fromSubscription ? `${subscribedSols.length} sols subscribed` : 'waiting for a write'}`
            : 'Connecting to SpacetimeDB…'}
        </p>
        {error && <p className="bad small">{error}</p>}
        {persistError && <p className="bad small">{persistError}</p>}
      </section>

      {(ctx || displaySols.length > 0) && (
        <>
          <section className="envelope-sources">
            <h2>Data sources</h2>
            <table className="source-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Provenance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>HiRISE terrain</td>
                  <td>{ctx?.terrain.site.terrainKind === 'hirise' ? 'loaded' : ctx ? 'fallback' : 'in SpacetimeDB'}</td>
                  <td>{sourceNote('terrain', ctx?.sources.terrain.note ?? ctx?.sources.terrain.source)}</td>
                </tr>
                <tr>
                  <td>JPL Horizons</td>
                  <td>
                    loaded · {commCounts.conjunction} conjunction · {commCounts.long_gap} long gap
                  </td>
                  <td>{sourceNote('horizons', ctx?.sources.horizons.note)}</td>
                </tr>
                <tr>
                  <td>Mars24</td>
                  <td>
                    {displaySols[0]
                      ? `loaded · Ls ${displaySols[0].lsDeg}° · ${seasonLabel(displaySols[0].season)}`
                      : 'loaded'}
                  </td>
                  <td>{sourceNote('mars24', ctx?.sources.mars24.note)}</td>
                </tr>
                <tr>
                  <td>Perseverance</td>
                  <td>
                    {ctx?.benchmark.available
                      ? `loaded · ${ctx.benchmark.kmPerSol} km/sol`
                      : ctx
                        ? 'not applicable'
                        : 'in SpacetimeDB'}
                  </td>
                  <td>{sourceNote('perseverance', ctx?.sources.perseverance.note)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="envelope-sols">
            <h2>Per-sol state</h2>
            <p className="muted small">
              {ctx?.site.label ?? SITES[siteId].label} · {displaySols[0]?.earthDate} to {displaySols.at(-1)?.earthDate} ·
              delay {displaySols[0]?.delayMin}–{displaySols.reduce((m, s) => Math.max(m, s.delayMin), 0)} min
              {fromSubscription ? ' · live subscription' : ''}
            </p>
            <div className="sol-table-wrap">
              <table className="sol-table">
                <thead>
                  <tr>
                    <th>Sol</th>
                    <th>Earth</th>
                    <th>Delay</th>
                    <th>Link</th>
                    <th>Ls</th>
                    <th>Daylight</th>
                    <th>Sun el.</th>
                  </tr>
                </thead>
                <tbody>
                  {displaySols.map((s) => (
                    <tr key={s.solIndex} className={s.comm === 'conjunction' ? 'sol-conjunction' : undefined}>
                      <td>{s.solIndex}</td>
                      <td>{s.earthDate}</td>
                      <td>{s.delayMin} min</td>
                      <td>{COMM_LABEL[s.comm as SolState['comm']] ?? s.comm}</td>
                      <td>{s.lsDeg}°</td>
                      <td>{s.daylightHours} h</td>
                      <td>{s.sunElevationDeg}°</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {ctx && (
            <section className="envelope-bench">
              <h2>Conventional-ops benchmark</h2>
              {ctx.benchmark.available ? (
                <p>
                  Perseverance drove {ctx.benchmark.distanceKm} km over sols {ctx.benchmark.solFirst}–{ctx.benchmark.solLast}{' '}
                  ({ctx.benchmark.kmPerSol} km/sol). Rough pace only — the real traverse also reflects science stops this sim
                  does not model.
                </p>
              ) : (
                <p className="muted">{ctx.benchmark.source.note}</p>
              )}
            </section>
          )}

          <AgentPanel concept={{ siteId, startDate, sols }} contextId={contextId} />
          <CampaignPanel concept={{ siteId, startDate, sols }} contextId={contextId} />
        </>
      )}
    </div>
  );
}
