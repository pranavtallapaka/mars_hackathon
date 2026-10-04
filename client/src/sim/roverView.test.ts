import { describe, expect, it } from 'vitest';
import { worldFromGrid } from '../view/terrain';
import { DEMO_PLAN } from './mars/mission';
import { Sim } from './sim';

describe('Stretch S3: first-person rover view', () => {
  it('the sim exposes a heading and world pose the 3D view can read', () => {
    const sim = new Sim({ terrain: 'jezero', oneWayDelayMin: 8 });
    const start = sim.rover.pose;
    expect(start.x).toBeCloseTo(sim.rover.pos.x + 0.5);
    expect(start.y).toBeCloseTo(sim.rover.pos.y + 0.5);
    const world = worldFromGrid(sim.map, start.x, start.y);
    expect(world.y).toBeGreaterThanOrEqual(0);
    expect(sim.start(DEMO_PLAN).ok).toBe(true);
    for (let t = 1; t <= 40; t++) sim.stepTo(t);
    if (sim.rover.plannedPath.length) {
      expect(sim.rover.heading).not.toBeNaN();
    }
  });

  it('done when: rover is handling the staged boulder while Earth still has the stale pose', () => {
    const sim = new Sim({ terrain: 'jezero', oneWayDelayMin: 12, autoOperator: false });
    expect(sim.start(DEMO_PLAN).ok).toBe(true);
    let seen = false;
    for (let t = 1; t <= 200; t++) {
      sim.stepTo(t);
      if (sim.rover.discovered.length > 0 && sim.ground.lastState.discovered.length === 0) {
        expect(sim.rover.pos).not.toEqual(sim.ground.lastState.pos);
        expect(sim.rover.undiscovered.length + sim.rover.discovered.length).toBeGreaterThan(0);
        seen = true;
        break;
      }
    }
    expect(seen).toBe(true);
  });
});
