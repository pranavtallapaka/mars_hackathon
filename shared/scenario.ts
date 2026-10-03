type NonEmpty = readonly [string, ...string[]];

/**
 * Everything scenario-specific that the plan schema and executor need.
 * The engine reads enums from here, so a second scenario is a new config, not new engine code.
 */
export interface ScenarioDef {
  id: string;
  name: string;
  actions: NonEmpty;
  conditions: NonEmpty;
  whileWaitingTasks: NonEmpty;
  /** Treated as irreversible onboard even if a plan forgets to flag them. */
  irreversibleActions: readonly string[];
}

export const MARS_SURFACE = {
  id: 'mars-surface',
  name: 'Mars surface rover',
  actions: ['drive_to', 'image', 'collect_sample', 'drill', 'hold'],
  conditions: [
    'path_blocked',
    'rock_too_hard',
    'battery_below_floor',
    'hazard_detected',
    'target_not_found',
    'confidence_below',
  ],
  whileWaitingTasks: ['image_surroundings'],
  irreversibleActions: ['drill', 'collect_sample'],
} as const satisfies ScenarioDef;
