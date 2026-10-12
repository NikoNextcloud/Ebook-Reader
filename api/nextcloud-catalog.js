import { parseShare, listAudioBooks } from '../server/nextcloud-lib.js';
export async function GET() {
  try {
    const configured = process.env.NEXTCLOUD_STORYTEL_SHARE_URL;
    if (!configured) return new Response(JSON.stringify({ error: 'NEXTCLOUD_NOT_CONFIGURED' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    const catalog = await listAudioBooks(parseShare(configured));
    return Response.json(catalog, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } });
  } catch (error) {
    return Response.json({ error: error?.message || 'NEXTCLOUD_UNAVAILABLE' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
