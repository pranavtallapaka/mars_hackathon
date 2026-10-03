import { useCallback, useEffect, useReducer, useState } from 'react';
import type { Plan } from '../../shared/plan';
import { SimClock } from './sim/clock';
import { Sim } from './sim/sim';

// Caps a single frame so a backgrounded tab doesn't jump the sim forward on return.
const MAX_FRAME_SEC = 0.25;

/** One clock, two worlds: same seed, mission and delay; only the system differs. */
const createEngine = () => ({
  clock: new SimClock(),
  baseline: new Sim({ mode: 'baseline', autoOperator: true }),
  ours: new Sim({ mode: 'contingency', autoOperator: true }),
});

export function useSim() {
  const [engine, setEngine] = useState(createEngine);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const realDt = Math.min((t - last) / 1000, MAX_FRAME_SEC);
      last = t;
      engine.clock.advance(realDt);
      engine.baseline.stepTo(engine.clock.now);
      engine.ours.stepTo(engine.clock.now);
      rerender();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const reset = useCallback(() => setEngine(createEngine()), []);
  const start = useCallback(
    (plan: Plan) => {
      engine.baseline.start(plan);
      engine.ours.start(plan);
    },
    [engine],
  );

  return { ...engine, started: engine.ours.startedAt !== null, start, reset };
}
