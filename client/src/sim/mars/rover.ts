import { confidenceThreshold, type EscalationPacket, type Plan, type PlanStep } from '../../../../shared/plan';
import {
  BATTERY_PCT_PER_CELL,
  CELL_METERS,
  DEFAULT_DRILL_DEPTH_CM,
  DEFAULT_HOLD_MIN,
  DEFAULT_IMAGE_CONFIDENCE,
  DRILL_CM_PER_MIN,
  DRILL_PCT_PER_MIN,
  IMAGE_MIN,
  IMAGE_PCT_PER_MIN,
  ROVER_CELLS_PER_MIN,
  SAMPLE_MIN,
  SAMPLE_PCT_PER_MIN,
  SENSE_RANGE_CELLS,
  WAIT_IMAGE_PERIOD_MIN,
} from '../config';
import type { ConditionEvent, EscalationContext, ScenarioRuntime, StepEvent, StepRun, StepStart } from '../executor';
import { cellAt, cellIndex, featureById, findPath, samePos, zoneAt } from '../grid';
import type { Feature, SimMap, Vec } from '../types';
import type { MarsMission } from './mission';
import { optionLabel, type MarsOptionIntent } from './options';

const EPS = 1e-9;

type Option = EscalationPacket['options'][number];

const chebyshev = (a: Vec, b: Vec) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function compass(from: Vec, to: Vec): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ns = dy < 0 ? 'N' : dy > 0 ? 'S' : '';
  const ew = dx > 0 ? 'E' : dx < 0 ? 'W' : '';
  return ns + ew || 'here';
}

/** A timed action that spends battery and finishes after `minutes`. */
class TimedRun implements StepRun {
  private elapsed = 0;
  constructor(
    private readonly rover: MarsRover,
    private readonly minutes: number,
    private readonly pctPerMin: number,
    private readonly onDone: () => StepEvent,
  ) {}

  tick(dt: number): StepEvent {
    this.elapsed += dt;
    this.rover.drain(dt * this.pctPerMin);
    return this.elapsed >= this.minutes - EPS ? this.onDone() : { type: 'running' };
  }
}

/** The Mars rover body: sensing, motion, battery and onboard hard limits. */
export class MarsRover implements ScenarioRuntime {
  pos: Vec;
  batteryPct = 100;
  activity = 'idle';
  imagesTaken = 0;
  samplesCollected = 0;
  lastSafeWaypoint: { id: string; pos: Vec };
  readonly discovered: Vec[] = [];

  private path: Vec[] = [];
  private readonly hidden: Set<number>;
  private readonly discoveredCells = new Set<number>();
  private waitTimer = 0;
  private waitImages = 0;

  constructor(
    private readonly map: SimMap,
    private readonly mission: MarsMission,
  ) {
    this.pos = { ...map.roverStart };
    const home = map.features.find((f) => f.kind === 'waypoint' && samePos(f.pos, map.roverStart));
    this.lastSafeWaypoint = { id: home?.id ?? 'start', pos: { ...map.roverStart } };
    this.hidden = new Set(mission.hiddenObstacles.map((p) => cellIndex(map, p)));
  }

  get plannedPath(): readonly Vec[] {
    return this.path;
  }

  get undiscovered(): Vec[] {
    return this.mission.hiddenObstacles.filter((p) => !this.discoveredCells.has(cellIndex(this.map, p)));
  }

  drain(pct: number): void {
    this.batteryPct = Math.max(0, this.batteryPct - pct);
  }

  start(step: PlanStep, plan: Plan): StepStart {
    switch (step.action) {
      case 'drive_to':
        return this.startDrive(String(step.args.target ?? ''), plan);
      case 'image':
        return this.startImage(step, plan);
      case 'drill':
        return this.startDrill(step, plan);
      case 'collect_sample':
        return this.startSample(step, plan);
      case 'hold': {
        const minutes = Number(step.args.minutes ?? DEFAULT_HOLD_MIN);
        this.activity = `holding ${minutes} min`;
        return { type: 'started', note: `${minutes} min`, run: new TimedRun(this, minutes, 0, () => ({ type: 'done' })) };
      }
      default:
        return { type: 'violation', detail: `action ${step.action} is not supported onboard` };
    }
  }

  stop(): void {
    this.path = [];
    this.waitTimer = 0;
    this.waitImages = 0;
    this.activity = 'stopped';
  }

