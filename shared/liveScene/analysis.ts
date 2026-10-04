import { z } from 'zod';
import type { MissionBriefing } from '../missions/mars-demo';
import { createPlanSchema, type Plan } from '../plan';
import { MARS_SURFACE } from '../scenario';

export const GRID_WIDTH = 24;
export const GRID_HEIGHT = 16;

export const HAZARD_TYPES = ['rock', 'steep_slope', 'sand_soft_soil', 'drop_off', 'other'] as const;
export const TARGET_TYPES = ['outcrop', 'layered_rock', 'interesting_rock', 'other'] as const;
export const SEVERITIES = ['low', 'medium', 'high'] as const;

const bboxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  })
  .refine((b) => b.x + b.w <= 1.05 && b.y + b.h <= 1.05, 'bbox must stay in normalized image coordinates');

const routePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export type RoutePoint = z.infer<typeof routePointSchema>;

export const sceneAnalysisSchema = z.object({
  hazards: z.array(
    z.object({
      type: z.enum(HAZARD_TYPES),
      bbox: bboxSchema,
      severity: z.enum(SEVERITIES),
      reason: z.string().min(1),
    }),
  ),
  targets: z.array(
    z.object({
      type: z.enum(TARGET_TYPES),
      bbox: bboxSchema,
      reason: z.string().min(1),
    }),
  ),
  terrainSummary: z.string().min(1),
  confidence: z.enum(SEVERITIES),
  route: z.array(routePointSchema).optional(),
  altRoute: z.array(routePointSchema).optional(),
});

export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;
export type SceneBBox = z.infer<typeof bboxSchema>;

export const sceneAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hazards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: [...HAZARD_TYPES] },
          bbox: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              w: { type: 'number', minimum: 0, maximum: 1 },
              h: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['x', 'y', 'w', 'h'],
          },
          severity: { type: 'string', enum: [...SEVERITIES] },
          reason: { type: 'string' },
        },
        required: ['type', 'bbox', 'severity', 'reason'],
      },
    },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: [...TARGET_TYPES] },
          bbox: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              w: { type: 'number', minimum: 0, maximum: 1 },
              h: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['x', 'y', 'w', 'h'],
          },
          reason: { type: 'string' },
        },
        required: ['type', 'bbox', 'reason'],
      },
    },
    terrainSummary: { type: 'string' },
    confidence: { type: 'string', enum: [...SEVERITIES] },
    route: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['x', 'y'],
      },
    },
    altRoute: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['x', 'y'],
      },
    },
  },
  required: ['hazards', 'targets', 'terrainSummary', 'confidence'],
} as const;

const TARGET_RANK: Record<(typeof TARGET_TYPES)[number], number> = {
  layered_rock: 0,
  outcrop: 1,
  interesting_rock: 2,
  other: 3,
};

export function clampBBox(box: SceneBBox): SceneBBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  return { x, y, w: Math.min(1 - x, Math.max(0.02, box.w)), h: Math.min(1 - y, Math.max(0.02, box.h)) };
}

export function bboxCenterCell(box: SceneBBox, width = GRID_WIDTH, height = GRID_HEIGHT): { x: number; y: number } {
  const b = clampBBox(box);
  const x = Math.round((b.x + b.w / 2) * (width - 1));
  const y = Math.round((b.y + b.h / 2) * (height - 1));
  return { x: Math.min(width - 1, Math.max(0, x)), y: Math.min(height - 1, Math.max(0, y)) };
}

