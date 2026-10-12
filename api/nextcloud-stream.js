import { parseShare, safePath, davUrl, davHeaders } from '../server/nextcloud-lib.js';
const typeFor = (path) => /\.mp3$/i.test(path) ? 'audio/mpeg' : /\.aac$/i.test(path) ? 'audio/aac' : 'audio/mp4';
const proxy = async (request, method) => {
  let path;
  try { path = new URL(request.url).searchParams.get('path') || ''; safePath(path); } catch { return new Response('Invalid path', { status: 400 }); }
  if (!path || !/\.(m4b|m4a|mp3|aac)$/i.test(path)) return new Response('Invalid audio path', { status: 400 });
  try {
    if (!process.env.NEXTCLOUD_STORYTEL_SHARE_URL) return new Response('Nextcloud not configured', { status: 503 });
    const config = parseShare(process.env.NEXTCLOUD_STORYTEL_SHARE_URL);
    const requestedRange = request.headers.get('range');
    if (requestedRange && !/^bytes=\d*-\d*$/.test(requestedRange)) return new Response('Invalid range', { status: 416 });
    const headers = davHeaders(config, requestedRange ? { Range: requestedRange } : {});
    const upstream = await fetch(davUrl(config, path), { method, headers, signal: request.signal, redirect: 'manual' });
    if (upstream.status >= 300 && upstream.status < 400) return new Response('Nextcloud redirect not allowed', { status: 502 });
    if (!upstream.ok) return new Response('Nextcloud audio unavailable', { status: upstream.status === 404 ? 404 : 502 });
    const responseHeaders = new Headers({
      'Content-Type': upstream.headers.get('content-type') || typeFor(path),
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const h of ['content-length', 'content-range']) {
      if (upstream.headers.has(h)) responseHeaders.set(h, upstream.headers.get(h));
    }
    return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response('Nextcloud connection unavailable', { status: 502 });
  }
};
export const GET = (request) => proxy(request, 'GET');
export const HEAD = (request) => proxy(request, 'HEAD');
