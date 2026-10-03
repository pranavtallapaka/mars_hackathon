import { describe, expect, it } from 'vitest';
import { formatDataBytes, REAL_IMAGE_BYTES, sceneBytes, sceneKey, scenePrompt } from '../../../shared/scene';
import type { Scene } from '../../../shared/plan';

const SCENE: Scene = {
  objects: ['layered outcrop face 1 m ahead', 'rock 2 m SE'],
  slopeDeg: 18,
  terrain: 'loose regolith right',
};

describe('scene reconstruction helpers', () => {
  it('the description is orders of magnitude smaller than a camera frame', () => {
    const n = sceneBytes(SCENE);
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(500);
    expect(REAL_IMAGE_BYTES / n).toBeGreaterThan(1000);
    expect(formatDataBytes(REAL_IMAGE_BYTES)).toBe('2.0 MB');
  });

  it('the Imagine prompt is deterministic and includes the structured facts', () => {
    expect(scenePrompt(SCENE)).toEqual(scenePrompt(SCENE));
    expect(scenePrompt(SCENE)).toContain('layered outcrop face 1 m ahead');
    expect(scenePrompt(SCENE)).toContain('18');
    expect(scenePrompt(SCENE)).toContain('loose regolith right');
    expect(sceneKey(SCENE)).toBe(sceneKey(SCENE));
    expect(sceneKey(SCENE, 'frame')).not.toBe(sceneKey(SCENE));
  });
});
