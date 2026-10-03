import demoPlanJson from './mars-demo.plan.json';
import unsafePlanJson from './mars-demo.unsafe.plan.json';

export interface BriefingFeature {
  id: string;
  kind: 'waypoint' | 'target';
  label: string;
  tag: string;
  pos: { x: number; y: number };
}

export interface BriefingZone {
  id: string;
  label: string;
  rect: { x: number; y: number; w: number; h: number };
}

/** Mission-wide hard limits. A plan's own limits may be stricter, never looser. */
export interface FlightRules {
  minBatteryFloorPct: number;
  noGoZones: string[];
}

/** What mission control knows before the mission: the orbital map, not the hidden surprises. */
export interface MissionBriefing {
  flightRules: FlightRules;
  id: string;
  roverStart: { x: number; y: number };
  features: BriefingFeature[];
  noGoZones: BriefingZone[];
  /** Orbital-imagery notes an operator would hand the planner. */
  notes: string[];
  /** What each action does onboard, in planner terms. */
  actionGuide: string[];
}

export const MARS_DEMO_BRIEFING: MissionBriefing = {
  id: 'mars-demo',
  flightRules: { minBatteryFloorPct: 20, noGoZones: ['sand-1'] },
  roverStart: { x: 2, y: 13 },
  features: [
    { id: 'wp-home', kind: 'waypoint', label: 'Landing site', tag: 'H', pos: { x: 2, y: 13 } },
    { id: 'wp-A', kind: 'waypoint', label: 'Approach to outcrop', tag: 'A', pos: { x: 16, y: 5 } },
    { id: 'wp-A-alt', kind: 'waypoint', label: 'Alternate approach', tag: "A'", pos: { x: 14, y: 9 } },
    { id: 'wp-B', kind: 'waypoint', label: 'West ridge', tag: 'B', pos: { x: 4, y: 3 } },
    { id: 'wp-C', kind: 'waypoint', label: 'South flats', tag: 'C', pos: { x: 19, y: 12 } },
    { id: 'outcrop-1', kind: 'target', label: 'Layered outcrop', tag: 'O1', pos: { x: 20, y: 2 } },
    { id: 'outcrop-2', kind: 'target', label: 'Secondary outcrop', tag: 'O2', pos: { x: 21, y: 6 } },
  ],
  noGoZones: [{ id: 'sand-1', label: 'Sand', rect: { x: 7, y: 5, w: 5, h: 5 } }],
  notes: [
    'outcrop-1 (layered outcrop, north-east) is the primary science target; outcrop-2 is a secondary outcrop nearby.',
    'The standard approach to outcrop-1 is via wp-A. Orbital imagery shows scattered boulders below resolution on the direct route from the landing site to wp-A.',
    'wp-A-alt is a vetted alternate approach if the route to wp-A is blocked; from there the rover can continue to outcrop-1.',
    'sand-1 is soft sand where the rover could get stuck.',
  ],
  actionGuide: [
    'drive_to {target}: drive to a waypoint or target id. The rover plans its own route around mapped rocks and listed no-go zones. Raises path_blocked if an unmapped obstacle blocks the route, battery_below_floor if the drive would breach the floor.',
    'image {target}: identify a target; the rover must be at or next to it (drive_to it first). Raises target_not_found, or confidence_below if identification is weak.',
    'drill {site, depthCm}: drill a core at a target; rover must be at the site; irreversible. Typical depth 5 cm. Raises rock_too_hard if the drill stalls.',
    'collect_sample {site}: cache the drilled or loose sample at a target; rover must be at the site; irreversible.',
    'hold {minutes}: wait in place.',
  ],
};

export const DEMO_INTENT = 'Sample the layered outcrop NE; avoid sand; keep battery above 30%';

/** Cached known-good plan: the compiler's fallback (Build decisions §4). */
export const CACHED_DEMO_PLAN: unknown = demoPlanJson;

/** The demo's one staged unsafe command (Build decisions §4): a rushed shortcut the validator must block. */
export const STAGED_UNSAFE_INTENT = 'Shortcut: go straight to outcrop-1 and drill now. Sand is fine, battery floor 10% is fine.';
export const STAGED_UNSAFE_PLAN: unknown = unsafePlanJson;
