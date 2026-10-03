import { describe, expect, it } from 'vitest';
import { SimClock } from './clock';
import { TICKS_PER_MIN } from './config';
import { findPath } from './grid';
import { generateMap } from './map';
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
    sim.sendCommand({ action: 'drive_to', args: { target: 'wp-A' } });

    sim.stepTo(DELAY - 0.1);
    expect(sim.rover.status).toBe('idle');
    expect(sim.rover.pos).toEqual(start);

    sim.stepTo(DELAY);
    expect(sim.rover.status).toBe('driving');

    sim.stepTo(DELAY + 2);
    expect(sim.rover.pos).not.toEqual(start);
  });

  it('delivers the ack to mission control one delay after the rover received it', () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    sim.sendCommand({ action: 'drive_to', args: { target: 'wp-A' } });

    sim.stepTo(2 * DELAY - 0.1);
    expect(sim.ground.commands[0].status).toBe('in_flight');

    sim.stepTo(2 * DELAY);
    expect(sim.ground.commands[0]).toMatchObject({
      status: 'accepted',
      roverReceivedAt: DELAY,
      ackReceivedAt: 2 * DELAY,
    });
  });

  it("only ever shows mission control rover state that is at least one delay old", () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    const history = new Map<number, Vec>([[0, { ...sim.rover.pos }]]);
    sim.sendCommand({ action: 'drive_to', args: { target: 'outcrop-1' } });

    let sawMovement = false;
    for (let tick = 1; tick <= 60 * TICKS_PER_MIN; tick++) {
      sim.stepTo(tick / TICKS_PER_MIN);
      history.set(tick, { ...sim.rover.pos });

      const known = sim.ground.lastState;
      const knownTick = Math.round(known.simTime * TICKS_PER_MIN);
      expect(known.pos).toEqual(history.get(knownTick));
      if (known.simTime > 0) {
        expect(sim.now - known.simTime).toBeGreaterThanOrEqual(DELAY - 1e-9);
      }
      if (known.pos.x !== sim.map.roverStart.x || known.pos.y !== sim.map.roverStart.y) {
        sawMovement = true;
      }
    }
    expect(sawMovement).toBe(true);
    expect(sim.rover.target).toBe('outcrop-1');
  });

  it('rejects a drive into an unreachable target without moving', () => {
    const sim = new Sim({ seed: 42, oneWayDelayMin: DELAY });
    sim.sendCommand({ action: 'drive_to', args: { target: 'nowhere' } });
    sim.stepTo(2 * DELAY);
    expect(sim.rover.pos).toEqual(sim.map.roverStart);
    expect(sim.ground.commands[0].status).toBe('rejected');
  });
});