  whileWaiting(tasks: readonly string[], dt: number): string[] {
    if (!tasks.includes('image_surroundings')) {
      this.activity = 'safe hold';
      return [];
    }
    this.activity = 'safe hold: imaging surroundings';
    this.waitTimer += dt;
    if (this.waitTimer < WAIT_IMAGE_PERIOD_MIN - EPS) return [];
    this.waitTimer = 0;
    this.imagesTaken++;
    this.drain(IMAGE_MIN * IMAGE_PCT_PER_MIN);
    // One log line per hold, not per frame; the image counter shows the rest.
    if (this.waitImages++ > 0) return [];
    return [`while waiting: image_surroundings every ${WAIT_IMAGE_PERIOD_MIN} min (stored onboard, none downlinked)`];
  }

  startReturn(): StepStart {
    const { id, pos } = this.lastSafeWaypoint;
    if (samePos(pos, this.pos)) {
      return { type: 'started', note: `already at ${id}`, run: { tick: () => ({ type: 'done', note: `at ${id}` }) } };
    }
    const path = this.planPath(pos);
    if (!path) return { type: 'violation', detail: `no safe route back to ${id}` };
    return this.beginDrive(path, id, null, `returning to ${id}, ${path.length} cells`);
  }

  buildEscalation({ plan, step, reason, condition, now }: EscalationContext): EscalationPacket {
    const siteId = String(step.args.site ?? step.args.target ?? '');
    const { options, recommendation } = this.escalationOptions(step, condition);
    return {
      planId: plan.planId,
      stepId: step.id,
      simTime: now,
      whatHappened: reason.charAt(0).toUpperCase() + reason.slice(1),
      scene: this.describeScene(siteId),
      options,
      recommendation,
    };
  }

  // --- actions ---------------------------------------------------------------

  private startDrive(targetId: string, plan: Plan): StepStart {
    const target = featureById(this.map, targetId);
    if (!target) return { type: 'condition', condition: 'target_not_found', detail: `unknown target ${targetId}` };
    const zone = this.noGoZoneAt(target.pos);
    if (zone) return { type: 'violation', detail: `${targetId} is inside no-go zone ${zone}` };
    const path = this.planPath(target.pos);
    if (!path) return { type: 'condition', condition: 'path_blocked', detail: `no safe route to ${targetId}` };
    const low = this.batteryCheck(path.length * BATTERY_PCT_PER_CELL, `drive to ${targetId}`, plan);
    if (low) return low;
    return this.beginDrive(path, targetId, plan.limits.batteryFloorPct, `${path.length} cells`);
  }

  /** `floor` is null for an abort return, which must not be refused for low battery. */
  private beginDrive(path: Vec[], label: string, floor: number | null, note: string): StepStart {
    this.path = path;
    const blocked = this.senseAhead(label);
    if (blocked) return blocked;
    this.activity = `driving to ${label}`;

    let progress = 0;
    const run: StepRun = {
      tick: (dt) => {
        progress += dt * ROVER_CELLS_PER_MIN;
        while (progress >= 1 - EPS && this.path.length) {
          this.pos = this.path.shift()!;
          progress -= 1;
          this.drain(BATTERY_PCT_PER_CELL);
          this.noteWaypoint();
          if (floor !== null && this.batteryPct < floor) {
            return { type: 'condition', condition: 'battery_below_floor', detail: `battery ${this.batteryPct.toFixed(1)}% below floor ${floor}%` };
          }
          const blocked = this.senseAhead(label);
          if (blocked) return blocked;
        }
        if (this.path.length) return { type: 'running' };
        this.activity = `at ${label}`;
        return { type: 'done', note: `arrived at ${label}` };
      },
    };
    return { type: 'started', run, note };
  }

  private startImage(step: PlanStep, plan: Plan): StepStart {
    const targetId = step.args.target === undefined ? null : String(step.args.target);
    const target = targetId ? featureById(this.map, targetId) : null;
    if (targetId && (!target || chebyshev(target.pos, this.pos) > 2)) {
      return { type: 'condition', condition: 'target_not_found', detail: `${targetId} not in camera view` };
    }
    this.activity = `imaging ${targetId ?? 'surroundings'}`;
    const run = new TimedRun(this, IMAGE_MIN, IMAGE_PCT_PER_MIN, () => {
      this.imagesTaken++;
      if (!targetId) return { type: 'done', note: 'imaged surroundings' };
      const confidence = this.mission.sites[targetId]?.confidence ?? DEFAULT_IMAGE_CONFIDENCE;
      const threshold = confidenceThreshold(plan);
      if (threshold !== null && confidence < threshold) {
        return { type: 'condition', condition: 'confidence_below', detail: `target ID confidence ${confidence} < ${threshold}` };
      }
      return { type: 'done', note: `${targetId} identified (confidence ${confidence})` };
    });
    return { type: 'started', run, note: `${IMAGE_MIN} min` };
  }

