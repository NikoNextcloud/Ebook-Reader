// Локална библиотека с книги и запазена позиция (localStorage, само на устройството).
const KEY = 'voxora_library';

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const write = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* localStorage може да е пълен или недостъпен */
  }
};

export const loadBooks = () => read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

export const makeTitle = (text, fallback = 'Без заглавие') => {
  const firstLine = (text || '').trim().split('\n').find((line) => line.trim());
  if (!firstLine) return fallback;
  const clean = firstLine.trim().replace(/\s+/g, ' ');
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
};

// Запазва (или обновява) книга. Дедупликира по идентичен текст, за да не трупа копия.
export const saveBook = ({ id, title, text, author, cover }) => {
  const clean = (text || '').trim();
  if (!clean) return null;

  const list = read();
  const existing = list.find((book) => book.id === id) || list.find((book) => book.text === clean);
  const record = existing || { id: id || `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, chunkIndex: 0 };

  record.title = title || record.title || makeTitle(clean);
  record.text = clean;
  record.words = clean.split(/\s+/).filter(Boolean).length;
  if (author !== undefined) record.author = author;
  if (cover !== undefined) record.cover = cover;
  record.updatedAt = Date.now();

  write([record, ...list.filter((book) => book.id !== record.id)]);
  return record;
};

// Задава произволно поле на книга (рейтинг, finished, favorite, cachedOffline…).
export const setBookField = (id, patch) => {
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book) return;
  Object.assign(book, patch);
  write(list);
};

export const updatePosition = (id, chunkIndex) => {
  if (!id) return;
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book) return;
  book.chunkIndex = Math.max(0, chunkIndex | 0);
  book.updatedAt = Date.now();
  write(list);
};

export const updateTitle = (id, title) => {
  const clean = (title || '').trim();
  if (!id || !clean) return;
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book) return;
  book.title = clean.length > 80 ? clean.slice(0, 80) : clean;
  book.updatedAt = Date.now();
  write(list);
};

export const removeBook = (id) => write(read().filter((book) => book.id !== id));

// ——— Отметки ———
export const addBookmark = (id, chunkIndex, label) => {
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book) return;
  book.bookmarks = book.bookmarks || [];
  if (book.bookmarks.some((mark) => mark.chunkIndex === chunkIndex)) return;
  book.bookmarks.push({ chunkIndex, label: label || `Част ${chunkIndex + 1}`, at: Date.now() });
  book.bookmarks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  write(list);
};

export const removeBookmark = (id, chunkIndex) => {
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book?.bookmarks) return;
  book.bookmarks = book.bookmarks.filter((mark) => mark.chunkIndex !== chunkIndex);
  write(list);
};

// ——— Резервно копие ———
export const exportLibrary = () => JSON.stringify(read(), null, 2);

export const importLibrary = (json) => {
  try {
    const incoming = JSON.parse(json);
    if (!Array.isArray(incoming)) return false;
    const list = read();
    const byId = new Map(list.map((book) => [book.id, book]));
    incoming.forEach((book) => {
      if (book?.id && book?.text) byId.set(book.id, { ...byId.get(book.id), ...book });
    });
    write([...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    return true;
  } catch {
    return false;
  }
};
