import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadBooks, saveBook, updatePosition, updateTitle, removeBook,
  addBookmark, removeBookmark, exportLibrary, importLibrary,
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
});
