import { parseShare, safePath, davUrl, davHeaders } from '../server/nextcloud-lib.js';

const typeFor = (path) => /\.mp3$/i.test(path) ? 'audio/mpeg' : /\.aac$/i.test(path) ? 'audio/aac' : 'audio/mp4';

// Only fixed messages and numeric statuses cross this boundary. Never return
// exception messages, DAV URLs, redirect locations or Nextcloud response bodies.
const failure = (method, status, error, message, upstreamStatus) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Nextcloud-Error': error,
  };
  if (upstreamStatus !== undefined) headers['X-Nextcloud-Upstream-Status'] = String(upstreamStatus);
  return new Response(method === 'HEAD' ? null : JSON.stringify({
    error, message, ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
  }), { status, headers });
};

// A rejected response must not leave an unused audio/error stream downloading.
const discard = (response) => { response.body?.cancel().catch(() => {}); };

const proxy = async (request, method) => {
  let path;
  try {
    path = new URL(request.url).searchParams.get('path') || '';
    safePath(path);
    if (!path || !/\.(m4b|m4a|mp3|aac)$/i.test(path)) throw new Error('INVALID_PATH');
  } catch {
    return failure(method, 400, 'NEXTCLOUD_INVALID_PATH', 'Невалиден път към аудиокнига. Избери книгата от каталога отново.');
  }
  const requestedRange = request.headers.get('range');
  if (requestedRange && (!/^bytes=\d*-\d*$/.test(requestedRange) || requestedRange === 'bytes=-')) {
    return failure(method, 416, 'NEXTCLOUD_INVALID_RANGE', 'Невалиден диапазон за аудиото.');
  }
  if (!process.env.NEXTCLOUD_STORYTEL_SHARE_URL) {
    return failure(method, 503, 'NEXTCLOUD_NOT_CONFIGURED', 'Източникът Nextcloud не е настроен.');
  }
  let target, headers;
  try {
    const config = parseShare(process.env.NEXTCLOUD_STORYTEL_SHARE_URL);
    target = davUrl(config, path);
    headers = davHeaders(config, requestedRange ? { Range: requestedRange } : {});
  } catch {
    return failure(method, 503, 'NEXTCLOUD_INVALID_CONFIG', 'Настройката на източника Nextcloud е невалидна.');
  }
  let upstream;
  try {
    upstream = await fetch(target, { method, headers, signal: request.signal, redirect: 'manual' });
  } catch {
    if (request.signal.aborted) {
      return failure(method, 499, 'NEXTCLOUD_REQUEST_ABORTED', 'Заявката за аудио е прекратена.');
    }
    return failure(method, 502, 'NEXTCLOUD_CONNECTION_FAILED', 'Не може да се установи връзка с Nextcloud. Опитай отново по-късно.');
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    discard(upstream);
    return failure(method, 502, 'NEXTCLOUD_REDIRECT_BLOCKED', 'Nextcloud върна пренасочване. Провери настройката на публичното споделяне.', upstream.status);
  }
  if (!upstream.ok) {
    discard(upstream);
    const status = [404, 416].includes(upstream.status) ? upstream.status : 502;
    const response = failure(method, status, 'NEXTCLOUD_UPSTREAM_HTTP_ERROR',
      upstream.status === 404
        ? 'Аудиокнигата не е намерена в Nextcloud. Обнови каталога.'
        : `Nextcloud отказа аудиото (HTTP ${upstream.status}).`, upstream.status);
    // Preserve the standard unsatisfied-range hint without forwarding arbitrary headers.
    const range = upstream.headers.get('content-range');
    if (upstream.status === 416 && /^bytes \*\/\d+$/.test(range || '')) response.headers.set('Content-Range', range);
    return response;
  }
  const responseHeaders = new Headers({
    'Content-Type': upstream.headers.get('content-type') || typeFor(path),
    'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const h of ['content-length', 'content-range']) {
    if (upstream.headers.has(h)) responseHeaders.set(h, upstream.headers.get(h));
  }
  if (method === 'HEAD') discard(upstream);
  return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
};
export const GET = (request) => proxy(request, 'GET');
export const HEAD = (request) => proxy(request, 'HEAD');
