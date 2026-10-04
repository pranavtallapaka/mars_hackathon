import { View } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatMin } from '../format';
import { AppNav } from '../components/AppNav';
import { DEMO_SEED } from '../sim/config';
import { createMap } from '../sim/map';
import { buildMarsMission } from '../sim/mars/mission';
import { getComparison, sampleAt, type ReplayRun } from '../sim/replay';
import { overlayFor, sameTrack } from './overlays';
import { MARS_FOG, SideScene, linePoints, rockCells, useMarsTextures, type SharedMarsAssets } from './MarsScene';
import { drivenPathUntil, plannedRoute } from './route';

type CameraMode = 'chase' | 'fp';

export function ComparePage() {
  const [pair, setPair] = useState<{ baseline: ReplayRun; envelope: ReplayRun } | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const container = useRef<HTMLDivElement>(null);

  const map = useMemo(() => createMap(DEMO_SEED, 'jezero'), []);
  const mission = useMemo(() => buildMarsMission(map, DEMO_SEED), [map]);
  const textures = useMarsTextures();
  const assets = useMemo<SharedMarsAssets>(
    () => ({
      textures,
      rocks: rockCells(map, []),
      hidden: mission.hiddenObstacles,
      planned: linePoints(
        map,
        [
          { x: map.roverStart.x + 0.5, y: map.roverStart.y + 0.5 },
          ...plannedRoute(map).map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })),
        ],
      ),
    }),
    [textures, map, mission],
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setPair(getComparison(DEMO_SEED)));
    return () => cancelAnimationFrame(id);
  }, []);

  const endMin = useMemo(() => {
    if (!pair) return 1;
    const done = (run: ReplayRun) => run.events.find((e) => e.type === 'done')?.t ?? 1;
    return Math.max(done(pair.baseline), done(pair.envelope), 1);
  }, [pair]);

  useEffect(() => {
    if (!playing || !pair) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= endMin) {
          setPlaying(false);
          return endMin;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pair, endMin]);

  const startPose = {
    t: 0,
    x: map.roverStart.x + 0.5,
    y: map.roverStart.y + 0.5,
    heading: 0,
    state: 'idle' as const,
    waitRemaining: null,
  };
  const leftT = pair ? freezeT(pair.baseline, t) : 0;
  const rightT = pair ? freezeT(pair.envelope, t) : 0;
  const leftSample = pair ? sampleAt(pair.baseline, leftT) : startPose;
  const rightSample = pair ? sampleAt(pair.envelope, rightT) : startPose;
  const leftHud = pair ? overlayFor(pair.baseline, leftT, leftSample) : null;
  const rightHud = pair ? overlayFor(pair.envelope, rightT, rightSample) : null;
  const leftTrail = pair ? drivenPathUntil(pair.baseline, leftT) : [startPose];
  const rightTrail = pair ? drivenPathUntil(pair.envelope, rightT) : [startPose];
  const locked = sameTrack(leftSample, rightSample);

  return (
    <div className="mars-compare">
      <header className="topbar">
        <div>
          <h1>Mars, side by side</h1>
          <p className="subtitle">
            Same drive until the boulder. Then one calls Earth; the other takes the onboard branch.
          </p>
        </div>
        <AppNav current="compare" />
      </header>

      <div className="mars-compare-stage" ref={container}>
        <Canvas
          dpr={[1, 1.25]}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => gl.setClearColor(MARS_FOG, 1)}
          eventSource={container}
          eventPrefix="client"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <View.Port />
        </Canvas>
        <div className="mars-compare-split">
          <Pane title="Conventional operations" hud={leftHud} ready={Boolean(pair)}>
            <View index={1} className="mars-compare-view">
              <SideScene
                map={map}
                assets={assets}
                pose={leftSample}
                follow={leftSample}
                trail={leftTrail}
                cameraMode={cameraMode}
              />
            </View>
          </Pane>
          <Pane title="With autonomy envelope" hud={rightHud} ready={Boolean(pair)}>
            <View index={2} className="mars-compare-view">
              <SideScene
                map={map}
                assets={assets}
                pose={rightSample}
                follow={locked ? leftSample : rightSample}
                trail={rightTrail}
                cameraMode={cameraMode}
              />
            </View>
          </Pane>
        </div>
        {!pair && <p className="mars-compare-loading">Loading Jezero replay…</p>}
      </div>

      <div className="mars-compare-controls" role="group" aria-label="Replay clock">
        <button type="button" className={playing ? 'active' : undefined} onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        {([1, 4, 16] as const).map((n) => (
          <button key={n} type="button" className={speed === n ? 'active' : undefined} onClick={() => setSpeed(n)}>
            {n}x
          </button>
        ))}
        <label className="mars-compare-scrub">
          <span className="muted small">Scrub</span>
          <input
            type="range"
            min={0}
            max={endMin}
            step={0.1}
            value={Math.min(t, endMin)}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setT(0);
            setPlaying(true);
          }}
        >
          Restart
        </button>
        <button
          type="button"
          className={cameraMode === 'fp' ? 'active' : undefined}
          onClick={() => setCameraMode((m) => (m === 'chase' ? 'fp' : 'chase'))}
        >
          {cameraMode === 'fp' ? 'Chase camera' : 'First person'}
        </button>
      </div>

      <p className="mars-compare-note muted small">
        Typical simulated run on real Jezero terrain. Time compressed; ratios are real. Surface textures and sky
        generated with Grok Imagine.
      </p>
    </div>
  );
}

function freezeT(run: ReplayRun, t: number): number {
  const done = run.events.find((e) => e.type === 'done');
  return done && t > done.t ? done.t : t;
}

function Pane({
  title,
  hud,
  ready,
  children,
}: {
  title: string;
  hud: ReturnType<typeof overlayFor> | null;
  ready: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mars-compare-pane">
      {children}
      <div className="mars-compare-hud">
        <p className="mars-compare-title">{title}</p>
        {ready && hud && (
          <>
            <p className="mars-compare-status">{hud.status}</p>
            <div className="mars-compare-meta">
              <span>{hud.clock}</span>
              <span>{hud.trips} round trips</span>
              <span>{formatMin(hud.waitMin)} waiting</span>
            </div>
            {hud.doneAt !== null && <p className="mars-compare-done">Done at minute {Math.round(hud.doneAt)}</p>}
            {hud.countdown && <p className="mars-compare-wait">{hud.countdown}</p>}
            {hud.branch && <p className="mars-compare-branch">{hud.branch}</p>}
            {hud.escalation && <p className="mars-compare-escalation">{hud.escalation}</p>}
            {hud.hold && <p className="mars-compare-hold">{hud.hold}</p>}
          </>
        )}
      </div>
    </div>
  );
}
