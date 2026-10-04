import { useEffect, useMemo, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import reliefUrl from '../../../shared/mars/jezero-relief.png';
import { fetchLiveScene } from '../api';
import { AppNav } from '../components/AppNav';
import { tables } from '../module_bindings';
import {
  JEZERO_INSET,
  LIVE_DISCLAIMER,
  NASA_CREDIT,
  assembleReveal,
  branchLinks,
  cameraShortName,
  delaySentence,
  formatLatLon,
  lonLatToPct,
  optionalNumber,
  parseAnalysisJson,
  parsePlanJson,
  sceneCaption,
  type LiveRevealScene,
  type LiveRevealView,
} from '../../../shared/liveScene/reveal';
import { bundledFallbackSnapshot, CACHED_IMAGE_SRC } from './fallbackSnapshot';

const CROP_BOTTOM = 0.15;

const IMAGE_AT = 80;
const CAPTION_AT = 900;
const GROK_AT = 2000;
const HAZARD_AT = 2600;
const HAZARD_STEP = 700;
const TARGET_STEP = 650;
const PLAN_PAD = 750;
const DELAY_PAD = 600;
const MAP_PAD = 400;

interface StagedReveal extends LiveRevealView {
  imageSrc: string;
  source: 'spacetime' | 'api' | 'cache';
}

function shortHazardLabel(type: string): string {
  switch (type) {
    case 'rock': return 'Rock field';
    case 'steep_slope': return 'Steep slope';
    case 'sand_soft_soil': return 'Soft sand';
    case 'drop_off': return 'Drop-off';
    default: return 'Obstacle';
  }
}

function shortTargetLabel(type: string): string {
  switch (type) {
    case 'outcrop': return 'Outcrop';
    case 'layered_rock': return 'Layered rock';
    case 'interesting_rock': return 'Interesting rock';
    default: return 'Target';
  }
}

function plainStepName(step: { action: string; args: Record<string, string | number> }): string {
  const target = String(step.args.target ?? '');
  switch (step.action) {
    case 'drive_to':
      if (target === 'wp-alt') return 'Take the alternate route';
      return `Drive to ${target.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
    case 'image':
      return `Image the ${target.replace(/[-_]/g, ' ')}`;
    case 'hold': {
      const mins = step.args.minutes;
      return typeof mins === 'number' ? `Wait ${mins} min` : 'Hold position';
    }
    default:
      return (step.action as string).replace(/_/g, ' ');
  }
}

function branchConditionText(condition: string): string {
  switch (condition) {
    case 'path_blocked': return 'path blocked';
    case 'hazard_detected': return 'hazard detected';
    case 'battery_below_floor': return 'battery too low';
    case 'target_not_found': return 'target not found';
    case 'confidence_below': return 'low confidence';
    default: return condition.replace(/_/g, ' ');
  }
}

function branchThenText(then: string, steps: Array<{ id: string; action: string; args: Record<string, string | number> }>): string {
  if (then === 'escalate') return 'escalate';
  if (then === 'abort') return 'abort';
  if (then === 'skip') return 'skip';
  if (then.startsWith('goto:')) {
    const id = then.slice(5);
    const target = steps.find((s) => s.id === id);
    return target ? plainStepName(target).toLowerCase() : id;
  }
  return then;
}

function fullCaption(scene: LiveRevealScene): string {
  const base = sceneCaption(scene);
  if (scene.waypointSol !== undefined && scene.waypointSol !== scene.sol) {
    return `${base} Last waypoint: sol ${scene.waypointSol}.`;
  }
  return base;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fromSpacetime(
  scenes: Iterable<{
    id: string;
    imageId: string;
    sol: number;
    camera: string;
    utcDateTaken: string;
    daysAgo: number;
    nasaUrl: string;
    credit: string;
    isFallback: boolean;
    lat: unknown;
    lon: unknown;
    waypointSol: unknown;
  }>,
  plans: Iterable<{
    id: string;
    imageId: string;
    analysisJson: string;
    planJson: string;
    delayMin: number;
    rangeAu: number;
    earthDate: string;
  }>,
): StagedReveal | null {
  const list = [...scenes];
  const scene = list.find((s) => s.id === 'current') ?? list[0];
  if (!scene) return null;
  const planRows = [...plans];
  const planRow =
    planRows.find((p) => p.imageId === scene.imageId) ?? planRows.find((p) => p.id === 'current') ?? planRows[0];
  if (!planRow) return null;
  const analysis = parseAnalysisJson(planRow.analysisJson);
  const plan = parsePlanJson(planRow.planJson);
  if (!analysis || !plan) return null;
  return {
    ...assembleReveal({
      scene: {
        imageId: scene.imageId,
        sol: scene.sol,
        camera: scene.camera,
        utcDateTaken: scene.utcDateTaken,
        daysAgo: scene.daysAgo,
        nasaUrl: scene.nasaUrl,
        credit: scene.credit || NASA_CREDIT,
        isFallback: scene.isFallback,
        lat: optionalNumber(scene.lat),
        lon: optionalNumber(scene.lon),
        waypointSol: optionalNumber(scene.waypointSol),
      },
      analysis,
      plan,
      delayMin: planRow.delayMin,
      rangeAu: planRow.rangeAu,
      earthDate: planRow.earthDate,
    }),
    imageSrc: `/api/live-scene/image?imageId=${encodeURIComponent(scene.imageId)}`,
    source: 'spacetime',
  };
}

function withImage(view: LiveRevealView, cached: boolean, source: StagedReveal['source']): StagedReveal {
  const imageSrc = cached
    ? CACHED_IMAGE_SRC
    : `/api/live-scene/image?imageId=${encodeURIComponent(view.scene.imageId)}`;
  return { ...view, imageSrc, source };
}

export function LivePage() {
  const { isActive } = useSpacetimeDB();
  const [scenes] = useTable(tables.liveScene);
  const [plans] = useTable(tables.liveScenePlan);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<StagedReveal | null>(null);
  const [clock, setClock] = useState(0);
  const [running, setRunning] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const isDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

  const dbView = useMemo(() => fromSpacetime(scenes, plans), [scenes, plans]);

  // Crop sky (top) and rover hardware (bottom).
  const cropY = useMemo(() => {
    if (!view) return 0;
    const ys = [
      ...view.analysis.hazards.map((h) => h.bbox.y),
      ...view.analysis.targets.map((t) => t.bbox.y),
    ];
    return ys.length ? Math.max(0, Math.min(0.30, Math.min(...ys) - 0.10)) : 0;
  }, [view]);

  const imageAspect = imgSize ? imgSize.w / imgSize.h : 4 / 3;
  const visibleH = 1 - cropY - CROP_BOTTOM;
  const croppedAspect = imageAspect / visibleH;

  // Log raw box coordinates whenever a scene loads.
  useEffect(() => {
    if (!view) return;
    console.log('[live] scene loaded', {
      imageId: view.scene.imageId,
      sol: view.scene.sol,
      imageSize: imgSize,
      cropY: cropY.toFixed(3),
      hazards: view.analysis.hazards.map((h, i) => ({
        i,
        type: h.type,
        severity: h.severity,
        bbox: { x: h.bbox.x, y: h.bbox.y, w: h.bbox.w, h: h.bbox.h },
        label: shortHazardLabel(h.type),
      })),
      targets: view.analysis.targets.map((t, i) => ({
        i,
        type: t.type,
        bbox: { x: t.bbox.x, y: t.bbox.y, w: t.bbox.w, h: t.bbox.h },
        label: shortTargetLabel(t.type),
      })),
    });
  }, [view, cropY]);

  useEffect(() => {
    if (!running) return;
    if (prefersReducedMotion()) {
      setClock(30_000);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const next = now - started;
      setClock(next);
      if (next < 28_000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, view]);

  const startReveal = (next: StagedReveal) => {
    setImgSize(null);
    setView(next);
    setClock(0);
    setRunning(true);
  };

  const load = async () => {
    setError(null);
    setNote(null);
    setLoading(true);
    setRunning(false);
    try {
      if (cached) {
        try {
          startReveal(withImage(await fetchLiveScene(true), true, 'cache'));
        } catch {
          startReveal({ ...bundledFallbackSnapshot(), imageSrc: CACHED_IMAGE_SRC, source: 'cache' });
        }
        return;
      }
      if (dbView) {
        startReveal(dbView);
        return;
      }
      try {
        startReveal(withImage(await fetchLiveScene(false), false, 'api'));
      } catch {
        startReveal({ ...bundledFallbackSnapshot(), imageSrc: CACHED_IMAGE_SRC, source: 'cache' });
        setNote('Showing cached scene — live feed unreachable.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const hazardAt = (i: number) => HAZARD_AT + i * HAZARD_STEP;
  const targetAt = (i: number) => HAZARD_AT + (view?.analysis.hazards.length ?? 0) * HAZARD_STEP + 400 + i * TARGET_STEP;
  const planAt = view ? targetAt(view.analysis.targets.length) + PLAN_PAD : 12_000;
  const delayAt = planAt + DELAY_PAD;
  const mapAt = delayAt + MAP_PAD;
  const shown = (t: number) => !view || clock >= t;

  // Convert image-space y to container-space y (between cropY and 1-CROP_BOTTOM).
  const toContainerY = (y: number) => ((y - cropY) / visibleH) * 100;

  const location =
    view && typeof view.scene.lat === 'number' && typeof view.scene.lon === 'number'
      ? { lat: view.scene.lat, lon: view.scene.lon }
      : null;

  return (
    <div className="app live-page">
      <header className="topbar">
        <div>
          <h1>Latest from Mars</h1>
          <p className="subtitle">
            Perseverance {view ? cameraShortName(view.scene.camera) : 'Hazcam'}, read by Grok, planned for today&apos;s light-time.
          </p>
        </div>
        <div className="topbar-side">
          <AppNav current="live" />
          {isDebug && (
            <p className="stdb-live" data-ready={isActive ? 'true' : 'false'}>
              {isActive ? 'SpacetimeDB live_scene' : 'SpacetimeDB offline'}
            </p>
          )}
        </div>
      </header>

      <div className="live-toolbar">
        <button type="button" className="primary live-load" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : view ? 'Replay latest from Mars' : 'Load latest from Mars'}
        </button>
        <label className="live-cache-toggle">
          <input type="checkbox" checked={cached} onChange={(e) => setCached(e.target.checked)} />
          use cached scene
        </label>
        {note && <p className="muted small live-note">{note}</p>}
        {error && <p className="bad small live-note">{error}</p>}
      </div>

      <div className="live-stage">
        <figure className="live-photo">
          {/* Headline: above the image, large */}
          {view && shown(CAPTION_AT) && (
            <p className="live-photo-head">{fullCaption(view.scene)}</p>
          )}

          {/* Image frame: aspect-ratio set to the cropped dimensions */}
          <div
            className="live-frame"
            style={view ? { aspectRatio: String(croppedAspect) } : undefined}
          >
            {view ? (
              <>
                <img
                  className={shown(IMAGE_AT) ? 'is-on' : undefined}
                  src={view.imageSrc}
                  alt={`Perseverance ${view.scene.camera} sol ${view.scene.sol}`}
                  style={{ top: cropY > 0 ? `${-(cropY / visibleH) * 100}%` : undefined }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                />

              </>
            ) : (
              <div className="live-empty">
                <p>The latest Perseverance driving image, then Grok&apos;s reading, then the plan.</p>
              </div>
            )}
          </div>

          {/* Credit line below image */}
          {view && shown(CAPTION_AT) && (
            <figcaption className="live-caption">
              <p className="live-credit">
                <a href={view.scene.nasaUrl} target="_blank" rel="noreferrer">
                  {view.scene.credit || NASA_CREDIT}
                </a>
              </p>
            </figcaption>
          )}
          {view && shown(GROK_AT) && (
            <ul className="live-scene-tags">
              {view.analysis.targets.map((t, i) =>
                shown(targetAt(i)) ? (
                  <li key={`t-${i}`} className="live-scene-tag target" title={t.reason}>
                    {shortTargetLabel(t.type)}
                  </li>
                ) : null,
              )}
              {view.analysis.hazards.map((h, i) =>
                shown(hazardAt(i)) ? (
                  <li
                    key={`h-${i}`}
                    className={`live-scene-tag ${h.severity === 'low' ? 'context' : 'hazard'}`}
                    title={h.reason}
                  >
                    {shortHazardLabel(h.type)}
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </figure>

        <aside className={`live-side${view && shown(planAt) ? ' is-on' : ''}`} aria-live="polite">
          {view && shown(planAt) ? (
            <>
              <h2>Plan for this scene</h2>
              <ol className="live-steps">
                {view.plan.steps.map((step) => {
                  const stepRoute = step.action === 'drive_to'
                    ? (String(step.args.target ?? '') === 'wp-alt' ? 'alt' : 'main')
                    : null;
                  return (
                  <li
                    key={step.id}
                    onMouseEnter={() => stepRoute && setHoveredRoute(stepRoute)}
                    onMouseLeave={() => setHoveredRoute(null)}
                  >
                    <div className="step-line">
                      <span className="data step-id">{step.id}</span>
                      <span>{plainStepName(step)}</span>
                    </div>
                    {branchLinks(step, view.analysis.hazards).map((link) => {
                      // Item 3: don't show abort branches that only apply to low-severity (context) items.
                      const allLinkedLow =
                        link.hazards.length > 0 &&
                        link.hazards.every((h) => h.severity === 'low');
                      if (link.then === 'abort' && allLinkedLow) return null;

                      const linkedHazardIndex =
                        link.hazards.length > 0
                          ? view.analysis.hazards.findIndex(
                              (h) => h.type === link.hazards[0]?.type && h.reason === link.hazards[0]?.reason,
                            )
                          : -1;
                      const shortLabel =
                        link.hazards.length > 0 && link.hazards[0]
                          ? shortHazardLabel(link.hazards[0].type)
                          : null;
                      return (
                        <p
                          key={`${step.id}-${link.condition}`}
                          className="live-branch"
                          onMouseEnter={() => {
                            if (linkedHazardIndex >= 0)
                              setHoveredBox({ kind: 'hazard', index: linkedHazardIndex });
                          }}
                          onMouseLeave={() => setHoveredBox(null)}
                        >
                          if <span className="data">{branchConditionText(link.condition)}</span> →{' '}
                          {branchThenText(link.then, view.plan.steps)}
                          {shortLabel && <span> · {shortLabel}</span>}
                        </p>
                      );
                    })}
                  </li>
                  );
                })}
              </ol>
              <p className="live-escalate">
                Escalate when{' '}
                {view.plan.escalateWhen
                  .map((e) => e.replaceAll('_', ' ').replace('below:', 'below '))
                  .join('; ') || 'any surprise'}
                .
              </p>
              {shown(delayAt) && <p className="live-delay">{delaySentence(view.delayMin)}</p>}
              {location && shown(mapAt) && (
                <HiriseInset lat={location.lat} lon={location.lon} waypointSol={view.scene.waypointSol} />
              )}
            </>
          ) : (
            <p className="muted">The plan appears here after the outlines.</p>
          )}
        </aside>
      </div>

      <footer className="live-footer">{LIVE_DISCLAIMER}</footer>
    </div>
  );
}

const MAP_ZOOM = 2.8;

function HiriseInset({ lat, lon, waypointSol }: { lat: number; lon: number; waypointSol?: number }) {
  const pos = lonLatToPct(lat, lon, JEZERO_INSET);

  // Compute a viewport window centered on the rover.
  const vpW = 1 / MAP_ZOOM;
  const vpH = 1 / MAP_ZOOM;
  const vpLeft = Math.max(0, Math.min(1 - vpW, pos.x - vpW / 2));
  const vpTop = Math.max(0, Math.min(1 - vpH, pos.y - vpH / 2));

  // Image is MAP_ZOOM× the container; offset so vpLeft/vpTop appear at 0,0.
  const imgStyle = {
    width: `${MAP_ZOOM * 100}%`,
    height: `${MAP_ZOOM * 100}%`,
    left: `${-vpLeft * MAP_ZOOM * 100}%`,
    top: `${-vpTop * MAP_ZOOM * 100}%`,
  };

  // Dot position within the container.
  const dotLeft = (pos.x - vpLeft) * MAP_ZOOM * 100;
  const dotTop = (pos.y - vpTop) * MAP_ZOOM * 100;
  const dotInView = dotLeft >= 2 && dotLeft <= 98 && dotTop >= 2 && dotTop <= 98;

  return (
    <figure className="live-map">
      <p className="live-map-label">Perseverance&apos;s location, Jezero crater</p>
      <div className="live-map-frame">
        <img
          className="live-map-relief"
          src={reliefUrl}
          alt="HiRISE relief of Jezero crater"
          style={imgStyle}
        />
        {dotInView && (
          <span
            className="live-rover-dot"
            style={{ left: `${dotLeft}%`, top: `${dotTop}%` }}
          />
        )}
      </div>
      <figcaption className="live-map-coords">
        <span className="data">{formatLatLon(lat, lon)}</span>
        {waypointSol !== undefined && ` · waypoint sol ${waypointSol}`}
      </figcaption>
    </figure>
  );
}
