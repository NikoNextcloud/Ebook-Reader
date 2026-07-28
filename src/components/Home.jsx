import { useMemo, useState } from 'react';
import BookCard from './BookCard';
import ContinueCard from './ContinueCard';
import { formatDuration } from '../services/cover';

const estimateChunks = (book) => Math.max(1, Math.ceil((book.text?.length || 0) / 2200));

const progressOf = (book) => {
  if (book.mediaType === 'audio') return book.progressPercent || 0;
  return Math.min(100, Math.round((book.chunkIndex / estimateChunks(book)) * 100));
};

// Приблизително оставащо време в секунди (за аудиокниги е точно).
const remainingOf = (book) => {
  if (book.mediaType === 'audio') {
    return Math.max(0, (book.audioDuration || 0) - (book.audioPosition || 0));
  }
  const totalSeconds = ((book.words || 0) / 165) * 60;
  return Math.max(0, Math.round(totalSeconds * (1 - progressOf(book) / 100)));
};

const inProgress = (book) => (book.chunkIndex > 0 || book.audioPosition > 0) && !book.finished;

export default function Home({
  books, stats, queue, onOpen, onNew, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove, onCoverChange,
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return books;
    return books.filter((book) => (
      `${book.title} ${book.author || ''} ${book.narrator || ''}`.toLowerCase().includes(needle)
    ));
  }, [books, query]);

  // Най-скорошната незавършена книга отива в голямата карта горе.
  const continueBook = useMemo(
    () => books.filter(inProgress).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null,
    [books],
  );

  const searching = !!query.trim();
  const shelves = searching
    ? [['Резултати', filtered]]
    : [
      ['Продължи да слушаш', filtered.filter((b) => inProgress(b) && b.id !== continueBook?.id)],
      ['Любими', filtered.filter((b) => b.favorite)],
      ['Свалени офлайн', filtered.filter((b) => b.cachedOffline || b.audioCached)],
      ['Завършени', filtered.filter((b) => b.finished)],
      ['Всички книги', filtered],
    ].filter(([, list]) => list.length);

  const cardProps = {
    onOpen, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove, onCoverChange,
  };

  return (
    <div className="home">
      <section className="home-hero">
        <div>
          <span className="eyebrow coral">ТВОЯТА БИБЛИОТЕКА</span>
          <h1>Слушай на своя ритъм.</h1>
        </div>
        <button className="new-book" onClick={onNew}>＋ Нов текст / книга</button>
      </section>

      {!searching && continueBook && (
        <ContinueCard
          book={continueBook}
          percent={progressOf(continueBook)}
          remaining={remainingOf(continueBook)}
          onResume={onOpen}
        />
      )}

      {books.length > 3 && (
        <input
          className="library-search"
          type="search"
          value={query}
          placeholder="Търси по заглавие или автор…"
          aria-label="Търси в библиотеката"
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      {/* На телефон показваме само двете важни числа (виж CSS). */}
      <div className="stats-bar">
        <div className="stat"><b>{formatDuration(stats.total)}</b><small>общо слушане</small></div>
        <div className="stat"><b>{stats.streak} 🔥</b><small>дни поред</small></div>
        <div className="stat secondary"><b>{formatDuration(stats.week)}</b><small>тази седмица</small></div>
        <div className="stat secondary"><b>{books.length}</b><small>книги</small></div>
      </div>

      {queue.length > 0 && (
        <p className="queue-note">В опашката: {queue.length} {queue.length === 1 ? 'книга' : 'книги'} · ще се пуснат една след друга</p>
      )}

      {books.length === 0 ? (
        <div className="empty-lib">
          <p>Още няма книги. Добави текст, статия или качи файл, за да започнеш.</p>
          <button className="new-book" onClick={onNew}>＋ Добави първата си книга</button>
        </div>
      ) : searching && !filtered.length ? (
        <div className="empty-lib"><p>Нищо не съвпада с „{query}“.</p></div>
      ) : (
        shelves.map(([label, list]) => (
          <section key={label} className="shelf">
            <h2>{label}</h2>
            <div className="shelf-row">
              {list.map((book) => (
                <BookCard key={book.id} book={book} totalChunks={estimateChunks(book)} {...cardProps} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
