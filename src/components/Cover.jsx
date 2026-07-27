import { coverStyle, initials } from '../services/cover';

// Корица: истинска картинка (EPUB) или генериран градиент със заглавие.
export default function Cover({ book, size = 'md' }) {
  if (book.cover) {
    return <img className={`cover-art ${size}`} src={book.cover} alt={book.title} loading="lazy" />;
  }
  return (
    <div className={`cover-art gen ${size}`} style={coverStyle(book.title)}>
      <span className="cover-initials">{initials(book.title)}</span>
      <span className="cover-title">{book.title}</span>
    </div>
  );
}
