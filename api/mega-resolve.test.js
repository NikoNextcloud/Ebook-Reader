import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

// Връзките от Mega папка са с вида /folder/<id>#<ключ>/file/<childId>.
// Ако File.fromURL не ги отваря, endpoint-ът трябва да отвори папката и да
// намери детето — иначе плеърът показва 0:00 и нищо не тръгва.
const SIZE = 120 * 1024 * 1024;
const fromUrlCalls = [];

vi.mock('megajs', () => ({
  File: {
    fromURL: (url) => {
      fromUrlCalls.push(url);
      if (url.includes('/file/')) {
        // директното отваряне на връзка от папка се проваля (както на живо)
        return { loadAttributes: async () => { throw new Error('not a file link'); } };
      }
      // Истинската структура: жанр / автор — заглавие / файл
      return {
        name: 'folder',
        loadAttributes: async () => {},
        children: [
          {
            name: 'Биографии',
            children: [
              {
                name: 'Ивайло Кунев — Забравените истории',
                children: [
                  { downloadId: ['AAA', 'other'], name: 'cover.jpg', size: 5, download: () => Readable.from([]) },
                  {
                    downloadId: ['AAA', 'child42'],
                    name: 'kniga.m4b',
                    size: SIZE,
                    download: ({ start, end }) => Readable.from([Buffer.alloc(end - start + 1, 3)]),
                  },
                ],
              },
            ],
          },
        ],
      };
    },
  },
}));

const { GET, HEAD } = await import('./mega-stream.js');
// Всеки тест ползва свой адрес, за да не му влияе кешът на другите.
let seq = 0;
const linkFor = () => { seq += 1; return `https://mega.nz/folder/AAA${seq}#thekey/file/child42`; };
const targetFor = (link) => `https://app.test/api/mega-stream?url=${encodeURIComponent(link)}`;

beforeEach(() => { fromUrlCalls.length = 0; });

describe('връзка към файл вътре в Mega папка', () => {
  it('намира правилното дете и връща неговия размер', async () => {
    const res = await HEAD(new Request(targetFor(linkFor())));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('content-type')).toBe('audio/mp4');
  });

  it('пробва директно, после отваря папката', async () => {
    const link = linkFor();
    await GET(new Request(targetFor(link), { headers: { range: 'bytes=0-99' } }));
    expect(fromUrlCalls[0]).toBe(link);
    expect(fromUrlCalls.some((u) => /\/folder\/AAA\d+#thekey$/.test(u))).toBe(true);
  });

  it('не отваря Mega наново при следващите Range заявки (кеш)', async () => {
    const link = linkFor();
    await GET(new Request(targetFor(link), { headers: { range: 'bytes=0-99' } }));
    const afterFirst = fromUrlCalls.length;
    await GET(new Request(targetFor(link), { headers: { range: 'bytes=100-199' } }));
    expect(fromUrlCalls.length).toBe(afterFirst);
  });

  it('сервира точния диапазон от намереното дете', async () => {
    const res = await GET(new Request(targetFor(linkFor()), { headers: { range: 'bytes=0-99' } }));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${SIZE}`);
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(100);
  });

  it('намира книгата по име, ако идентификаторът във връзката не съвпада', async () => {
    const stale = 'https://mega.nz/folder/AAA77#thekey/file/starId';
    const res = await GET(new Request(
      `https://app.test/api/mega-stream?url=${encodeURIComponent(stale)}&name=${encodeURIComponent('kniga.m4b')}`,
      { headers: { range: 'bytes=0-49' } },
    ));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-49/${SIZE}`);
  });

  it('връща разбираема грешка, ако детето липсва', async () => {
    const missing = 'https://mega.nz/folder/AAA99#thekey/file/nomatch';
    const res = await GET(new Request(`https://app.test/api/mega-stream?url=${encodeURIComponent(missing)}`));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('FILE_NOT_FOUND');
  });
});
