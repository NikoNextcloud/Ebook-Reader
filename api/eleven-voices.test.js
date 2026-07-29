import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './eleven-voices';

describe('GET /api/eleven-voices', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ELEVENLABS_API_KEY;
  });

  it('uses safe fallback voices when the key cannot read the voice list', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        detail: {
          code: 'missing_permissions',
          message: 'The API key is missing the permission voices_read.',
        },
      }),
    }));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.limited).toBe(true);
    expect(data.voices).toEqual(expect.arrayContaining([
      expect.objectContaining({ gender: 'female' }),
      expect.objectContaining({ gender: 'male' }),
    ]));
  });

  it('keeps invalid or expired keys as a configuration error', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"detail":"invalid_api_key"}',
    }));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.voices).toEqual([]);
  });
});
