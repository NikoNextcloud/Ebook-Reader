import BookCard from './BookCard';
import { formatDuration } from '../services/cover';

const estimateChunks = (book) => Math.max(1, Math.ceil((book.text?.length || 0) / 2200));

export default function Home({ books, stats, queue, onOpen, onNew, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove }) {
  const shelves = [
    ['Продължи да слушаш', books.filter((b) => b.chunkIndex > 0 && !b.finished)],
    ['Любими', books.filter((b) => b.favorite)],
    ['Свалени офлайн', books.filter((b) => b.cachedOffline)],
    ['Завършени', books.filter((b) => b.finished)],
    ['Всички книги', books],
  ].filter(([, list]) => list.length);

  const cardProps = { onOpen, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove };

  return (
    <div className="home">
      <section className="home-hero">
        <div>
          <span className="eyebrow coral">ТВОЯТА БИБЛИОТЕКА</span>
          <h1>Слушай на своя ритъм.</h1>
        </div>
        <button className="new-book" onClick={onNew}>＋ Нов текст / книга</button>
      </section>

      <div className="stats-bar">
        <div className="stat"><b>{formatDuration(stats.total)}</b><small>общо слушане</small></div>
        <div className="stat"><b>{formatDuration(stats.week)}</b><small>тази седмица</small></div>
        <div className="stat"><b>{stats.streak} 🔥</b><small>дни поред</small></div>
        <div className="stat"><b>{books.length}</b><small>книги</small></div>
      </div>

      {queue.length > 0 && (
        <p className="queue-note">В опашката: {queue.length} {queue.length === 1 ? 'книга' : 'книги'} · ще се пуснат една след друга</p>
      )}

      {books.length === 0 ? (
        <div className="empty-lib">
          <p>Още няма книги. Добави текст, статия или качи файл, за да започнеш.</p>
          <button className="new-book" onClick={onNew}>＋ Добави първата си книга</button>
        </div>
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
