import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadBooks, saveBook, saveAudioBook, updatePosition, updateAudioPosition, updateTitle, removeBook,
  addBookmark, removeBookmark, addAudioBookmark, removeAudioBookmark, exportLibrary, importLibrary,
} from './library';

beforeEach(() => localStorage.clear());

describe('library', () => {
  it('запазва и зарежда книга', () => {
    const rec = saveBook({ title: 'Тест', text: 'Съдържание на книгата.' });
    expect(rec.id).toBeTruthy();
    expect(loadBooks()).toHaveLength(1);
  });

  it('дедупликира по идентичен текст', () => {
    saveBook({ title: 'A', text: 'един и същ текст' });
    saveBook({ title: 'B', text: 'един и същ текст' });
    expect(loadBooks()).toHaveLength(1);
  });

  it('пази позиция и заглавие', () => {
    const rec = saveBook({ title: 'Стар', text: 'нещо' });
    updatePosition(rec.id, 3);
    updateTitle(rec.id, 'Нов');
    const book = loadBooks()[0];
    expect(book.chunkIndex).toBe(3);
    expect(book.title).toBe('Нов');
  });

  it('добавя и маха отметки без дубли', () => {
    const rec = saveBook({ title: 'Отметки', text: 'текст' });
    addBookmark(rec.id, 2);
    addBookmark(rec.id, 2);
    expect(loadBooks()[0].bookmarks).toHaveLength(1);
    removeBookmark(rec.id, 2);
    expect(loadBooks()[0].bookmarks).toHaveLength(0);
  });

  it('експортира и импортира', () => {
    saveBook({ title: 'Експорт', text: 'данни за износ' });
    const json = exportLibrary();
    localStorage.clear();
    expect(importLibrary(json)).toBe(true);
    expect(loadBooks()).toHaveLength(1);
  });

  it('маха книга', () => {
    const rec = saveBook({ title: 'За триене', text: 'ще бъде изтрита' });
    removeBook(rec.id);
    expect(loadBooks()).toHaveLength(0);
  });

  it('пази позиция и отметки в аудиокнига', () => {
    const rec = saveAudioBook({
      title: 'Аудио тест',
      sourceUrl: 'https://mega.nz/file/test',
      remoteKey: 'mega:test',
      favorite: true,
      cover: 'data:image/jpeg;base64,cover',
      audioChapters: [{ title: 'Глава 1', start: 0, end: 60 }],
    });
    updateAudioPosition(rec.id, 90, 300);
    addAudioBookmark(rec.id, 75, 'Любим момент');

    let saved = loadBooks()[0];
    expect(saved.audioPosition).toBe(90);
    expect(saved.progressPercent).toBe(30);
    expect(saved.favorite).toBe(true);
    expect(saved.cover).toBe('data:image/jpeg;base64,cover');
    expect(saved.audioChapters).toEqual([{ title: 'Глава 1', start: 0, end: 60 }]);
    expect(saved.audioBookmarks).toHaveLength(1);

    removeAudioBookmark(rec.id, 75);
    saved = loadBooks()[0];
    expect(saved.audioBookmarks).toHaveLength(0);
  });
});
