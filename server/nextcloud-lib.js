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
// Scan a bounded number of directories in each API request. The caller
// sends back the pending folders, allowing very large libraries to finish
// without hitting serverless time limits or the old 2500-folder ceiling.
export const scanAudioBooksPage = async (
  config, pending = [''], { listFolder = listDav, concurrency = 8, pageSize = 48 } = {},
) => {
  const queue = [...new Set(pending)];
  const count = Math.min(Math.max(1, Math.floor(pageSize)), 64, queue.length);
  const folders = queue.slice(0, count);
  const rest = queue.slice(count);
  const workers = Math.min(Math.max(1, Math.floor(concurrency)), 12, folders.length);
  const foundFolders = [];
  const foundAudio = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < folders.length) {
      const folder = folders[cursor++];
      const entries = await listFolder(config, folder);
      const prefix = folder ? folder + '/' : '';
      for (const entry of entries) {
        // Only accept immediate children; never trust unrelated DAV hrefs.
        if (!entry.path?.startsWith(prefix) || entry.path === folder) continue;
        const suffix = entry.path.slice(prefix.length);
        if (!suffix || suffix.includes('/')) continue;
        if (entry.directory) foundFolders.push(entry.path);
        else if (AUDIO_EXT.test(entry.name)) foundAudio.push(entry);
      }
    }
  }));
  const nextQueue = [...new Set([...rest, ...foundFolders])];
  const items = foundAudio.map((entry) => ({
    id: 'nc:' + entry.path,
    kind: 'audio',
    name: entry.name,
    path: entry.path,
    category: entry.path.includes('/') ? entry.path.split('/')[0] : 'Други',
    size: entry.size,
    url: '/api/nextcloud-stream?path=' + encodeURIComponent(entry.path),
    provider: 'nextcloud',
  }));
  items.sort((a, b) => a.path.localeCompare(b.path, 'bg'));
  return { title: 'Сторител Аудиокниги', items, nextQueue,
    scannedFolders: folders.length, done: nextQueue.length === 0 };
};

// Keep the full scanner available for tooling/tests, but the Vercel API uses
// scanAudioBooksPage so it never needs to traverse the entire tree at once.
export const listAudioBooks = async (config, options = {}) => {
  let pending = [''];
  const items = [];
  while (pending.length) {
    const page = await scanAudioBooksPage(config, pending, options);
    pending = page.nextQueue;
    items.push(...page.items);
  }
  items.sort((a, b) => a.path.localeCompare(b.path, 'bg'));
  return { title: 'Сторител Аудиокниги', items, categories: [] };
};
