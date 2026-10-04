import { useCallback, useEffect, useReducer, useState } from 'react';
import type { Plan } from '../../shared/plan';
import { DEFAULT_EPHEMERIS_DATE, earthMarsLightTime } from '../../shared/ephemeris';
import { SimClock } from './sim/clock';
import { Sim, type DecisionBook, type SendResult } from './sim/sim';
import type { TerrainId } from './sim/types';

const MAX_FRAME_SEC = 0.25;

const lightTime = (iso: string) => earthMarsLightTime(iso);

const createEngine = (autoAnswer: boolean, delayMin: number, terrain: TerrainId) => {
  const decisions: DecisionBook = new Map();
  return {
    clock: new SimClock(),
    baseline: new Sim({ mode: 'baseline', autoOperator: true, decisions, oneWayDelayMin: delayMin, terrain }),
    ours: new Sim({ mode: 'contingency', autoOperator: autoAnswer, decisions, oneWayDelayMin: delayMin, terrain }),
  };
};

export function useSim() {
  const [autoAnswer, setAutoAnswerState] = useState(false);
  const [ephemerisDate, setEphemerisDate] = useState(DEFAULT_EPHEMERIS_DATE);
  const [terrain, setTerrainState] = useState<TerrainId>('jezero');
  const [engine, setEngine] = useState(() => createEngine(false, lightTime(DEFAULT_EPHEMERIS_DATE).delayMin, 'jezero'));
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const light = lightTime(ephemerisDate);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const realDt = Math.min((t - last) / 1000, MAX_FRAME_SEC);
      last = t;
      const { clock, ours, baseline } = engine;
      clock.advance(realDt);
      if (ours.stepTo(clock.now)) {
        clock.now = ours.now;
        clock.paused = true;
      }
      baseline.stepTo(clock.now);
      rerender();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const rebuild = useCallback(
    (nextAnswer = autoAnswer, nextDate = ephemerisDate, nextTerrain = terrain) => {
      setEngine(createEngine(nextAnswer, lightTime(nextDate).delayMin, nextTerrain));
    },
    [autoAnswer, ephemerisDate, terrain],
  );

  const reset = useCallback(() => rebuild(), [rebuild]);

  const start = useCallback(
    (plan: Plan): SendResult => {
      const result = engine.ours.start(plan);
      if (result.ok) engine.baseline.start(plan);
      return result;
    },
    [engine],
  );

  const decide = useCallback(
    (optionId: string) => {
      engine.ours.decide(optionId);
      engine.clock.paused = false;
    },
    [engine],
  );

  const requestImage = useCallback(
    (stepId: string) => {
      if (engine.ours.requestImage(stepId)) engine.clock.paused = false;
    },
    [engine],
  );

  const setAutoAnswer = useCallback(
    (on: boolean) => {
      setAutoAnswerState(on);
      engine.ours.autoOperator = on;
      const waiting = engine.ours.awaitingDecision;
      if (on && waiting) decide(waiting.packet.recommendation);
    },
    [engine, decide],
  );

  const setDate = useCallback(
    (iso: string) => {
      setEphemerisDate(iso);
      rebuild(autoAnswer, iso, terrain);
    },
    [autoAnswer, terrain, rebuild],
  );

  const setTerrain = useCallback(
    (next: TerrainId) => {
      setTerrainState(next);
      rebuild(autoAnswer, ephemerisDate, next);
    },
    [autoAnswer, ephemerisDate, rebuild],
  );

  return {
    ...engine,
    started: engine.ours.startedAt !== null,
    awaitingDecision: engine.ours.awaitingDecision !== null,
    autoAnswer,
    setAutoAnswer,
    ephemerisDate,
    setDate,
    terrain,
    setTerrain,
    delayMin: light.delayMin,
    distanceKm: light.distanceKm,
    start,
    decide,
    requestImage,
    reset,
  };
}
