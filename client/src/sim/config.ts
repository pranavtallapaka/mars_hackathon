// 1 real second = 1 simulated minute (Build decisions §1).
export const SIM_MIN_PER_REAL_SEC = 1;

// Fixed sim step so runs are deterministic regardless of frame rate.
export const TICKS_PER_MIN = 10;

export const DEMO_SEED = 42;
export const DEFAULT_ONE_WAY_DELAY_MIN = 8;

export const TELEMETRY_PERIOD_MIN = 5;

// Same human think time on both panes, so only the system differs.
export const OPERATOR_DECISION_MIN = 5;

export const CELL_METERS = 2;
export const SENSE_RANGE_CELLS = 2;

export const ROVER_CELLS_PER_MIN = 1;
export const BATTERY_PCT_PER_CELL = 0.4;

export const IMAGE_MIN = 3;
export const IMAGE_PCT_PER_MIN = 0.1;
export const DEFAULT_IMAGE_CONFIDENCE = 0.9;

export const DRILL_CM_PER_MIN = 0.5;
export const DRILL_PCT_PER_MIN = 0.5;
export const DEFAULT_DRILL_DEPTH_CM = 5;

export const SAMPLE_MIN = 10;
export const SAMPLE_PCT_PER_MIN = 0.3;

export const DEFAULT_HOLD_MIN = 5;
export const WAIT_IMAGE_PERIOD_MIN = 5;
