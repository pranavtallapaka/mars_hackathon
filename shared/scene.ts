import type { Scene } from './plan';

export type SceneVariant = 'reconstruction' | 'frame';

/**
 * What a real camera frame would cost to downlink instead of the scene description:
 * an estimate for one compressed full-resolution rover camera frame.
 */
export const REAL_IMAGE_BYTES = 2_000_000;

export const RECONSTRUCTION_LABEL = 'AI reconstruction: illustrative only';

const encoder = new TextEncoder();

export function sceneBytes(scene: Scene): number {
  return encoder.encode(JSON.stringify(scene)).length;
}

export function formatDataBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} KB`;
  return `${n} B`;
}

/** Turns the rover's structured scene into an Imagine prompt. Deterministic, so it doubles as the cache key. */
export function scenePrompt(scene: Scene, variant: SceneVariant = 'reconstruction'): string {
  const objects = scene.objects.length ? scene.objects.join('; ') : 'open terrain, nothing notable';
  const facts = [
    `Visible: ${objects}.`,
    `Ground slope about ${scene.slopeDeg} degrees. Terrain: ${scene.terrain}.`,
  ].join(' ');
  if (variant === 'frame') {
    return [
      'Raw Navcam still from a Mars rover, wide angle, dust on the lens, mild JPEG compression.',
      facts,
      'Natural Martian daylight, ochre regolith. No rover hardware, no people, no text or labels.',
    ].join(' ');
  }
  return [
    "Photograph from a Mars rover's mast camera, about 2 m above the ground, looking ahead.",
    facts,
    'Natural Martian daylight, dusty ochre regolith, realistic engineering-camera look.',
    'No rover hardware, no people, no text or labels.',
  ].join(' ');
}

/** Short stable id for a scene + variant. Used as the cache filename. */
export function sceneKey(scene: Scene, variant: SceneVariant = 'reconstruction'): string {
  const input = `${variant}\n${scenePrompt(scene, variant)}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ReconstructionResult {
  id: string;
  /** Present when an image is available; served by our own API. */
  url?: string;
  source: 'grok' | 'cache' | 'unavailable';
  ms?: number;
  model: string;
  reason?: string;
}
