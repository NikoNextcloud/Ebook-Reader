import { describe, expect, it } from 'vitest';
import { findMegaAudio, megaFolderUrl } from './megaFallback';

const source = 'https://mega.nz/folder/123#secret/file/a1';
const catalog = { items: [
  { kind: 'audio', name: 'book.m4b', url: source, _node: { size: 100 } },
  { kind: 'audio', name: 'book.m4b', url: 'https://mega.nz/folder/123#secret/file/b2', _node: { size: 200 } },
  { kind: 'document', name: 'book.pdf', url: 'https://mega.nz/folder/123#secret/file/c3', _node: {} },
] };

describe('browser-side MEGA fallback', () => {
  it('opens a nested file via the containing folder', () => {
    expect(megaFolderUrl(source)).toBe('https://mega.nz/folder/123#secret');
  });
  it('rejects non-HTTPS and unrelated domains', () => {
    expect(() => megaFolderUrl('http://mega.nz/folder/123#secret')).toThrow();
    expect(() => megaFolderUrl('https://evil.test/folder/123#secret')).toThrow();
  });
  it('uses the exact child ID instead of a duplicate filename', () => {
    expect(findMegaAudio(catalog, source, 'book.m4b')).toBe(catalog.items[0]);
    expect(findMegaAudio(catalog, 'https://mega.nz/folder/123#secret/file/missing', 'book.m4b')).toBeNull();
  });
});
