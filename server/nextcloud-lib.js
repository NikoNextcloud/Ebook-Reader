const AUDIO_EXT = /\.(m4b|m4a|mp3|aac)$/i;
const MAX_ITEMS = 15000;
const TIMEOUT_MS = 18000;
export const parseShare = (value = '') => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.pathname.match(/\/s\/([A-Za-z0-9_-]+)\/?$/)) throw new Error('INVALID_SHARE');
  const token = url.pathname.match(/\/s\/([A-Za-z0-9_-]+)\/?$/)[1];
  const base = url.pathname.slice(0, url.pathname.lastIndexOf('/s/')).replace(/\/index\.php$/, '').replace(/\/$/, '');
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
// Nextcloud normally supports Depth: 1, so the folder tree needs multiple
// PROPFIND calls. Run a small pool instead of waiting for each folder in series.
// Eight requests keeps latency low while avoiding uncontrolled fan-out on
// home-hosted Nextcloud instances.
export const listAudioBooks = async (
  config,
  { listFolder = listDav, concurrency = 8 } = {},
) => {
  const limit = Math.min(12, Math.max(1, Math.floor(concurrency) || 8));
  const pending = [''];
  const queued = new Set(['']);
  const discovered = [];
  let active = 0;
  let finished = false;

  await new Promise((resolve, reject) => {
    const fail = (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    };
    const pump = () => {
      if (finished) return;
      while (active < limit && pending.length > 0) {
        const folder = pending.shift();
        active += 1;
        Promise.resolve().then(() => listFolder(config, folder)).then((entries) => {
          if (finished) return;
          for (const entry of entries) {
            if (entry.path === folder) continue;
            if (entry.directory) {
              if (!queued.has(entry.path)) {
                queued.add(entry.path);
                if (queued.size > 2500) throw new Error('CATALOG_TOO_LARGE');
                pending.push(entry.path);
              }
            } else if (AUDIO_EXT.test(entry.name)) {
              discovered.push(entry);
              if (discovered.length > MAX_ITEMS) throw new Error('CATALOG_TOO_LARGE');
            }
          }
          active -= 1;
          pump();
        }).catch(fail);
      }
      if (!active && !pending.length && !finished) {
        finished = true;
        resolve();
      }
    };
    pump();
  });

  // Stable ordering and IDs preserve the position of books on refresh.
  discovered.sort((a, b) => a.path.localeCompare(b.path, 'bg'));
  const items = discovered.map((entry, index) => ({
    id: 'nc-' + index,
    kind: 'audio',
    name: entry.name,
    path: entry.path,
    category: entry.path.includes('/') ? entry.path.split('/')[0] : 'Други',
    size: entry.size,
    url: '/api/nextcloud-stream?path=' + encodeURIComponent(entry.path),
    provider: 'nextcloud',
  }));
  return { title: 'Сторител Аудиокниги', items, categories: [] };
};
