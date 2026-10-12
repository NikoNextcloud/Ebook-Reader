const AUDIO_EXT = /\.(m4b|m4a|mp3|aac)$/i;
const MAX_ITEMS = 15000;
const TIMEOUT_MS = 18000;
export const parseShare = (value = '') => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.pathname.match(/\/s\/([A-Za-z0-9_-]+)\/?$/)) throw new Error('INVALID_SHARE');
  const token = url.pathname.match(/\/s\/([A-Za-z0-9_-]+)\/?$/)[1];
  const base = url.pathname.slice(0, url.pathname.lastIndexOf('/s/')).replace(/\/$/, '');
  return { origin: url.origin, token, base, dav: url.origin + base + '/public.php/dav/files/' + token + '/' };
};
export const safePath = (value = '') => {
  if (typeof value !== 'string' || value.length > 1600 || value.includes('\\') || value.includes('\0')) throw new Error('INVALID_PATH');
  const parts = value.split('/').filter(Boolean).map((part) => {
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { throw new Error('INVALID_PATH'); }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) throw new Error('INVALID_PATH');
    return decoded;
  });
  return parts.map(encodeURIComponent).join('/');
};
export const davUrl = (config, path = '') => config.dav + safePath(path);
export const davHeaders = (config, extra = {}) => ({
  Authorization: 'Basic ' + Buffer.from(config.token + ':').toString('base64'),
  ...extra,
});
export const extractDavEntries = (xml, config) => {
  const result = [];
  const blocks = xml.match(/<(?:[A-Za-z_][\w.-]*:)?response\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?response>/gi) || [];
  const root = new URL(config.dav).pathname;
  for (const block of blocks) {
    const href = block.match(/<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/i)?.[1]?.trim();
    if (!href) continue;
    const text = href.replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    let url;
    try { url = new URL(text, config.origin); } catch { continue; }
    if (url.origin !== config.origin || !url.pathname.startsWith(root)) continue;
    const raw = url.pathname.slice(root.length);
    let path;
    try { path = decodeURIComponent(raw).replace(/\/$/, ''); safePath(path); } catch { continue; }
    if (!path) continue;
    const isDirectory = /<(?:[\w.-]+:)?collection\s*\/?\s*>/i.test(block);
    const size = Number(block.match(/<(?:[\w.-]+:)?getcontentlength\b[^>]*>(\d+)</i)?.[1] || 0);
    result.push({ path, name: path.split('/').pop(), directory: isDirectory, size });
  }
  return result;
};
export const listDav = async (config, folder = '') => {
  const target = davUrl(config, folder);
  const response = await fetch(target, {
    method: 'PROPFIND',
    headers: davHeaders(config, { Depth: '1', 'Content-Type': 'application/xml' }),
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('NEXTCLOUD_HTTP_' + response.status);
  return extractDavEntries(await response.text(), config);
};
export const listAudioBooks = async (config) => {
  const folders = [''];
  const items = [];
  const visited = new Set();
  while (folders.length) {
    const folder = folders.shift();
    if (visited.has(folder)) continue;
    visited.add(folder);
    if (visited.size > 2500) throw new Error('CATALOG_TOO_LARGE');
    const entries = await listDav(config, folder);
    for (const entry of entries) {
      if (entry.path === folder) continue;
      if (entry.directory) folders.push(entry.path);
      else if (AUDIO_EXT.test(entry.name)) {
        items.push({
          id: 'nc-' + items.length,
          kind: 'audio',
          name: entry.name,
          path: entry.path,
          category: entry.path.includes('/') ? entry.path.split('/')[0] : 'Други',
          size: entry.size,
          url: '/api/nextcloud-stream?path=' + encodeURIComponent(entry.path),
          provider: 'nextcloud',
        });
        if (items.length > MAX_ITEMS) throw new Error('CATALOG_TOO_LARGE');
      }
    }
  }
  return { title: 'Сторител Аудиокниги', items, categories: [] };
};
