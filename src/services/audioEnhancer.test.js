import { describe, expect, it } from 'vitest';
import { resolveAudioProfile } from './audioEnhancer';

describe('audio profiles', () => {
  it('combines a preset with manual controls', () => {
    const profile = resolveAudioProfile({
      profile: 'clear',
      bass: 2,
      clarity: 1,
      normalize: true,
    });
    expect(profile.bass).toBe(1);
    expect(profile.presence).toBe(4.5);
    expect(profile.ratio).toBeGreaterThanOrEqual(4);
  });
});