export function bboxRect(box: SceneBBox, width = GRID_WIDTH, height = GRID_HEIGHT): { x: number; y: number; w: number; h: number } {
  const b = clampBBox(box);
  const x0 = Math.max(0, Math.floor(b.x * width));
  const y0 = Math.max(0, Math.floor(b.y * height));
  const x1 = Math.min(width, Math.ceil((b.x + b.w) * width));
  const y1 = Math.min(height, Math.ceil((b.y + b.h) * height));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

export function pickBestTarget(analysis: SceneAnalysis): SceneAnalysis['targets'][number] | undefined {
  return [...analysis.targets].sort((a, b) => {
    const rank = TARGET_RANK[a.type] - TARGET_RANK[b.type];
    if (rank !== 0) return rank;
    return b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h;
  })[0];
}

export interface AnalysisBriefing {
  briefing: MissionBriefing;
  bestTargetId: string;
  altId: string;
}

function targetId(index: number, type: SceneAnalysis['targets'][number]['type']): string {
  if (type === 'layered_rock' || type === 'outcrop') return `outcrop-${index + 1}`;
  return `target-${index + 1}`;
}

export function briefingFromAnalysis(analysis: SceneAnalysis, imageId: string): AnalysisBriefing {
  const roverStart = { x: 12, y: 14 };
  const features: MissionBriefing['features'] = [
    { id: 'wp-home', kind: 'waypoint', label: 'Current rover pose', tag: 'H', pos: { ...roverStart } },
  ];
  const seen = new Set<string>(['12,14']);
  analysis.targets.forEach((target, i) => {
    let pos = bboxCenterCell(target.bbox);
    let key = `${pos.x},${pos.y}`;
    if (seen.has(key)) pos = { x: Math.min(GRID_WIDTH - 1, pos.x + 1), y: Math.max(0, pos.y - 1) };
    key = `${pos.x},${pos.y}`;
    seen.add(key);
    features.push({
      id: targetId(i, target.type),
      kind: 'target',
      label: target.type.replaceAll('_', ' '),
      tag: `T${i + 1}`,
      pos,
    });
  });

  const best = pickBestTarget(analysis);
  const bestTargetId = best ? targetId(analysis.targets.indexOf(best), best.type) : 'survey-1';
  if (!best) {
    features.push({ id: 'survey-1', kind: 'target', label: 'Forward survey point', tag: 'S', pos: { x: 12, y: 8 } });
    seen.add('12,8');
  }

  const bestPos = features.find((f) => f.id === bestTargetId)?.pos ?? { x: 12, y: 8 };
  const altPos = {
    x: Math.min(GRID_WIDTH - 1, Math.max(0, roverStart.x + (bestPos.x >= roverStart.x ? -4 : 4))),
    y: Math.min(GRID_HEIGHT - 1, Math.max(0, Math.round((roverStart.y + bestPos.y) / 2))),
  };
  if (altPos.x === bestPos.x && altPos.y === bestPos.y) altPos.x = Math.min(GRID_WIDTH - 1, altPos.x + 2);
  features.push({ id: 'wp-alt', kind: 'waypoint', label: 'Alternate approach', tag: "A'", pos: altPos });

  const noGoZones: MissionBriefing['noGoZones'] = [];
  let sand = 0;
  let drop = 0;
  let slope = 0;
  for (const hazard of analysis.hazards) {
    const isNoGo =
      (hazard.type === 'sand_soft_soil' && hazard.severity !== 'low') ||
      (hazard.type === 'drop_off' && hazard.severity !== 'low') ||
      (hazard.type === 'steep_slope' && hazard.severity !== 'low');
    if (!isNoGo) continue;
    const rect = bboxRect(hazard.bbox);
    const coversProtected = features.some(
      (f) => f.pos.x >= rect.x && f.pos.x < rect.x + rect.w && f.pos.y >= rect.y && f.pos.y < rect.y + rect.h,
    );
    if (coversProtected) continue;
    const prefix = hazard.type === 'sand_soft_soil' ? 'sand' : hazard.type === 'drop_off' ? 'drop' : 'slope';
    const n = prefix === 'sand' ? ++sand : prefix === 'drop' ? ++drop : ++slope;
    noGoZones.push({
      id: `${prefix}-${n}`,
      label: hazard.reason,
      rect,
    });
  }

  const hazardNotes = analysis.hazards.map((h) => `${h.type} (${h.severity}): ${h.reason}`);
  const targetNotes = analysis.targets.map((t, i) => `${targetId(i, t.type)} (${t.type}): ${t.reason}`);

  return {
    briefing: {
      id: `live-${imageId}`,
      flightRules: { minBatteryFloorPct: 20, noGoZones: noGoZones.map((z) => z.id) },
      roverStart,
      features,
      noGoZones,
      notes: [
        analysis.terrainSummary,
        `Vision confidence: ${analysis.confidence}.`,
        ...targetNotes,
        ...hazardNotes,
      ],
      actionGuide: [
        'drive_to {target}: drive to a waypoint or target id. Raises path_blocked if an unmapped obstacle blocks the route, battery_below_floor if the drive would breach the floor, hazard_detected if a new driving hazard appears.',
        'image {target}: identify a science target; the rover must be at or next to it. Raises target_not_found or confidence_below.',
        'hold {minutes}: wait in place.',
      ],
    },
    bestTargetId,
    altId: 'wp-alt',
  };
}

export function intentFromAnalysis(analysis: SceneAnalysis, bestTargetId: string): string {
  const avoid = analysis.hazards
    .filter((h) => h.type === 'sand_soft_soil' || h.type === 'drop_off' || h.severity === 'high')
    .map((h) => h.type.replaceAll('_', ' '));
  const avoidText = avoid.length ? ` Avoid ${[...new Set(avoid)].join(', ')}.` : '';
  return `Drive to ${bestTargetId} in this Navcam scene and image it.${avoidText} Keep battery above 30%. Do not drill.`;
}

export function planFromAnalysis(analysis: SceneAnalysis, imageId: string): Plan {
  const { briefing, bestTargetId, altId } = briefingFromAnalysis(analysis, imageId);
  const plan = {
    planId: `live-${imageId.slice(0, 12)}`,
    version: 1,
    intent: intentFromAnalysis(analysis, bestTargetId),
    limits: {
      batteryFloorPct: 30,
      noGoZones: briefing.noGoZones.map((z) => z.id),
      irreversibleNeedsApproval: true,
    },
    steps: [
      {
        id: 's1',
        action: 'drive_to' as const,
        args: { target: bestTargetId },
        branches: [
          { if: 'path_blocked' as const, then: `goto:s1b` },
          { if: 'hazard_detected' as const, then: 'escalate' },
          { if: 'battery_below_floor' as const, then: 'abort' },
        ],
      },
      {
        id: 's1b',
        action: 'drive_to' as const,
        args: { target: altId },
        branches: [
          { if: 'path_blocked' as const, then: 'escalate' },
          { if: 'hazard_detected' as const, then: 'escalate' },
          { if: 'battery_below_floor' as const, then: 'abort' },
        ],
      },
      {
        id: 's2',
        action: 'drive_to' as const,
        args: { target: bestTargetId },
        branches: [
          { if: 'path_blocked' as const, then: 'escalate' },
          { if: 'battery_below_floor' as const, then: 'abort' },
        ],
      },
      {
        id: 's3',
        action: 'image' as const,
        args: { target: bestTargetId },
        branches: [
          { if: 'target_not_found' as const, then: 'escalate' },
          { if: 'confidence_below' as const, then: 'escalate' },
        ],
      },
    ],
    escalateWhen: ['no_branch_matches', 'confidence_below:0.6'],
    abort: { behavior: 'stop_and_return' as const, to: 'last_safe_waypoint' },
    whileWaiting: ['image_surroundings' as const],
  };
  return createPlanSchema(MARS_SURFACE).parse(plan);
}

export function parseSceneAnalysis(raw: string): { analysis: SceneAnalysis | null; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { analysis: null, errors: ['response was not valid JSON'] };
  }
  const parsed = sceneAnalysisSchema.safeParse(json);
  if (!parsed.success) {
    return { analysis: null, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`) };
  }
  return { analysis: parsed.data, errors: [] };
}
