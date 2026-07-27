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
export const saveBook = ({ id, title, text }) => {
  const clean = (text || '').trim();
  if (!clean) return null;

  const list = read();
  const existing = list.find((book) => book.id === id) || list.find((book) => book.text === clean);
  const record = existing || { id: id || `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, chunkIndex: 0 };

  record.title = title || record.title || makeTitle(clean);
  record.text = clean;
  record.words = clean.split(/\s+/).filter(Boolean).length;
  record.updatedAt = Date.now();

  write([record, ...list.filter((book) => book.id !== record.id)]);
  return record;
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
