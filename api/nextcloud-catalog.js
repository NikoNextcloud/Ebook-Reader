import { parseShare, listAudioBooks } from '../server/nextcloud-lib.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
let savedCatalog = null;
let pendingCatalog = null;

export async function GET(request) {
  const configured = process.env.NEXTCLOUD_STORYTEL_SHARE_URL;
  if (!configured) {
    return Response.json({ error: 'NEXTCLOUD_NOT_CONFIGURED' }, { status: 503 });
  }
  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  const validCache = savedCatalog?.url === configured
    && Date.now() - savedCatalog.at < CACHE_TTL_MS;
  try {
    if (!refresh && validCache) {
      return Response.json(savedCatalog.catalog, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'X-Catalog-Cache': 'HIT' },
      });
    }
    // Request coalescing prevents the home shelf and catalog picker from
    // starting independent scans when both open at the same time.
    if (!pendingCatalog || pendingCatalog.url !== configured) {
      const requestPromise = listAudioBooks(parseShare(configured))
        .then((catalog) => {
          savedCatalog = { url: configured, catalog, at: Date.now() };
          return catalog;
        });
      pendingCatalog = { url: configured, promise: requestPromise };
      requestPromise.finally(() => {
        if (pendingCatalog?.promise === requestPromise) pendingCatalog = null;
      }).catch(() => {});
    }
    const catalog = await pendingCatalog.promise;
    return Response.json(catalog, {
      headers: { 'Cache-Control': refresh ? 'no-store'
        : 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Catalog-Cache': 'MISS' },
    });
  } catch (error) {
    // A temporary WebDAV outage should not erase a previously fetched index.
    if (savedCatalog?.url === configured && !refresh) {
      return Response.json({ ...savedCatalog.catalog, sourceUnavailable: true,
        sourceError: 'Nextcloud временно не отговаря.' },
        { headers: { 'Cache-Control': 'no-store', 'X-Catalog-Cache': 'STALE' } });
    }
    return Response.json({ error: error?.message || 'NEXTCLOUD_UNAVAILABLE' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
