import { describe, expect, it } from 'vitest';
import { parseShare, safePath, extractDavEntries, listAudioBooks } from '../server/nextcloud-lib.js';

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
