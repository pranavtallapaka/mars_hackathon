import { SIM_MIN_PER_REAL_SEC } from './config';

/** The single source of sim time. Only this class converts real seconds; everything else reads `now` in sim minutes. */
export class SimClock {
  now = 0;
  paused = false;
  speed = 1;

  constructor(readonly simMinPerRealSec = SIM_MIN_PER_REAL_SEC) {}

  advance(realDtSec: number): number {
    if (!this.paused && realDtSec > 0) {
      this.now += realDtSec * this.simMinPerRealSec * this.speed;
    }
    return this.now;
  }
}
