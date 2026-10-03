import { useEffect, useReducer, useState } from 'react';
import { SimClock } from './sim/clock';
import { Sim } from './sim/sim';

// Caps a single frame so a backgrounded tab doesn't jump the sim forward on return.
const MAX_FRAME_SEC = 0.25;

export function useSim() {
  const [engine] = useState(() => ({ clock: new SimClock(), sim: new Sim() }));
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const realDt = Math.min((t - last) / 1000, MAX_FRAME_SEC);
      last = t;
      engine.clock.advance(realDt);
      engine.sim.stepTo(engine.clock.now);
      rerender();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  return engine;
}
