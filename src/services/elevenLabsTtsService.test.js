import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchElevenVoices } from './elevenLabsTtsService';

describe('fetchElevenVoices', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns voices from the protected server route', async () => {
    const voices = [{ id: 'voice-1', name: 'Milena', bulgarian: true }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ voices }),
    }));

    await expect(fetchElevenVoices()).resolves.toEqual({ voices, warning: '' });
    expect(fetch).toHaveBeenCalledWith('/api/eleven-voices', {
      headers: { Accept: 'application/json' },
    });
  });

  it('shows the server configuration error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Добави ELEVENLABS_API_KEY във Vercel.' }),
    }));

    await expect(fetchElevenVoices()).rejects.toThrow('ELEVENLABS_API_KEY');
  });

  it('returns fallback voices with a non-blocking warning', async () => {
    const voices = [{ id: 'fallback-1', name: 'Rachel', gender: 'female' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        limited: true,
        message: 'Използвам резервни гласове.',
        voices,
      }),
    }));

    await expect(fetchElevenVoices()).resolves.toEqual({
      voices,
      warning: 'Използвам резервни гласове.',
    });
  });
});
