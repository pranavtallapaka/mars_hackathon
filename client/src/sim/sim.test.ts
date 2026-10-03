import { describe, expect, it } from 'vitest';
import { SimClock } from './clock';
import { TICKS_PER_MIN } from './config';
import { findPath } from './grid';
import { generateMap } from './map';
import { DEMO_PLAN } from './mars/mission';
import { Sim } from './sim';
import type { Vec } from './types';

const DELAY = 8;

describe('map', () => {
  it('is deterministic for a seed', () => {
    expect(generateMap(42)).toEqual(generateMap(42));
  });

  it('varies rock layout across seeds', () => {
    expect(generateMap(1).cells).not.toEqual(generateMap(2).cells);
  });

  it('has every feature reachable from the start without crossing sand', () => {
    for (const seed of [1, 7, 42, 1234]) {
      const map = generateMap(seed);
      for (const f of map.features) expect(findPath(map, map.roverStart, f.pos)).not.toBeNull();
      expect(map.cells).toContain('sand');
    }
  });
});

describe('clock', () => {
  it('maps 1 real second to 1 sim minute, scaled by speed, frozen when paused', () => {
    const clock = new SimClock();
    clock.advance(3);
    expect(clock.now).toBe(3);
    clock.speed = 5;
    clock.advance(2);
    expect(clock.now).toBe(13);
    clock.paused = true;
    clock.advance(10);
    expect(clock.now).toBe(13);
  });
});

describe('delay link (Batch 1 done-when)', () => {
  it('moves the rover only after the one-way delay', () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    const start = { ...sim.rover.pos };
    expect(sim.sendPlan(DEMO_PLAN).ok).toBe(true);

    sim.stepTo(DELAY - 0.1);
    expect(sim.executor.mode).toBe('idle');
    expect(sim.rover.pos).toEqual(start);

    sim.stepTo(DELAY);
    expect(sim.executor.mode).toBe('executing');

    sim.stepTo(DELAY + 2);
    expect(sim.rover.pos).not.toEqual(start);
  });

  it('delivers the ack to mission control one delay after the rover received the plan', () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    sim.sendPlan(DEMO_PLAN);

    sim.stepTo(2 * DELAY - 0.1);
    expect(sim.ground.uplinks[0].status).toBe('in_flight');

    sim.stepTo(2 * DELAY);
    expect(sim.ground.uplinks[0]).toMatchObject({
      status: 'accepted',
      roverReceivedAt: DELAY,
      ackReceivedAt: 2 * DELAY,
    });
  });

  it('only ever shows mission control rover state that is at least one delay old', () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    const history = new Map<number, Vec>([[0, { ...sim.rover.pos }]]);
    sim.sendPlan(DEMO_PLAN);

    let sawMovement = false;
    for (let tick = 1; tick <= 60 * TICKS_PER_MIN; tick++) {
      sim.stepTo(tick / TICKS_PER_MIN);
      history.set(tick, { ...sim.rover.pos });

      const known = sim.ground.lastState;
      expect(known.pos).toEqual(history.get(Math.round(known.simTime * TICKS_PER_MIN)));
      if (known.simTime > 0) expect(sim.now - known.simTime).toBeGreaterThanOrEqual(DELAY - 1e-9);
      if (known.pos.x !== sim.map.roverStart.x || known.pos.y !== sim.map.roverStart.y) sawMovement = true;
    }
    expect(sawMovement).toBe(true);
  });
});
