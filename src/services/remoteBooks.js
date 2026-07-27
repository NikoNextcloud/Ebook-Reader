const DOCUMENT_RE = /\.(txt|md|markdown|rtf|html?|docx|pdf|epub)$/i;
const AUDIO_RE = /\.(m4b|m4a|mp3|aac)$/i;
const fourEtiCache = new Map();

export const MAX_IN_APP_AUDIO_BYTES = 220 * 1024 * 1024;

// Адрес, от който плеърът пуска аудиокнигата НА ПОТОК през нашия сървър.
// Така телефонът тегли само парчето, което свири, вместо целия файл —
// това е и решението за iPhone, където големите файлове задръстваха паметта.
export const audioStreamUrl = (url, name = '') => {
  const params = new URLSearchParams({ url });
  // Името е резервен ориентир, ако идентификаторът във връзката не съвпадне.
  if (name) params.set('name', name);
  return `/api/mega-stream?${params}`;
};

export const normalizeRemoteUrl = (value) => (
  /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
);

export const formatRemoteSize = (bytes = 0) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export const isMegaUrl = (value) => {
  try {
    return /(^|\.)mega\.nz$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const isFourEtiUrl = (value) => {
  try {
    return /(^|\.)4eti\.me$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const isYandexPublicUrl = (value) => {
  try {
    return /(^|\.)(yadi\.sk|disk\.yandex\.[a-z]+)$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
};

const supportedKind = (name = '') => {
  if (DOCUMENT_RE.test(name)) return 'document';
  if (AUDIO_RE.test(name)) return 'audio';
  return null;
};

const cleanLink = (value) => value.replace(/&amp;/g, '&').replace(/\\([()])/g, '$1');

export const extractDownloadLinks = (markdown) => {
  const result = [];
  const seen = new Set();
  const linkRe = /\[([^\]]+)\]\((https?:\/\/(?:\\.|[^)])+)\)/g;
  let match = linkRe.exec(markdown);

  while (match) {
    const label = match[1].trim();
    const url = cleanLink(match[2].trim());
    const directFile = supportedKind(new URL(url).pathname);
    const externalAction = /свали|download|прочети/i.test(label) && !isFourEtiUrl(url);
    const likelyDownload = externalAction || isMegaUrl(url) || isYandexPublicUrl(url) || directFile;

    if (likelyDownload && !seen.has(url)) {
      seen.add(url);
      result.push({ id: `source-${result.length}`, kind: 'source', name: label, url });
    }
    match = linkRe.exec(markdown);
  }

  return result;
};

export const extractFourEtiBookLinks = (markdown) => {
  const result = [];
  const seen = new Set();
  const headingLinkRe = /^#{2,6}\s+\[([^\]]+)\]\((https?:\/\/(?:www\.)?4eti\.me\/[^)\s]+)\)/gim;
  let match = headingLinkRe.exec(markdown);
  while (match) {
    const name = match[1].trim();
    const url = cleanLink(match[2].trim());
    if (!seen.has(url)) {
      seen.add(url);
      result.push({ id: `4eti-page-${result.length}`, kind: 'page', name, url });
    }
    match = headingLinkRe.exec(markdown);
  }
  return result;
};

export const extractFourEtiCategories = (markdown) => {
  const categories = [{ id: 'latest', name: 'Нови', url: 'https://4eti.me/' }];
  const seen = new Set(categories.map((item) => item.url));
  const categoryRe = /^\s*\*+\s+\[([^\]]+)\]\((https?:\/\/(?:www\.)?4eti\.me\/category\/[^)\s]+)\)\s*\((\d+)\)/gim;
  let match = categoryRe.exec(markdown);
  while (match) {
    const url = cleanLink(match[2].trim());
    if (!seen.has(url)) {
      seen.add(url);
      categories.push({
        id: `4eti-category-${categories.length}`,
        name: match[1].trim(),
        url,
        count: Number(match[3] || 0),
      });
    }
    match = categoryRe.exec(markdown);
  }
  return categories;
};

const fetchFourEtiMarkdown = async (url) => {
  if (!fourEtiCache.has(url)) {
    fourEtiCache.set(url, fetch(`https://r.jina.ai/${url}`).then(async (response) => {
      if (!response.ok) throw new Error(`4eti.me не отговори (HTTP ${response.status}).`);
      return response.text();
    }).catch((error) => {
      fourEtiCache.delete(url);
      throw error;
    }));
  }
  return fourEtiCache.get(url);
};

export const loadFourEtiLibrary = async (url = 'https://4eti.me/') => {
  const markdown = await fetchFourEtiMarkdown(url);
  const items = extractFourEtiBookLinks(markdown);
  if (!items.length) throw new Error('В тази категория не бяха намерени книги.');
  return {
    title: '4eti.me',
    items,
    categories: extractFourEtiCategories(markdown),
  };
};

export const discoverFourEtiPage = async (url) => {
  const markdown = await fetchFourEtiMarkdown(url);
  const title = markdown.match(/^Title:\s*(.+)$/m)?.[1]?.trim()
    || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || '4eti.me';
  const downloads = extractDownloadLinks(markdown);
  const items = downloads.length ? downloads : extractFourEtiBookLinks(markdown);
  if (!items.length) {
    throw new Error('Не е намерен публичен PDF/EPUB/DOCX линк. Постави адреса на конкретната книга, а не началната страница.');
  }
  return { title: downloads.length ? title : '4eti.me · книги', items };
};

const megaChildLink = (rootUrl, node) => {
  try {
    const parsed = new URL(rootUrl);
    const folderId = parsed.pathname.match(/\/folder\/([^/]+)/i)?.[1];
    const key = parsed.hash.slice(1).split('/')[0];
    const childId = Array.isArray(node.downloadId) ? node.downloadId.at(-1) : node.downloadId;
    if (folderId && key && childId) return `https://mega.nz/folder/${folderId}#${key}/file/${childId}`;
  } catch {
    // Връщаме оригиналния адрес.
  }
  return rootUrl;
};

const megaPath = (node, root) => {
  const parts = [node.name];
  let parent = node.parent;
  while (parent && parent !== root) {
    if (parent.name) parts.unshift(parent.name);
    parent = parent.parent;
  }
  return parts.join(' / ');
};

export const loadMegaCatalog = async (url) => {
  const { File: MegaFile } = await import('megajs');
  const root = MegaFile.fromURL(url);
  const selected = await root.loadAttributes();
  const nodes = selected.children
    ? selected.filter((node) => !node.children && supportedKind(node.name), true)
    : [selected].filter((node) => supportedKind(node.name));

  if (!nodes.length) throw new Error('В тази Mega връзка няма поддържани книги или аудиокниги.');

  const items = nodes.map((node, index) => {
    const path = megaPath(node, selected);
    return {
      id: `mega-${index}`,
      kind: supportedKind(node.name),
      name: node.name,
      path,
      category: path.includes(' / ') ? path.split(' / ')[0] : 'Други',
      size: node.size || 0,
      url: megaChildLink(url, node),
      provider: 'mega',
      _node: node,
    };
  });
  const categories = [...new Set(items.map((item) => item.category))]
    .sort((a, b) => a.localeCompare(b, 'bg'))
    .map((name, index) => ({
      id: `mega-category-${index}`,
      name,
      count: items.filter((item) => item.category === name).length,
    }));

  return { title: selected.name || 'Mega', items, categories };
};

const yandexApi = 'https://cloud-api.yandex.net/v1/disk/public/resources';

export const loadYandexCatalog = async (publicUrl) => {
  const response = await fetch(`${yandexApi}?limit=1000&public_key=${encodeURIComponent(publicUrl)}`);
  if (!response.ok) throw new Error(`Yandex Disk не отговори (HTTP ${response.status}).`);
  const metadata = await response.json();
  const nodes = metadata.type === 'dir' ? (metadata._embedded?.items || []) : [metadata];
  const items = nodes
    .filter((node) => node.type === 'file' && supportedKind(node.name))
    .map((node, index) => ({
      id: `yandex-${index}`,
      kind: supportedKind(node.name),
      name: node.name,
      path: metadata.type === 'dir' ? metadata.name : '',
      size: node.size || 0,
      url: node.file,
      provider: 'yandex',
    }));

  if (!items.length) throw new Error('В публичната Yandex папка няма поддържан PDF, EPUB или DOCX файл.');
  return { title: metadata.name || 'Yandex Disk', items };
};

export const loadDirectCatalog = async (url, label = '') => {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.split('/').pop() || label || 'Книга');
  const kind = supportedKind(name);
  if (!kind) throw new Error('Този линк не води към поддържан PDF, EPUB, DOCX или аудиофайл.');
  return {
    title: label || name,
    items: [{
      id: 'direct-0',
      kind,
      name,
      path: parsed.hostname,
      size: 0,
      url,
      provider: 'direct',
    }],
  };
};