  private startDrill(step: PlanStep, plan: Plan): StepStart {
    const site = this.siteInReach(step);
    if ('type' in site) return site;
    const depthCm = Number(step.args.depthCm ?? DEFAULT_DRILL_DEPTH_CM);
    const minutes = depthCm / DRILL_CM_PER_MIN;
    const low = this.batteryCheck(minutes * DRILL_PCT_PER_MIN, `drill ${site.id}`, plan);
    if (low) return low;

    const stallCm = step.args.force === 'high' ? undefined : this.mission.sites[site.id]?.drillStallCm;
    this.activity = `drilling ${site.id}`;
    let depth = 0;
    const run: StepRun = {
      tick: (dt) => {
        depth += dt * DRILL_CM_PER_MIN;
        this.drain(dt * DRILL_PCT_PER_MIN);
        if (stallCm !== undefined && depth >= stallCm - EPS) {
          this.activity = `drill stalled at ${site.id}`;
          return { type: 'condition', condition: 'rock_too_hard', detail: `drill stalled at ${stallCm} cm; rock harder than expected` };
        }
        if (depth >= depthCm - EPS) return { type: 'done', note: `drilled ${depthCm} cm at ${site.id}` };
        return { type: 'running' };
      },
    };
    return { type: 'started', run, note: `target ${depthCm} cm, ~${minutes} min` };
  }

  private startSample(step: PlanStep, plan: Plan): StepStart {
    const site = this.siteInReach(step);
    if ('type' in site) return site;
    const low = this.batteryCheck(SAMPLE_MIN * SAMPLE_PCT_PER_MIN, `collect sample at ${site.id}`, plan);
    if (low) return low;
    this.activity = `collecting sample at ${site.id}`;
    const run = new TimedRun(this, SAMPLE_MIN, SAMPLE_PCT_PER_MIN, () => {
      this.samplesCollected++;
      this.activity = `sample stowed (${site.id})`;
      return { type: 'done', note: `sample collected at ${site.id}` };
    });
    return { type: 'started', run, note: `${SAMPLE_MIN} min` };
  }

  // --- sensing and limits ----------------------------------------------------

  private senseAhead(label: string): ConditionEvent | null {
    for (let i = 0; i < Math.min(SENSE_RANGE_CELLS, this.path.length); i++) {
      const cell = this.path[i];
      const idx = cellIndex(this.map, cell);
      if (!this.hidden.has(idx) && !this.discoveredCells.has(idx)) continue;
      if (!this.discoveredCells.has(idx)) {
        this.discoveredCells.add(idx);
        this.discovered.push({ ...cell });
      }
      return {
        type: 'condition',
        condition: 'path_blocked',
        detail: `boulder ${i + 1} cell${i ? 's' : ''} ahead at (${cell.x}, ${cell.y}) on route to ${label}`,
      };
    }
    return null;
  }

  private siteInReach(step: PlanStep): Feature | StepStart {
    const siteId = String(step.args.site ?? '');
    const site = featureById(this.map, siteId);
    if (!site || chebyshev(site.pos, this.pos) > 1) {
      return { type: 'condition', condition: 'target_not_found', detail: `${siteId || 'site'} not within reach` };
    }
    return site;
  }

  private batteryCheck(cost: number, label: string, plan: Plan): StepStart | null {
    const floor = plan.limits.batteryFloorPct;
    if (this.batteryPct - cost >= floor) return null;
    return {
      type: 'condition',
      condition: 'battery_below_floor',
      detail: `${label} needs ${cost.toFixed(1)}%, would leave ${(this.batteryPct - cost).toFixed(1)}% (floor ${floor}%)`,
    };
  }

  /**
   * Every mapped no-go zone is enforced onboard, whether or not the plan lists it:
   * the onboard limit can be stricter than the plan, never looser.
   */
  private noGoZoneAt(p: Vec): string | null {
    return zoneAt(this.map, p)?.id ?? null;
  }

  private planPath(to: Vec): Vec[] | null {
    return findPath(this.map, this.pos, to, (p) => {
      if (cellAt(this.map, p) === 'rock') return true;
      if (this.discoveredCells.has(cellIndex(this.map, p))) return true;
      return this.noGoZoneAt(p) !== null;
    });
  }

