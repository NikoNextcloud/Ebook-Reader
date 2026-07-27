import { beforeEach, describe, expect, it, vi } from 'vitest';

const idbGet = vi.fn();
const idbSet = vi.fn();
const idbDelete = vi.fn();

vi.mock('./idbCache', () => ({ idbDelete, idbGet, idbSet }));

describe('audiobook cache', () => {
  beforeEach(() => {
    idbGet.mockReset();
    idbSet.mockReset();
    idbDelete.mockReset();
  });

  it('stores an audio file under its stable remote key', async () => {
    const { cacheAudioBook } = await import('./audiobookCache');
    const file = new window.File(['audio'], 'book.m4b', { type: 'audio/mp4' });
    idbSet.mockResolvedValue(true);

    await expect(cacheAudioBook({
      remoteKey: 'mega:book-1',
      sourceUrl: 'https://mega.nz/file/book',
      file,
    })).resolves.toBe(true);
    expect(idbSet).toHaveBeenCalledWith(
      'remote-audiobook|mega:book-1',
      expect.objectContaining({ blob: file, name: 'book.m4b' }),
    );
  });

  it('restores a File that can be opened by the audio player', async () => {
    const { loadCachedAudioBook } = await import('./audiobookCache');
    idbGet.mockResolvedValue({
      blob: new Blob(['audio'], { type: 'audio/mp4' }),
      name: 'book.m4b',
      type: 'audio/mp4',
      metadata: { title: 'Book' },
    });

    const restored = await loadCachedAudioBook({ remoteKey: 'mega:book-1' });
    expect(restored.file).toBeInstanceOf(window.File);
    expect(restored.file.name).toBe('book.m4b');
    expect(restored.metadata.title).toBe('Book');
  });

  it('removes the cached file when the book is deleted', async () => {
    const { removeCachedAudioBook } = await import('./audiobookCache');
    await removeCachedAudioBook({ remoteKey: 'mega:book-1' });
    expect(idbDelete).toHaveBeenCalledWith('remote-audiobook|mega:book-1');
  });
});
