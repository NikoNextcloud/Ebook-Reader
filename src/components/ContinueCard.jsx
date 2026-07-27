import Cover from './Cover';
import { formatDuration } from '../services/cover';

// Голяма карта „Продължи да слушаш“ — едно докосване подновява слушането.
export default function ContinueCard({ book, percent, remaining, onResume }) {
  if (!book) return null;

  return (
    <button className="continue-card" onClick={() => onResume(book)}>
      <Cover book={book} size="sm" />
      <div className="continue-info">
        <span className="continue-label">ПРОДЪЛЖИ ДА СЛУШАШ</span>
        <b>{book.title}</b>
        {book.author && <small>{book.author}</small>}
        <span className="continue-bar"><i style={{ width: `${percent}%` }} /></span>
        <small className="continue-meta">
          {percent}%{remaining ? ` · остават ~${formatDuration(remaining)}` : ''}
        </small>
      </div>
      <span className="continue-play" aria-hidden="true">▶</span>
    </button>
  );
}
