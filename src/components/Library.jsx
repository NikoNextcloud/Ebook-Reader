import { useState } from 'react';

// Библиотека със запазените книги: позиция, отметки и редактиране на заглавие.
export default function Library({ books, activeId, onOpen, onResume, onRemove, onRename, onJumpBookmark, onRemoveBookmark }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  if (!books.length) return null;

  const startEdit = (book) => { setEditing(book.id); setDraft(book.title); };
  const commit = () => {
    if (editing && draft.trim()) onRename(editing, draft.trim());
    setEditing(null);
  };

  return (
    <section className="control-section library">
      <span className="eyebrow">★ · БИБЛИОТЕКА</span>
      <h3>Продължи оттам, докъдето стигна</h3>
      <div className="library-list">
        {books.map((book) => (
          <div key={book.id} className={`library-item-wrap ${activeId === book.id ? 'active' : ''}`}>
            <div className="library-item">
              {editing === book.id ? (
                <input
                  className="library-edit"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
                />
              ) : (
                <button className="library-open" onClick={() => onOpen(book)}>
                  <b>{book.title}</b>
                  <small>
                    {book.mediaType === 'audio'
                      ? `аудиокнига${book.progressPercent ? ` · ${book.progressPercent}%` : ''}${book.audioCached ? ' · в паметта' : ''}`
                      : book.words ? `${book.words.toLocaleString('bg-BG')} думи` : 'текст'}
                    {book.mediaType !== 'audio' && book.chunkIndex > 0 ? ` · спряно на част ${book.chunkIndex + 1}` : ''}
                  </small>
                </button>
              )}
              <button className="library-edit-btn" aria-label="Преименувай" onClick={() => startEdit(book)}>✎</button>
              {(book.chunkIndex > 0 || book.audioPosition > 0) && (
                <button className="library-resume" title="Продължи оттук" onClick={() => onResume(book)}>▶</button>
              )}
              <button className="library-remove" aria-label="Изтрий книгата" onClick={() => onRemove(book.id)}>✕</button>
            </div>
            {book.bookmarks?.length > 0 && (
              <div className="bookmark-row">
                {book.bookmarks.map((mark) => (
                  <span key={mark.chunkIndex} className="bookmark-chip">
                    <button onClick={() => onJumpBookmark(book, mark.chunkIndex)}>🔖 {mark.label}</button>
                    <button className="bm-x" aria-label="Изтрий отметката" onClick={() => onRemoveBookmark(book.id, mark.chunkIndex)}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
