import { useMemo, useState } from 'react';
import {
  HardDrive,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
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
  books, stats, queue, onOpen, onNew, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove,
  onCoverChange, onOpenStorage, onOpenAdmin,
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [showFilters, setShowFilters] = useState(false);

  const categories = useMemo(() => [...new Set(
    books.map((book) => book.category || book.genre).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'bg')), [books]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('bg-BG');
    const matchesStatus = (book) => {
      if (statusFilter === 'progress') return inProgress(book);
      if (statusFilter === 'favorite') return !!book.favorite;
      if (statusFilter === 'offline') return !!(book.cachedOffline || book.audioCached);
      if (statusFilter === 'finished') return !!book.finished;
      return true;
    };
    const matchesMedia = (book) => (
      mediaFilter === 'all'
      || (mediaFilter === 'audio' ? book.mediaType === 'audio' : book.mediaType !== 'audio')
    );
    const matchesCategory = (book) => (
      categoryFilter === 'all' || (book.category || book.genre) === categoryFilter
    );
    const matchesQuery = (book) => !needle || [
      book.title,
      book.author,
      book.narrator,
      book.category,
      book.genre,
      book.series,
      book.year,
      book.source,
    ].filter(Boolean).join(' ').toLocaleLowerCase('bg-BG').includes(needle);

    return books
      .filter((book) => matchesStatus(book) && matchesMedia(book) && matchesCategory(book) && matchesQuery(book))
      .sort((a, b) => {
        if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '', 'bg');
        if (sortBy === 'author') return (a.author || '').localeCompare(b.author || '', 'bg');
        if (sortBy === 'progress') return progressOf(b) - progressOf(a);
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  }, [books, categoryFilter, mediaFilter, query, sortBy, statusFilter]);

  // Най-скорошната незавършена книга отива в голямата карта горе.
  const continueBook = useMemo(
    () => books.filter(inProgress).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null,
    [books],
  );

  const filtering = !!query.trim()
    || statusFilter !== 'all'
    || mediaFilter !== 'all'
    || categoryFilter !== 'all'
    || sortBy !== 'recent';
  const shelves = filtering
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
        <div className="home-actions">
          <button className="new-book" onClick={onNew}>
            <Plus aria-hidden="true" />
            Нов текст / книга
          </button>
        </div>
      </section>

      {!filtering && continueBook && (
        <ContinueCard
          book={continueBook}
          percent={progressOf(continueBook)}
          remaining={remainingOf(continueBook)}
          onResume={onOpen}
        />
      )}

      {books.length > 0 && (
        <section className="library-discovery" aria-label="Търсене и филтри">
          <div className="library-search-row">
            <label className="library-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="Заглавие, автор, жанр…"
                aria-label="Търси в библиотеката"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Изчисти търсенето">
                  <X aria-hidden="true" />
                </button>
              )}
            </label>
            <button
              className={`library-filter-toggle ${showFilters || filtering ? 'on' : ''}`}
              onClick={() => setShowFilters((value) => !value)}
              aria-label="Филтри"
              aria-expanded={showFilters}
            >
              <SlidersHorizontal aria-hidden="true" />
            </button>
          </div>

          {categories.length > 0 && (
            <div className="library-category-tabs">
              <button className={categoryFilter === 'all' ? 'on' : ''} onClick={() => setCategoryFilter('all')}>Всички</button>
              {categories.map((category) => (
                <button
                  key={category}
                  className={categoryFilter === category ? 'on' : ''}
                  onClick={() => setCategoryFilter(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          )}

          {showFilters && (
            <div className="library-filter-panel">
              <div className="library-segments" aria-label="Статус">
                {[
                  ['all', 'Всички'],
                  ['progress', 'Започнати'],
                  ['favorite', 'Любими'],
                  ['offline', 'Офлайн'],
                  ['finished', 'Завършени'],
                ].map(([value, label]) => (
                  <button key={value} className={statusFilter === value ? 'on' : ''} onClick={() => setStatusFilter(value)}>{label}</button>
                ))}
              </div>
              <div className="library-filter-selects">
                <label>
                  <span>Формат</span>
                  <select value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value)}>
                    <option value="all">Всички</option>
                    <option value="audio">Аудиокниги</option>
                    <option value="text">Текстови книги</option>
                  </select>
                </label>
                <label>
                  <span>Подреди</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                    <option value="recent">Последно отваряни</option>
                    <option value="title">По заглавие</option>
                    <option value="author">По автор</option>
                    <option value="progress">По прогрес</option>
                  </select>
                </label>
              </div>
              {filtering && (
                <button className="library-clear-filters" onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setMediaFilter('all');
                  setCategoryFilter('all');
                  setSortBy('recent');
                }}>
                  <X aria-hidden="true" /> Изчисти
                </button>
              )}
            </div>
          )}
        </section>
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
          <button className="new-book" onClick={onNew}><Plus aria-hidden="true" /> Добави първата си книга</button>
        </div>
      ) : filtering && !filtered.length ? (
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

      <footer className="home-footer-tools">
        <span>VOXORA · ИНСТРУМЕНТИ</span>
        <nav aria-label="Инструменти на библиотеката">
          <button className="home-storage" onClick={onOpenStorage}>
            <HardDrive aria-hidden="true" />
            Памет
          </button>
          <button className="home-admin" onClick={onOpenAdmin}>
            <ShieldCheck aria-hidden="true" />
            Админ
          </button>
        </nav>
      </footer>
    </div>
  );
}
