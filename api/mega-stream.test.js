import { describe, it, expect } from 'vitest';
import { parseRange, isMegaUrl, contentTypeFor, MAX_WINDOW } from './mega-stream.js';

const SIZE = 250 * 1024 * 1024; // 250 MB аудиокнига

describe('isMegaUrl', () => {
  it('приема само https адреси на mega.nz', () => {
    expect(isMegaUrl('https://mega.nz/folder/abc#key/file/xyz')).toBe(true);
    expect(isMegaUrl('http://mega.nz/folder/abc')).toBe(false);
    expect(isMegaUrl('https://evil.com/?x=mega.nz')).toBe(false);
    expect(isMegaUrl('https://mega.nz.evil.com/a')).toBe(false);
    expect(isMegaUrl('')).toBe(false);
  });
});

describe('parseRange', () => {
  it('без Range връща първия прозорец', () => {
    const r = parseRange(null, SIZE);
    expect(r.start).toBe(0);
    expect(r.end).toBe(MAX_WINDOW - 1);
  });

  it('отворен диапазон се ограничава до един прозорец', () => {
    const r = parseRange('bytes=0-', SIZE);
    expect(r.start).toBe(0);
    expect(r.end).toBe(MAX_WINDOW - 1);
    expect(r.partial).toBe(true);
  });

  it('превъртане към средата на книгата', () => {
    const mid = 120 * 1024 * 1024;
    const r = parseRange(`bytes=${mid}-`, SIZE);
    expect(r.start).toBe(mid);
    expect(r.end).toBe(mid + MAX_WINDOW - 1);
  });

  it('точен диапазон се спазва, ако е в рамките на прозореца', () => {
    const r = parseRange('bytes=1000-2000', SIZE);
    expect(r.start).toBe(1000);
    expect(r.end).toBe(2000);
  });

  it('последните байтове (bytes=-N) — плеърът така чете индекса на m4b', () => {
    const r = parseRange('bytes=-65536', SIZE);
    expect(r.start).toBe(SIZE - 65536);
    expect(r.end).toBe(SIZE - 1);
  });

  it('никога не излиза извън файла', () => {
    const r = parseRange(`bytes=${SIZE - 10}-${SIZE + 5000}`, SIZE);
    expect(r.end).toBe(SIZE - 1);
  });

  it('невалиден начален байт се отхвърля (416)', () => {
    expect(parseRange(`bytes=${SIZE + 1}-`, SIZE)).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('разпознава форматите', () => {
    expect(contentTypeFor('book.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('book.m4b')).toBe('audio/mp4');
    expect(contentTypeFor('book.aac')).toBe('audio/aac');
  });
});
