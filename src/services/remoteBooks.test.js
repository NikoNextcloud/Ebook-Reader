import { describe, expect, it } from 'vitest';
import {
  audioOnlyCatalog,
  extractDownloadLinks,
  extractFourEtiCategories,
  extractFourEtiBookLinks,
  formatRemoteSize,
  isFourEtiUrl,
  isMegaUrl,
  isYandexPublicUrl,
  normalizeRemoteUrl,
  STORYTEL_LIBRARY_URL,
  saveMegaCatalogSnapshot,
  readMegaCatalogSnapshot,
  getStorytelLibraryUrl,
  setStorytelLibraryUrl,
  isValidStorytelLibraryUrl,
} from './remoteBooks';

describe('remote book links', () => {
  it('recognizes supported providers', () => {
    expect(isMegaUrl('https://mega.nz/folder/example#key')).toBe(true);
    expect(isFourEtiUrl('https://4eti.me/book/')).toBe(true);
    expect(isYandexPublicUrl('https://yadi.sk/d/example')).toBe(true);
  });

  it('extracts visible download links and removes duplicates', () => {
    const markdown = [
      '[Начало](https://4eti.me/)',
      '[Прочети/Свали в PDF формат](https://yadi.sk/d/example)',
      '[Download](https://yadi.sk/d/example)',
      '[Mega](https://mega.nz/folder/example#key)',
    ].join('\n');
    expect(extractDownloadLinks(markdown).map((item) => item.url)).toEqual([
      'https://yadi.sk/d/example',
      'https://mega.nz/folder/example#key',
    ]);
  });

  it('extracts book pages from a 4eti.me catalog', () => {
    const markdown = [
      '#### [Първа книга – Автор](https://4eti.me/parva-kniga/)',
      'Текст за книгата.',
      '#### [Втора книга – Автор](https://4eti.me/vtora-kniga/)',
    ].join('\n');
    expect(extractFourEtiBookLinks(markdown).map((item) => item.name)).toEqual([
      'Първа книга – Автор',
      'Втора книга – Автор',
    ]);
  });

  it('extracts category tabs with counts', () => {
    const markdown = [
      '[Промо](https://4eti.me/category/football/)',
      '*   [Бестселър](https://4eti.me/category/bestseller/) (105)',
      '*   [История](https://4eti.me/category/istoria/) (91)',
    ].join('\n');
    expect(extractFourEtiCategories(markdown).map((item) => item.name)).toEqual([
      'Нови',
      'Бестселър',
      'История',
    ]);
  });

  it('normalizes addresses and formats file sizes', () => {
    expect(normalizeRemoteUrl('4eti.me/book')).toBe('https://4eti.me/book');
    expect(formatRemoteSize(748067)).toBe('731 KB');
    expect(formatRemoteSize(150 * 1024 * 1024)).toBe('150 MB');
  });

  it('preserves the catalog index without megajs node objects', () => {
    const store = new Map();
    const storage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
    };
    const folder = 'https://mega.nz/folder/abc#key';
    const item = {
      id: 'mega-0',
      kind: 'audio',
      name: 'book.m4b',
      category: 'Романи',
      provider: 'mega',
      url: 'https://mega.nz/folder/abc#key/file/child',
      size: 345,
      _node: { transient: true },
    };
    expect(saveMegaCatalogSnapshot(folder, { title: 'Storytel', items: [item] }, storage)).toBe(true);
    const cached = readMegaCatalogSnapshot(folder, storage);
    expect(cached.items[0].name).toBe('book.m4b');
    expect(cached.items[0]._node).toBeUndefined();
    expect(cached.categories[0].name).toBe('Романи');
    expect(readMegaCatalogSnapshot('https://mega.nz/folder/other#key', storage)).toBeNull();
  });

  it('ignores broken cache entries', () => {
    const storage = { getItem: () => '{broken json' };
    expect(readMegaCatalogSnapshot('https://mega.nz/folder/abc#key', storage)).toBeNull();
  });

  it('accepts complete public MEGA folder links and rejects unrelated hosts', () => {
    const url = 'https://mega.nz/folder/AbC123#sharedKey';
    expect(isValidStorytelLibraryUrl(url)).toBe(true);
    expect(isValidStorytelLibraryUrl('https://evil.test/folder/AbC123#sharedKey')).toBe(false);
    expect(isValidStorytelLibraryUrl('https://mega.nz/folder/AbC123')).toBe(false);
    expect(isValidStorytelLibraryUrl('http://mega.nz/folder/AbC123#sharedKey')).toBe(false);
  });

  it('keeps a verified source URL in browser storage', () => {
    const store = new Map();
    const storage = {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
    };
    const url = 'https://mega.nz/folder/AbC123#sharedKey';
    expect(setStorytelLibraryUrl(url, storage)).toBe(url);
    expect(getStorytelLibraryUrl(storage)).toBe(url);
    expect(() => setStorytelLibraryUrl('https://invalid.test', storage)).toThrow();
    expect(getStorytelLibraryUrl(storage)).toBe(url);
  });

  it('uses the current Storytel folder and hides non-audio helper files', () => {
    expect(STORYTEL_LIBRARY_URL).toContain('/folder/SWAVQIza#');
    const catalog = audioOnlyCatalog({
      title: 'Storytel',
      items: [
        { id: 'audio', kind: 'audio', category: 'Романи' },
        { id: 'info', kind: 'document', category: 'Други' },
      ],
    });

    expect(catalog.items.map((item) => item.id)).toEqual(['audio']);
    expect(catalog.categories).toEqual([
      { id: 'mega-audio-category-0', name: 'Романи', count: 1 },
    ]);
  });
});
