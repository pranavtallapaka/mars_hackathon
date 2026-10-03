import type { FlightRules } from '../../../shared/missions/mars-demo';
import type { Plan } from '../../../shared/plan';
import {
  BATTERY_PCT_PER_CELL,
  DEFAULT_DRILL_DEPTH_CM,
  DEFAULT_HOLD_MIN,
  DRILL_CM_PER_MIN,
  DRILL_PCT_PER_MIN,
  IMAGE_MIN,
  IMAGE_PCT_PER_MIN,
  ROVER_CELLS_PER_MIN,
  SAMPLE_MIN,
  SAMPLE_PCT_PER_MIN,
} from './config';
import { describeStep } from './executor';
import { cellAt, cellIndex, featureById, findPath, zoneAt } from './grid';
import { nominalFlow } from './mars/amend';
import type { SimMap, Vec } from './types';

/** What the ground knows when it checks a plan: the rover's last reported state. */
export interface SafetyStart {
  pos: Vec;
  batteryPct: number;
  /** Obstacles the rover has reported; not on the orbital map. */
  knownObstacles: readonly Vec[];
}

export interface SafetyReport {
  ok: boolean;
  reasons: string[];
  /** Nominal-flow forecast on the ground's map; contingency steps aren't counted. */
  forecast: { endBatteryPct: number; minutes: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pre-uplink safety validator: a plan that breaches a hard limit never leaves Earth. */
export function checkPlanSafety(
  plan: Plan,
  map: SimMap,
  rules: FlightRules,
  start: SafetyStart,
  irreversibleActions: readonly string[],
): SafetyReport {
  const reasons: string[] = [];
  const { limits } = plan;

  if (limits.batteryFloorPct < rules.minBatteryFloorPct) {
    reasons.push(`Battery floor ${limits.batteryFloorPct}% is below the flight-rule minimum of ${rules.minBatteryFloorPct}%.`);
  }
  const dropped = rules.noGoZones.filter((z) => !limits.noGoZones.includes(z));
  if (!limits.irreversibleNeedsApproval) reasons.push('Plan turns off approval for irreversible actions.');
  for (const s of plan.steps) {
    const irreversible = s.irreversible || irreversibleActions.includes(s.action);
    if (irreversible && !s.approved) reasons.push(`${s.id} ${describeStep(s)} is irreversible but not approved.`);
  }

  const known = new Set(start.knownObstacles.map((p) => cellIndex(map, p)));
  const blocked = (p: Vec) => cellAt(map, p) === 'rock' || known.has(cellIndex(map, p)) || zoneAt(map, p) !== undefined;
  const crossings = new Map<string, string>();
  let pos = start.pos;
  let battery = start.batteryPct;
  let minutes = 0;
  let floorBreached = false;

  for (const step of nominalFlow(plan)) {
    switch (step.action) {
      case 'drive_to': {
        const target = featureById(map, String(step.args.target));
        if (!target) {
          reasons.push(`${step.id}: unknown target ${step.args.target}.`);
          break;
        }
        const zone = zoneAt(map, target.pos);
        if (zone) reasons.push(`${step.id} drives into no-go zone ${zone.id}.`);
        // The route a planner would take if the dropped zones really were allowed.
        const direct = findPath(map, pos, target.pos, (p) => cellAt(map, p) === 'rock' || known.has(cellIndex(map, p)));
        for (const p of direct ?? []) {
          const z = zoneAt(map, p);
          if (z && dropped.includes(z.id) && !crossings.has(z.id)) crossings.set(z.id, target.id);
        }
        const path = zone ? null : findPath(map, pos, target.pos, blocked);
        if (!path) {
          if (!zone) reasons.push(`${step.id}: no safe route to ${target.id} on the known map.`);
          break;
        }
        battery -= path.length * BATTERY_PCT_PER_CELL;
        minutes += path.length / ROVER_CELLS_PER_MIN;
        pos = target.pos;
        break;
      }
      case 'image':
        battery -= IMAGE_MIN * IMAGE_PCT_PER_MIN;
        minutes += IMAGE_MIN;
        break;
      case 'drill': {
        const drillMin = Number(step.args.depthCm ?? DEFAULT_DRILL_DEPTH_CM) / DRILL_CM_PER_MIN;
        battery -= drillMin * DRILL_PCT_PER_MIN;
        minutes += drillMin;
        break;
      }
      case 'collect_sample':
        battery -= SAMPLE_MIN * SAMPLE_PCT_PER_MIN;
        minutes += SAMPLE_MIN;
        break;
      case 'hold':
        minutes += Number(step.args.minutes ?? DEFAULT_HOLD_MIN);
        break;
    }
    if (!floorBreached && battery < limits.batteryFloorPct) {
      floorBreached = true;
      reasons.push(`Forecast: battery falls to ${round1(battery)}% during ${step.id}, below the ${limits.batteryFloorPct}% floor.`);
    }
  }

  for (const z of dropped) {
    const label = map.noGoZones.find((zone) => zone.id === z)?.label ?? z;
    const via = crossings.get(z);
    reasons.push(`Plan drops no-go zone ${z} (${label})${via ? `; the direct route to ${via} crosses it` : ''}.`);
  }

  return { ok: reasons.length === 0, reasons, forecast: { endBatteryPct: round1(battery), minutes: Math.round(minutes) } };
}
