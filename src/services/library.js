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

// Последната грешка при запис (напр. препълнена памет) — интерфейсът я показва.
let lastWriteError = '';
export const getLibraryWriteError = () => lastWriteError;
export const clearLibraryWriteError = () => { lastWriteError = ''; };

const persist = (list) => localStorage.setItem(KEY, JSON.stringify(list));

// Записва библиотеката. Ако паметта на браузъра е препълнена, освобождава
// място, вместо да се проваля мълчаливо и да губи позицията на слушане.
const write = (list) => {
  const capped = list.slice(0, 40);
  try {
    persist(capped);
    lastWriteError = '';
    return true;
  } catch {
    /* пробваме да освободим място по-долу */
  }

  // 1. Махаме текста на най-старите книги (той е най-обемен), но пазим
  //    заглавие, позиция и отметки, за да не изчезне книгата от рафта.
  const trimmed = capped.map((book) => ({ ...book }));
  for (let i = trimmed.length - 1; i > 0; i -= 1) {
    if (!trimmed[i].text && !trimmed[i].cover) continue;
    delete trimmed[i].cover;
    if (trimmed[i].text) {
      trimmed[i].textEvicted = true;
      trimmed[i].text = '';
    }
    try {
      persist(trimmed);
      lastWriteError = 'Паметта на браузъра беше пълна. Текстът на най-старите книги е освободен, за да се запази позицията ти.';
      return true;
    } catch {
      /* продължаваме да освобождаваме */
    }
  }

  // 2. Като последна мярка пазим само най-новите книги.
  for (let keep = Math.min(10, trimmed.length); keep >= 1; keep -= 1) {
    try {
      persist(trimmed.slice(0, keep));
      lastWriteError = 'Паметта на браузъра е пълна. Запазени са само последните книги — направи експорт на библиотеката.';
      return true;
    } catch {
      /* продължаваме */
    }
  }

  lastWriteError = 'Паметта на браузъра е пълна и промените не могат да се запазят. Изтрий книги или направи експорт.';
  return false;
};

export const loadBooks = () => read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

export const makeTitle = (text, fallback = 'Без заглавие') => {
  const firstLine = (text || '').trim().split('\n').find((line) => line.trim());
  if (!firstLine) return fallback;
  const clean = firstLine.trim().replace(/\s+/g, ' ');
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
};

// Запазва (или обновява) книга. Дедупликира по идентичен текст, за да не трупа копия.
export const saveBook = ({
  id, title, text, author, cover, favorite, source, sourceUrl, remoteKey,
}) => {
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
  if (favorite !== undefined) record.favorite = favorite;
  if (source !== undefined) record.source = source;
  if (sourceUrl !== undefined) record.sourceUrl = sourceUrl;
  if (remoteKey !== undefined) record.remoteKey = remoteKey;
  record.updatedAt = Date.now();

  write([record, ...list.filter((book) => book.id !== record.id)]);
  return record;
};

export const saveAudioBook = ({
  id, title, author, narrator, fileName, source, sourceUrl, remoteKey, category, favorite, cover,
}) => {
  if (!title) return null;
  const list = read();
  const existing = list.find((book) => book.id === id)
    || list.find((book) => remoteKey && book.remoteKey === remoteKey);
  const record = existing || {
    id: id || `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mediaType: 'audio',
    audioPosition: 0,
    audioDuration: 0,
    audioBookmarks: [],
  };

  Object.assign(record, {
    mediaType: 'audio',
    title,
    author: author || record.author || '',
    narrator: narrator || record.narrator || '',
    fileName: fileName || record.fileName || '',
    source: source || record.source || '',
    sourceUrl: sourceUrl || record.sourceUrl || '',
    remoteKey: remoteKey || record.remoteKey || '',
    category: category || record.category || '',
    updatedAt: Date.now(),
  });
  if (favorite !== undefined) record.favorite = favorite;
  if (cover !== undefined) record.cover = cover;
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

export const updateAudioPosition = (id, currentTime, duration = 0) => {
  if (!id) return;
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book) return;
  book.audioPosition = Math.max(0, Number(currentTime) || 0);
  book.audioDuration = Math.max(0, Number(duration) || book.audioDuration || 0);
  book.progressPercent = book.audioDuration
    ? Math.min(100, Math.round((book.audioPosition / book.audioDuration) * 100))
    : 0;
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

export const addAudioBookmark = (id, time, label) => {
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book) return;
  const seconds = Math.max(0, Math.round(Number(time) || 0));
  book.audioBookmarks = book.audioBookmarks || [];
  if (book.audioBookmarks.some((mark) => Math.abs(mark.time - seconds) < 2)) return;
  book.audioBookmarks.push({ time: seconds, label: label || `На ${seconds} сек.`, at: Date.now() });
  book.audioBookmarks.sort((a, b) => a.time - b.time);
  write(list);
};

export const removeAudioBookmark = (id, time) => {
  const list = read();
  const book = list.find((item) => item.id === id);
  if (!book?.audioBookmarks) return;
  book.audioBookmarks = book.audioBookmarks.filter((mark) => mark.time !== time);
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
      if (book?.id && (book?.text || (book.mediaType === 'audio' && book.sourceUrl))) {
        byId.set(book.id, { ...byId.get(book.id), ...book });
      }
    });
    write([...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    return true;
  } catch {
    return false;
  }
};
