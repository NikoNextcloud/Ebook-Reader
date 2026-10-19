// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeNextcloudProblem } from '../src/services/nextcloudDiagnostics.js';
import { GET, HEAD } from '../api/nextcloud-stream.js';

const url = '/api/nextcloud-stream?path=book.mp3';
let fetchMock;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Safe Nextcloud playback messages', () => {
  it.each([
    ['NEXTCLOUD_INVALID_PATH', 'Невалиден път'],
    ['NEXTCLOUD_INVALID_RANGE', 'Невалиден диапазон'],
    ['NEXTCLOUD_NOT_CONFIGURED', 'не е настроен'],
    ['NEXTCLOUD_INVALID_CONFIG', 'невалидна'],
    ['NEXTCLOUD_CONNECTION_FAILED', 'установи връзка'],
    ['NEXTCLOUD_REDIRECT_BLOCKED', 'пренасочване'],
    ['NEXTCLOUD_REQUEST_ABORTED', 'прекратена'],
  ])('displays a fixed message for %s', async (error, text) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502, headers: { 'X-Nextcloud-Error': error } }));
    expect(await describeNextcloudProblem(url)).toContain(text);
    expect(fetchMock).toHaveBeenCalledWith(url, { method: 'HEAD', cache: 'no-store' });
  });
  it.each([401, 403, 404, 416, 429, 500, 502, 503])('displays provider status %i', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502, headers: {
      'X-Nextcloud-Error': 'NEXTCLOUD_UPSTREAM_HTTP_ERROR', 'X-Nextcloud-Upstream-Status': String(status),
    } }));
    expect(await describeNextcloudProblem(url)).toContain(status === 404 ? 'не е намерена' : `HTTP ${status}`);
  });
  it.each(['unknown', '__proto__', 'constructor', 'NEXTCLOUD_UPSTREAM_HTTP_ERROR'])('does not display untrusted diagnostic content: %s', async (error) => {
    fetchMock.mockResolvedValue(new Response('https://private.example/s/secret-token', { status: 502, headers: {
      'X-Nextcloud-Error': error, 'X-Nextcloud-Upstream-Status': 'private.example/secret-token',
    } }));
    expect(await describeNextcloudProblem(url)).toBe('Аудиото от Nextcloud е недостъпно (HTTP 502).');
  });
  it('sanitizes failed diagnostic requests', async () => {
    fetchMock.mockRejectedValue(new Error('https://private.example/s/secret-token'));
    expect(await describeNextcloudProblem(url)).toBe('Не може да се провери връзката с Nextcloud. Опитай отново по-късно.');
  });
  it('leaves successful audio diagnosis to the media player', async () => {
    fetchMock.mockResolvedValue(new Response(null));
    expect(await describeNextcloudProblem(url)).toBeNull();
  });
  it.each(['/api/mega-stream?url=book', 'blob:book', 'https://other.example/api/nextcloud-stream?path=book', undefined])(
    'does not probe other audio sources', async (source) => {
      expect(await describeNextcloudProblem(source)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('connects actual server diagnostics to safe player messages for GET and HEAD', async () => {
    vi.stubEnv('NEXTCLOUD_STORYTEL_SHARE_URL', 'https://private.example/s/secret-token');
    const upstreamFetch = vi.fn().mockRejectedValue(new Error('secret-token'));
    vi.stubGlobal('fetch', upstreamFetch);
    const get = await GET(new Request('https://app.test' + url));
    expect((await get.json()).error).toBe('NEXTCLOUD_CONNECTION_FAILED');
    const head = await HEAD(new Request('https://app.test' + url));
    fetchMock.mockResolvedValue(head);
    vi.stubGlobal('fetch', fetchMock);
    expect(await describeNextcloudProblem(url)).toBe('Не може да се установи връзка с Nextcloud. Опитай отново по-късно.');
  });
});
