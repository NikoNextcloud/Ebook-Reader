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

export async function GET(request) {
  const source = new URL(request.url).searchParams.get('url') || '';
  if (!isMegaUrl(source)) return new Response('Неподдържан източник.', { status: 400 });

  try {
    const { File: MegaFile } = await import('megajs');
    const file = MegaFile.fromURL(source);
    await file.loadAttributes();

    const size = file.size || 0;
    if (!size) return new Response('Файлът не е наличен.', { status: 404 });

    const range = parseRange(request.headers.get('range'), size);
    if (!range) {
      return new Response('Невалиден диапазон.', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const { start, end } = range;
    const stream = file.download({ start, end });
    const body = Readable.toWeb(stream);

    return new Response(body, {
      // Винаги 206 — така плеърът знае, че може да прескача напред/назад.
      status: 206,
      headers: {
        'Content-Type': contentTypeFor(file.name),
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
  const source = new URL(request.url).searchParams.get('url') || '';
  if (!isMegaUrl(source)) return new Response(null, { status: 400 });

  try {
    const { File: MegaFile } = await import('megajs');
    const file = MegaFile.fromURL(source);
    await file.loadAttributes();
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
