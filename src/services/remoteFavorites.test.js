import { beforeEach, describe, expect, it } from 'vitest';
import { loadRemoteFavorites, remoteBookKey, setRemoteFavorite } from './remoteFavorites';

describe('remote favorites', () => {
  beforeEach(() => localStorage.clear());

  it('пази стабилен ключ за любима книга', () => {
    const key = remoteBookKey('4eti', { url: 'https://4eti.me/book/' });
    setRemoteFavorite(key, true);
    expect(loadRemoteFavorites().has(key)).toBe(true);

    setRemoteFavorite(key, false);
    expect(loadRemoteFavorites().has(key)).toBe(false);
  });
});
