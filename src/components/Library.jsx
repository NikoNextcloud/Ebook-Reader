// Библиотека със запазените книги + позиция за продължаване.
export default function Library({ books, activeId, onOpen, onResume, onRemove }) {
  if (!books.length) return null;

  return (
    <section className="control-section library">
      <span className="eyebrow">★ · БИБЛИОТЕКА</span>
      <h3>Продължи оттам, докъдето стигна</h3>
      <div className="library-list">
        {books.map((book) => (
          <div key={book.id} className={`library-item ${activeId === book.id ? 'active' : ''}`}>
            <button className="library-open" onClick={() => onOpen(book)}>
              <b>{book.title}</b>
              <small>
                {book.words ? `${book.words.toLocaleString('bg-BG')} думи` : 'текст'}
                {book.chunkIndex > 0 ? ` · спряно на част ${book.chunkIndex + 1}` : ''}
              </small>
            </button>
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
