import { useState } from 'react';

// Библиотека със запазените книги + позиция и редактиране на заглавието.
export default function Library({ books, activeId, onOpen, onResume, onRemove, onRename }) {
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
          <div key={book.id} className={`library-item ${activeId === book.id ? 'active' : ''}`}>
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
                  {book.words ? `${book.words.toLocaleString('bg-BG')} думи` : 'текст'}
                  {book.chunkIndex > 0 ? ` · спряно на част ${book.chunkIndex + 1}` : ''}
                </small>
              </button>
            )}
            <button className="library-edit-btn" aria-label="Преименувай" onClick={() => startEdit(book)}>✎</button>
            {book.chunkIndex > 0 && (
              <button className="library-resume" title="Продължи оттук" onClick={() => onResume(book)}>▶</button>
            )}
            <button className="library-remove" aria-label="Изтрий книгата" onClick={() => onRemove(book.id)}>✕</button>
          </div>
        ))}
      </div>
    </section>
  );
}
