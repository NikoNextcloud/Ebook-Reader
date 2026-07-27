/* global Response, URL, process */
import { Readable } from 'node:stream';

// Пуска аудиокнига от Mega директно на поток, с поддръжка на Range.
//
// Защо: досега целият файл (200–600 MB) се сваляше и разшифроваше в браузъра.
// На iPhone WebKit държи Blob-овете в паметта, затова свалянето блокираше
// след няколко мегабайта. Тук разшифроването е на сървъра, а браузърът си
// дърпа само парчето, което свири в момента — както при обикновен MP3 адрес.

export const MAX_WINDOW = 8 * 1024 * 1024; // едно извикване обслужва най-много 8 MB

export const isMegaUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && /(^|\.)mega\.nz$/i.test(parsed.hostname);
  } catch {
    return false;
  }
};

export const contentTypeFor = (name = '') => {
  if (/\.mp3$/i.test(name)) return 'audio/mpeg';
  if (/\.aac$/i.test(name)) return 'audio/aac';
  return 'audio/mp4'; // .m4b / .m4a
};

// „bytes=0-“ или „bytes=1000-2000“
export const parseRange = (header, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!match) return { start: 0, end: Math.min(size, MAX_WINDOW) - 1, partial: false };

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;

  if (!match[1] && match[2]) {
    // „bytes=-500“ = последните 500 байта
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start >= size) return null;

  end = Math.min(end, size - 1, start + MAX_WINDOW - 1);
  return { start, end, partial: true };
};

// Отварянето на Mega връзка изисква мрежова заявка. Пазим готовия файл за
// кратко, защото плеърът прави много Range заявки към един и същ адрес.
const fileCache = new Map();
const FILE_TTL = 10 * 60 * 1000;

// Връзките от папка изглеждат така: /folder/<id>#<ключ>/file/<childId>.
// Ако File.fromURL не се справи, отваряме папката и намираме детето.
const resolveMegaFile = async (url, wantedName = '') => {
  const cached = fileCache.get(url);
  if (cached && Date.now() - cached.at < FILE_TTL) return cached.file;

  const { File: MegaFile } = await import('megajs');
  let file = null;

  try {
    const direct = MegaFile.fromURL(url);
    await direct.loadAttributes();
    if (direct.size) file = direct;
  } catch {
    file = null;
  }

  if (!file) {
    const parsed = new URL(url);
    const childId = parsed.hash.match(/\/file\/([^/?#]+)/i)?.[1];
    const folderId = parsed.pathname.match(/\/folder\/([^/]+)/i)?.[1];
    const key = parsed.hash.slice(1).split('/')[0];
    if (!childId || !folderId || !key) throw new Error('UNSUPPORTED_LINK');

    const folder = MegaFile.fromURL(`https://mega.nz/folder/${folderId}#${key}`);
    await folder.loadAttributes();

    // Книгите са в ПОДПАПКИ (жанр / автор — заглавие / файл), затова обхождаме
    // цялото дърво. Търсенето само в най-горното ниво връщаше FILE_NOT_FOUND.
    const wanted = wantedName;
    let byName = null;

    const walk = (node) => {
      if (!node) return null;
      if (!node.children) {
        const id = Array.isArray(node.downloadId) ? node.downloadId.at(-1) : node.downloadId;
        if (id === childId) return node;
        if (wanted && node.name === wanted) byName = byName || node;
        return null;
      }
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };

    // Ако идентификаторът не съвпадне (напр. връзката е презаписана),
    // пробваме по име на файла, преди да се предадем.
    file = walk(folder) || byName;
    if (!file) throw new Error('FILE_NOT_FOUND');
  }

  fileCache.set(url, { file, at: Date.now() });
  return file;
};

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const source = params.get('url') || '';
  if (!isMegaUrl(source)) return new Response('Неподдържан източник.', { status: 400 });

  let file;
  try {
    file = await resolveMegaFile(source, params.get('name') || '');
  } catch (error) {
    // Ясна причина вместо мълчалив 502 — иначе плеърът показва подвеждащо
    // „телефонът блокира звука“, когато проблемът е в източника.
    return new Response(`Аудиото не може да се отвори: ${error.message || 'няма достъп'}`, { status: 502 });
  }

  const size = file.size || 0;
  if (!size) return new Response('Файлът не е наличен.', { status: 404 });

  const rangeHeader = request.headers.get('range');
  const type = contentTypeFor(file.name);

  // Без Range заглавие отговорът трябва да е 200 с пълната дължина. Safari е
  // строг: 206 на заявка без Range се смята за невалидна и медията не тръгва.
  if (!rangeHeader) {
    try {
      const body = Readable.toWeb(file.download({}));
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Аудиото не може да се пусне в момента.', { status: 502 });
    }
  }

  const range = parseRange(rangeHeader, size);
  if (!range) {
    return new Response('Невалиден диапазон.', {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    });
  }

  try {
    const { start, end } = range;
    const body = Readable.toWeb(file.download({ start, end }));

    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Аудиото не може да се пусне в момента.', { status: 502 });
  }
}

// Плеърът първо пита с HEAD за размера и дали се поддържа превъртане.
export async function HEAD(request) {
  const params = new URL(request.url).searchParams;
  const source = params.get('url') || '';
  if (!isMegaUrl(source)) return new Response(null, { status: 400 });

  try {
    const file = await resolveMegaFile(source, params.get('name') || '');
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(file.name),
        'Content-Length': String(file.size || 0),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
