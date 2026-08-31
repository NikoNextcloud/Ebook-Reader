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
