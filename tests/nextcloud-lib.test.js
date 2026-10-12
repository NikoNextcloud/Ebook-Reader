import { describe, expect, it } from 'vitest';
import { parseShare, safePath, extractDavEntries, listAudioBooks, scanAudioBooksPage } from '../server/nextcloud-lib.js';

describe('Nextcloud share WebDAV integration', () => {
  const share = 'https://server.example/index.php/s/qSrsNmZa7axxwF8';
  it('resolves the public DAV endpoint without exposing the token in the frontend', () => {
    const config = parseShare(share);
    expect(config.dav).toBe('https://server.example/public.php/dav/files/qSrsNmZa7axxwF8/');
  });
  it('rejects path traversal and encodes Cyrillic filenames', () => {
    expect(() => safePath('../secret.m4b')).toThrow();
    expect(() => safePath('folder/%2e%2e/file.mp3')).toThrow();
    expect(safePath('Романи/Книга.m4b')).toBe('%D0%A0%D0%BE%D0%BC%D0%B0%D0%BD%D0%B8/%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0.m4b');
  });
  it('parses DAV folders and audio sizes', () => {
    const xml = '<?xml version="1.0"?>' +
      '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/public.php/dav/files/qSrsNmZa7axxwF8/%D0%A0%D0%BE%D0%BC%D0%B0%D0%BD%D0%B8/</d:href>' +
      '<d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>' +
      '<d:response><d:href>/public.php/dav/files/qSrsNmZa7axxwF8/%D0%A0%D0%BE%D0%BC%D0%B0%D0%BD%D0%B8/book.m4b</d:href>' +
      '<d:propstat><d:prop><d:getcontentlength>12345</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>';
    const entries = extractDavEntries(xml, parseShare(share));
    expect(entries).toEqual([
      { path: 'Романи', name: 'Романи', directory: true, size: 0 },
      { path: 'Романи/book.m4b', name: 'book.m4b', directory: false, size: 12345 },
    ]);
  });
});


describe('Parallel WebDAV indexer', () => {
  it('fetches multiple folders concurrently and keeps a stable sorted index', async () => {
    const map = {
      '': Array.from({ length: 10 }, (_, i) => ({
        path: 'folder-' + i, name: 'folder-' + i, directory: true,
      })),
    };
    for (let i = 0; i < 10; i += 1) {
      map['folder-' + i] = [{
        path: 'folder-' + i + '/Книга ' + i + '.m4b',
        name: 'Книга ' + i + '.m4b', size: i + 10, directory: false,
      }];
    }
    let active = 0;
    let maxActive = 0;
    const listFolder = async (_config, folder) => {
      active += 1;
      maxActive = Math.max(active, maxActive);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return map[folder] || [];
    };
    const result = await listAudioBooks({}, { listFolder, concurrency: 3 });
    expect(maxActive).toBe(3);
    expect(result.items).toHaveLength(10);
    expect(result.items.map((x) => x.path)).toEqual(
      [...result.items.map((x) => x.path)].sort((a, b) => a.localeCompare(b, 'bg'))
    );
    expect(result.items[0].provider).toBe('nextcloud');
  });

  it('rejects a failing WebDAV folder rather than returning incomplete books', async () => {
    await expect(listAudioBooks({}, {
      listFolder: async () => { throw new Error('NEXTCLOUD_HTTP_503'); },
    })).rejects.toThrow('NEXTCLOUD_HTTP_503');
  });
});

describe('Paginated large Nextcloud catalog', () => {
  it('indexes well beyond the previous 2500-folder ceiling without losing entries', async () => {
    const directoryCount = 2600;
    const index = (folder) => folder === ''
      ? Array.from({ length: directoryCount }, (_, i) =>
          ({ path: 'folder-' + i, name: 'folder-' + i, directory: true }))
      : [{ path: folder + '/book.mp3', name: 'book.mp3',
          size: 100, directory: false }];
    let pending = [''];
    const paths = new Set();
    let rounds = 0;
    while (pending.length) {
      const page = await scanAudioBooksPage({}, pending, {
        listFolder: async (_, folder) => index(folder),
        pageSize: 48, concurrency: 8,
      });
      pending = page.nextQueue;
      page.items.forEach((item) => paths.add(item.path));
      rounds += 1;
      expect(rounds).toBeLessThan(100);
    }
    expect(paths.size).toBe(directoryCount);
  });

  it('returns partial results and a resumable folder queue', async () => {
    const data = {
      '': [
        { path: 'Романи', directory: true },
        { path: 'История', directory: true },
      ],
      'Романи': [{ path: 'Романи/Книга.m4b', name: 'Книга.m4b', size: 3 }],
      'История': [{ path: 'История/book.mp3', name: 'book.mp3', size: 2 }],
    };
    const fetchFolder = async (_, path) => data[path] || [];
    const first = await scanAudioBooksPage({}, [''], {
      listFolder: fetchFolder, pageSize: 1,
    });
    expect(first.items).toHaveLength(0);
    expect(first.nextQueue).toEqual(['Романи', 'История']);
    const second = await scanAudioBooksPage({}, first.nextQueue, {
      listFolder: fetchFolder, pageSize: 1,
    });
    expect(second.items).toHaveLength(1);
    expect(second.done).toBe(false);
    const third = await scanAudioBooksPage({}, second.nextQueue, {
      listFolder: fetchFolder, pageSize: 1,
    });
    expect(third.done).toBe(true);
    expect([second.items[0].id, third.items[0].id].every((id) => id.startsWith('nc:'))).toBe(true);
  });
});