  private noteWaypoint(): void {
    const wp = this.map.features.find((f) => f.kind === 'waypoint' && samePos(f.pos, this.pos));
    if (wp) this.lastSafeWaypoint = { id: wp.id, pos: { ...wp.pos } };
  }

  // --- escalation content ----------------------------------------------------

  private describeScene(siteId: string): EscalationPacket['scene'] {
    const site = this.mission.sites[siteId]?.scene;
    const groups = new Map<string, { d: number; kind: string; where: string; count: number }>();
    const r = 3;
    for (let y = this.pos.y - r; y <= this.pos.y + r; y++) {
      for (let x = this.pos.x - r; x <= this.pos.x + r; x++) {
        const p = { x, y };
        if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height || samePos(p, this.pos)) continue;
        const boulder = this.discoveredCells.has(cellIndex(this.map, p));
        if (!boulder && cellAt(this.map, p) !== 'rock') continue;
        const d = chebyshev(p, this.pos);
        const kind = boulder ? 'boulder' : 'rock';
        const where = `${d * CELL_METERS} m ${compass(this.pos, p)}`;
        const key = `${kind} ${where}`;
        const g = groups.get(key);
        if (g) g.count++;
        else groups.set(key, { d, kind, where, count: 1 });
      }
    }
    const nearby = [...groups.values()]
      .sort((a, b) => a.d - b.d)
      .map((g) => ({ text: g.count > 1 ? `${g.count} ${g.kind}s ${g.where}` : `${g.kind} ${g.where}` }));
    const sandNear = this.map.noGoZones.some(({ rect: z }) =>
      this.pos.x >= z.x - r && this.pos.x < z.x + z.w + r && this.pos.y >= z.y - r && this.pos.y < z.y + z.h + r,
    );
    return {
      objects: [...(site?.objects ?? []), ...nearby.slice(0, 4).map((n) => n.text)],
      slopeDeg: site?.slopeDeg ?? 4,
      terrain: site?.terrain ?? (sandNear ? 'packed regolith, sand nearby' : 'packed regolith'),
    };
  }

  private routeMinutes(to: Vec): number {
    return (this.planPath(to)?.length ?? 0) / ROVER_CELLS_PER_MIN;
  }

  private escalationOptions(
    step: PlanStep,
    condition: string | null,
  ): { options: Option[]; recommendation: string } {
    const back = this.lastSafeWaypoint;
    const opt = (id: string, intent: MarsOptionIntent, risk: Option['risk'], costMin: number): Option => ({
      id,
      label: optionLabel(intent),
      risk,
      costMin,
    });
    const returnOpt = (id: string) =>
      opt(id, { kind: 'return_to', waypoint: back.id }, 'low', this.routeMinutes(back.pos));

    if (condition === 'rock_too_hard') {
      const site = String(step.args.site ?? '');
      const alt = this.map.features
        .filter((f) => f.kind === 'target' && f.id !== site)
        .sort((a, b) => chebyshev(a.pos, this.pos) - chebyshev(b.pos, this.pos))[0];
      const drillMin = Number(step.args.depthCm ?? DEFAULT_DRILL_DEPTH_CM) / DRILL_CM_PER_MIN;
      const options: Option[] = [];
      if (alt) {
        options.push(opt('o1', { kind: 'alt_site', site: alt.id }, 'low', this.routeMinutes(alt.pos) + IMAGE_MIN + drillMin + SAMPLE_MIN));
      }
      options.push(
        opt('o2', { kind: 'surface_sample' }, 'low', SAMPLE_MIN),
        opt('o3', { kind: 'retry_drill' }, 'medium', drillMin + SAMPLE_MIN),
      );
      return { options, recommendation: options[0].id };
    }

    if (condition === null) {
      return {
        options: [
          opt('o1', { kind: 'approve_step', stepId: step.id, action: step.action }, 'medium', 0),
          opt('o2', { kind: 'skip_step', stepId: step.id }, 'low', 0),
          returnOpt('o3'),
        ],
        recommendation: 'o2',
      };
    }

    if (condition === 'battery_below_floor') {
      return {
        options: [returnOpt('o1'), opt('o2', { kind: 'recharge' }, 'low', 60)],
        recommendation: 'o1',
      };
    }

    return {
      options: [
        opt('o1', { kind: 'skip_step', stepId: step.id }, 'low', 0),
        returnOpt('o2'),
        opt('o3', { kind: 'hold_for_plan' }, 'low', 0),
      ],
      recommendation: 'o3',
    };
  }
}
