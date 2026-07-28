import { useRef, useState } from 'react';
import Cover from './Cover';

// Карта на книга в рафт. На телефон показва само корица + заглавие;
// оценката и действията се отварят с бутона „⋯“, за да е екранът изчистен.
export default function BookCard({
  book, totalChunks, onOpen, onRate, onToggleFavorite, onToggleFinished, onQueue, onRemove, onCoverChange,
}) {
  const [open, setOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInput = useRef();

  const pct = book.mediaType === 'audio'
    ? (book.progressPercent || 0)
    : totalChunks ? Math.min(100, Math.round((book.chunkIndex / totalChunks) * 100)) : 0;
  const hasProgress = book.mediaType === 'audio' ? book.audioPosition > 0 : book.chunkIndex > 0;

  return (
    <div className={`book-card ${open ? 'open' : ''}`}>
      <button className="book-cover-btn" onClick={() => onOpen(book)} aria-label={`Отвори ${book.title}`}>
        <Cover book={book} />
        {hasProgress && !book.finished && (
          <span className="cover-progress" style={{ '--pct': `${pct}%` }}><i /></span>
        )}
        {book.finished && <span className="cover-done">✓</span>}
        {book.mediaType === 'audio' && <span className="cover-badge" title="Аудиокнига">🎧</span>}
        <span className="cover-play">▶</span>
      </button>

      <div className="book-meta">
        <div className="book-headline">
          <div className="book-headline-text">
            <b className="book-title" title={book.title}>{book.title}</b>
            {book.author && <small className="book-author">{book.author}</small>}
          </div>
          <button
            className="book-more"
            aria-label={open ? 'Скрий действията' : 'Още действия'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            ⋯
          </button>
        </div>

        <div className="book-extra">
          <div className="book-rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= (book.rating || 0) ? 'on' : ''} aria-label={`${n} звезди`} onClick={() => onRate(book.id, n === book.rating ? 0 : n)}>★</button>
            ))}
          </div>
          <div className="book-actions">
            <button className={book.favorite ? 'on' : ''} title="Любима" onClick={() => onToggleFavorite(book)}>♥</button>
            <button className={book.finished ? 'on' : ''} title="Завършена" onClick={() => onToggleFinished(book)}>✓</button>
            <button title="Добави в опашката" onClick={() => onQueue(book)}>＋</button>
            <button title={book.cover ? 'Смени корицата' : 'Добави корица'} onClick={() => coverInput.current?.click()} disabled={coverBusy}>▣</button>
            <button title="Изтрий" onClick={() => onRemove(book.id)}>🗑</button>
            <input
              ref={coverInput}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (event) => {
                const file = event.target.files[0];
                if (!file) return;
                setCoverBusy(true);
                try {
                  await onCoverChange?.(book, file);
                } catch {
                  // App показва съобщението за грешка.
                } finally {
                  setCoverBusy(false);
                  event.target.value = '';
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