export const openRemoteCatalog = async (url, label = '') => {
  if (isMegaUrl(url)) return loadMegaCatalog(url);
  if (isYandexPublicUrl(url)) return loadYandexCatalog(url);
  return loadDirectCatalog(url, label);
};

const downloadBuffer = async (node) => new Uint8Array(await node.downloadBuffer());

// Сваляне на глас/аудиокнига НА ЧАСТИ.
// Старият вариант държеше целия файл (често 200–600 MB) в паметта на страницата,
// което на iPhone надхвърля лимита на Safari и възпроизвеждането просто не тръгва.
// Тук периодично превръщаме натрупаните части в Blob — браузърът ги пази на диска,
// а паметта остава ниска. Така работят и големите книги, и имаме проценти.
const FLUSH_EVERY_BYTES = 8 * 1024 * 1024;

export const downloadNodeToBlob = async (node, { onProgress, type = 'audio/mp4' } = {}) => {
  const total = node.size || 0;
  const stream = typeof node.download === 'function' ? node.download({}) : null;

  // Ако стриймът не е наличен, връщаме се към стария начин (малки файлове).
  if (!stream || typeof stream.on !== 'function') {
    const bytes = await downloadBuffer(node);
    onProgress?.(100, total, total);
    return new Blob([bytes], { type });
  }

  return new Promise((resolve, reject) => {
    const parts = [];
    let buffered = [];
    let bufferedBytes = 0;
    let received = 0;

    const flush = () => {
      if (!buffered.length) return;
      parts.push(new Blob(buffered, { type }));
      buffered = [];
      bufferedBytes = 0;
    };

    stream.on('data', (chunk) => {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      buffered.push(bytes);
      bufferedBytes += bytes.byteLength;
      received += bytes.byteLength;
      if (bufferedBytes >= FLUSH_EVERY_BYTES) flush();
      if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)), received, total);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      try {
        flush();
        onProgress?.(100, received, total || received);
        resolve(new Blob(parts, { type }));
      } catch (error) {
        reject(error);
      }
    });
  });
};

