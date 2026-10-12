import { parseShare, scanAudioBooksPage } from '../server/nextcloud-lib.js';

// A complete directory tree can contain thousands of subfolders. Each request
// scans only one batch; the browser carries the remaining queue to the next
// request. No database, cron task or additional Vercel function is needed.
const json = (value, status = 200) => Response.json(value, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

async function page(request, continuation = false) {
  const share = process.env.NEXTCLOUD_STORYTEL_SHARE_URL;
  if (!share) return json({ error: 'NEXTCLOUD_NOT_CONFIGURED' }, 503);
  try {
    let pending = [''];
    if (continuation) {
      const body = await request.json();
      if (!Array.isArray(body?.pending) || !body.pending.length
          || body.pending.length > 20000
          || body.pending.some((item) => typeof item !== 'string' || item.length > 1600)) {
        return json({ error: 'INVALID_CATALOG_CURSOR' }, 400);
      }
      pending = body.pending;
    }
    const config = parseShare(share);
    const catalog = await scanAudioBooksPage(config, pending);
    return json(catalog);
  } catch (error) {
    return json({ error: error?.message || 'NEXTCLOUD_UNAVAILABLE' }, 502);
  }
}

export const GET = (request) => page(request, false);
export const POST = (request) => page(request, true);
