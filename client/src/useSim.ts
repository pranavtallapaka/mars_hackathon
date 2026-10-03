import { useCallback, useEffect, useReducer, useState } from 'react';
import type { Plan } from '../../shared/plan';
import { SimClock } from './sim/clock';
import { Sim, type DecisionBook, type SendResult } from './sim/sim';

// Caps a single frame so a backgrounded tab doesn't jump the sim forward on return.
const MAX_FRAME_SEC = 0.25;

/** One clock, two worlds: same seed, mission and delay; only the system differs. */
const createEngine = (autoAnswer: boolean) => {
  const decisions: DecisionBook = new Map();
  return {
    clock: new SimClock(),
    baseline: new Sim({ mode: 'baseline', autoOperator: true, decisions }),
    ours: new Sim({ mode: 'contingency', autoOperator: autoAnswer, decisions }),
  };
};

export function useSim() {
  const [autoAnswer, setAutoAnswerState] = useState(false);
  const [engine, setEngine] = useState(() => createEngine(false));
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const realDt = Math.min((t - last) / 1000, MAX_FRAME_SEC);
      last = t;
      const { clock, ours, baseline } = engine;
      clock.advance(realDt);
      // Freeze the shared clock when an escalation needs you; the decision is charged a fixed time instead.
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

  const reset = useCallback(() => setEngine(createEngine(autoAnswer)), [autoAnswer]);

  /** Ours goes through the validator first; the baseline only starts if ours was cleared to fly. */
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

  const setAutoAnswer = useCallback(
    (on: boolean) => {
      setAutoAnswerState(on);
      engine.ours.autoOperator = on;
      const waiting = engine.ours.awaitingDecision;
      if (on && waiting) decide(waiting.packet.recommendation);
    },
    [engine, decide],
  );

  return {
    ...engine,
    started: engine.ours.startedAt !== null,
    awaitingDecision: engine.ours.awaitingDecision !== null,
    autoAnswer,
    setAutoAnswer,
    start,
    decide,
    reset,
  };
}