const downloadMegaMetadata = async (node) => {
  const siblings = node.parent?.children || [];
  const metadataNode = siblings.find((item) => /^metadata\.json$/i.test(item.name || ''));
  const coverNode = siblings.find((item) => /\.(jpe?g|png|webp)$/i.test(item.name || ''));
  let metadata = null;
  let cover = null;

  if (metadataNode) {
    try {
      metadata = JSON.parse(new window.TextDecoder().decode(await downloadBuffer(metadataNode)));
    } catch {
      metadata = null;
    }
  }
  if (coverNode && coverNode.size < 5 * 1024 * 1024) {
    try {
      cover = new Blob([await downloadBuffer(coverNode)], {
        type: /\.png$/i.test(coverNode.name) ? 'image/png' : 'image/jpeg',
      });
    } catch {
      cover = null;
    }
  }
  return { metadata, cover };
};

export const downloadRemoteItem = async (item, onProgress) => {
  if (item.provider === 'mega') {
    const type = item.kind === 'audio' ? 'audio/mp4' : '';
    const blob = await downloadNodeToBlob(item._node, { onProgress, type });
    const file = new window.File([blob], item.name, { type });
    if (item.kind === 'audio') {
      const extras = await downloadMegaMetadata(item._node);
      return { file, ...extras };
    }
    return { file };
  }

  const requestUrl = item.provider === 'yandex'
    ? `/api/remote-file?url=${encodeURIComponent(item.url)}`
    : item.url;
  const response = await fetch(requestUrl);
  if (!response.ok) throw new Error(`Файлът не може да се свали (HTTP ${response.status}).`);

  // Четем на части, за да можем да покажем проценти и да не пълним паметта.
  const total = Number(response.headers.get('content-length') || item.size || 0);
  const type = item.kind === 'audio' ? 'audio/mp4' : '';
  let blob;

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const parts = [];
    let buffered = [];
    let bufferedBytes = 0;
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read(); // eslint-disable-line no-await-in-loop
      if (done) break;
      buffered.push(value);
      bufferedBytes += value.byteLength;
      received += value.byteLength;
      if (bufferedBytes >= FLUSH_EVERY_BYTES) {
        parts.push(new Blob(buffered, { type }));
        buffered = [];
        bufferedBytes = 0;
      }
      if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)), received, total);
    }
    if (buffered.length) parts.push(new Blob(buffered, { type }));
    blob = new Blob(parts, { type });
    onProgress?.(100, received, total || received);
  } else {
    blob = await response.blob();
    onProgress?.(100, blob.size, blob.size);
  }

  return {
    file: new window.File([blob], item.name, {
      type: blob.type || type,
    }),
  };
};
