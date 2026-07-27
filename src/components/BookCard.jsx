import Cover from './Cover';

// Карта на книга в рафт: корица, прогрес-пръстен, заглавие, автор, действия.
export default function BookCard({ book, totalChunks, onOpen, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove }) {
  const pct = totalChunks ? Math.min(100, Math.round((book.chunkIndex / totalChunks) * 100)) : 0;

  return (
    <div className="book-card">
      <button className="book-cover-btn" onClick={() => onOpen(book)} aria-label={`Отвори ${book.title}`}>
        <Cover book={book} />
        {book.chunkIndex > 0 && !book.finished && (
          <span className="cover-progress" style={{ '--pct': `${pct}%` }}><i /></span>
        )}
        {book.finished && <span className="cover-done">✓</span>}
        <span className="cover-play">▶</span>
      </button>
      <div className="book-meta">
        <b className="book-title" title={book.title}>{book.title}</b>
        {book.author && <small className="book-author">{book.author}</small>}
        <div className="book-rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={n <= (book.rating || 0) ? 'on' : ''} aria-label={`${n} звезди`} onClick={() => onRate(book.id, n === book.rating ? 0 : n)}>★</button>
          ))}
        </div>
        <div className="book-actions">
          <button className={book.favorite ? 'on' : ''} title="Любима" onClick={() => onToggleFavorite(book)}>♥</button>
          <button className={book.finished ? 'on' : ''} title="Завършена" onClick={() => onToggleFinished(book)}>✓</button>
          <button title="Добави в опашката" onClick={() => onQueue(book)}>＋</button>
          <button title="Изтрий" onClick={() => onRemove(book.id)}>🗑</button>
        </div>
      </div>
    </div>
  );
}
