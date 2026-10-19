// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD } from '../api/nextcloud-stream.js';
import { parseShare, scanAudioBooksPage } from '../server/nextcloud-lib.js';

const share = 'https://private.example/nextcloud/index.php/s/secret-token';
const request = (path = 'Романи/Книга.m4b', headers = {}, signal) => new Request(
  'https://app.test/api/nextcloud-stream?path=' + encodeURIComponent(path), { headers, signal },
);
let fetchMock;
beforeEach(() => {
  vi.stubEnv('NEXTCLOUD_STORYTEL_SHARE_URL', share);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const checkError = async (response, status, error, upstreamStatus) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('x-nextcloud-error')).toBe(error);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const details = await response.json();
  expect(details).toEqual({ error, message: expect.any(String), ...(upstreamStatus ? { upstreamStatus } : {}) });
  expect(response.headers.get('x-nextcloud-upstream-status')).toBe(upstreamStatus ? String(upstreamStatus) : null);
  const visible = JSON.stringify([...response.headers]) + JSON.stringify(details);
  for (const secret of ['private.example', 'secret-token', 'Authorization', 'Романи', 'upstream-secret']) {
    expect(visible).not.toContain(secret);
  }
  expect(visible).not.toContain(Buffer.from('secret-token:').toString('base64'));
};

describe('Nextcloud streaming diagnostics', () => {
  it.each(['', '../private.mp3', '%2e%2e/file.mp3', 'folder/%2Fbook.mp3', 'folder\\book.mp3', 'bad%ZZ.mp3', 'book.pdf', 'a\0.mp3', 'a'.repeat(1601) + '.mp3'])(
    'rejects an invalid path without contacting Nextcloud: %s', async (path) => {
      await checkError(await GET(request(path)), 400, 'NEXTCLOUD_INVALID_PATH');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(['bytes=-', 'items=0-1', 'bytes=0-1,4-5'])( 'rejects invalid ranges: %s', async (range) => {
    await checkError(await GET(request('book.mp3', { range })), 416, 'NEXTCLOUD_INVALID_RANGE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['', 'NEXTCLOUD_NOT_CONFIGURED'],
    ['https://private.example/not-a-share?upstream-secret', 'NEXTCLOUD_INVALID_CONFIG'],
  ])('distinguishes configuration errors', async (value, error) => {
    vi.stubEnv('NEXTCLOUD_STORYTEL_SHARE_URL', value);
    await checkError(await GET(request()), 503, error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sanitizes connection exceptions, including nested causes', async () => {
    fetchMock.mockRejectedValue(new Error(share + ' upstream-secret', { cause: new Error('Authorization: secret-token') }));
    await checkError(await GET(request()), 502, 'NEXTCLOUD_CONNECTION_FAILED');
  });
  it('distinguishes cancellation and forwards the request signal', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new Error('upstream-secret'));
    await checkError(await GET(request('book.mp3', {}, controller.signal)), 499, 'NEXTCLOUD_REQUEST_ABORTED');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each([301, 302, 303, 304, 307, 308])('blocks redirect %i without exposing its location', async (status) => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(status === 304 ? null : new ReadableStream({ cancel }), {
      status, headers: { Location: share, 'Set-Cookie': 'upstream-secret' },
    }));
    const res = await GET(request());
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    await checkError(res, 502, 'NEXTCLOUD_REDIRECT_BLOCKED', status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    if (status !== 304) expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404, 416, 429, 500, 502, 503])('identifies upstream HTTP %i without forwarding its body', async (status) => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      status, statusText: 'upstream-secret', headers: { 'WWW-Authenticate': share },
    }));
    const res = await GET(request());
    expect(res.headers.get('www-authenticate')).toBeNull();
    await checkError(res, [404, 416].includes(status) ? status : 502, 'NEXTCLOUD_UPSTREAM_HTTP_ERROR', status);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['bytes */12345', share])('only forwards a valid unsatisfied Content-Range', async (range) => {
    fetchMock.mockResolvedValue(new Response('upstream-secret', { status: 416, headers: { 'Content-Range': range } }));
    const res = await GET(request());
    expect(res.headers.get('content-range')).toBe(range.startsWith('bytes') ? range : null);
  });
  it.each([400, 502, 404])('HEAD error %i has diagnostics but no body', async (status) => {
    if (status !== 400) fetchMock.mockResolvedValue(new Response(null, { status }));
    const res = await HEAD(request(status === 400 ? '../book.mp3' : 'book.mp3'));
    expect(res.status).toBe(status);
    expect(res.headers.get('x-nextcloud-error')).toBeTruthy();
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
  });
});

describe('Nextcloud playback and paginated catalog compatibility', () => {
  it.each(['bytes=0-1', 'bytes=10-', 'bytes=-10'])('preserves partial audio and seeking: %s', async (range) => {
    fetchMock.mockResolvedValue(new Response('ab', { status: 206, headers: {
      'Content-Type': 'audio/mp4', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/100', 'Accept-Ranges': 'bytes',
    } }));
    const res = await GET(request(undefined, { range }));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-length')).toBe('2');
    expect(res.headers.get('content-range')).toBe('bytes 0-1/100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(await res.text()).toBe('ab');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(parseShare(share).dav + '%D0%A0%D0%BE%D0%BC%D0%B0%D0%BD%D0%B8/%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0.m4b');
    expect(options.method).toBe('GET');
    expect(options.headers.Range).toBe(range);
    expect(options.headers.Authorization).toBe('Basic ' + Buffer.from('secret-token:').toString('base64'));
  });
  it.each([['book.mp3', 'audio/mpeg'], ['book.aac', 'audio/aac'], ['book.M4B', 'audio/mp4'], ['book.m4a', 'audio/mp4']])(
    'keeps full streaming and MIME fallback for %s', async (path, type) => {
      let released = false;
      const body = new ReadableStream({ pull(controller) { if (released) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } } });
      fetchMock.mockResolvedValue(new Response(body));
      const res = await GET(request(path));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      // The handler returned before the body became available: no buffering.
      released = true;
      const reader = res.body.getReader();
      expect((await reader.read()).value).toEqual(new Uint8Array([1, 2]));
    },
  );
  it('preserves HEAD metadata without returning audio', async () => {
    fetchMock.mockResolvedValue(new Response(null, { headers: { 'Content-Length': '100' } }));
    const res = await HEAD(request());
    expect(fetchMock.mock.calls[0][1].method).toBe('HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.body).toBeNull();
  });
  it('streams URLs from consecutive catalog pages, including Cyrillic, spaces and percent encoding', async () => {
    const paths = ['Романи/Книга #1.m4b', 'История/Книга 100%25.mp3'];
    const listFolder = async (_, folder) => folder === ''
      ? ['Романи', 'История'].map((path) => ({ path, directory: true }))
      : paths.filter((path) => path.startsWith(folder + '/')).map((path) => ({ path, name: path.split('/').pop(), size: 2 }));
    let pending = [''];
    const items = [];
    while (pending.length) {
      const page = await scanAudioBooksPage(parseShare(share), pending, { listFolder, pageSize: 1 });
      items.push(...page.items);
      pending = page.nextQueue;
    }
    expect(items.map((item) => item.path)).toEqual(paths);
    for (const item of items) {
      fetchMock.mockResolvedValueOnce(new Response('ab'));
      const res = await GET(new Request('https://app.test' + item.url));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ab');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
