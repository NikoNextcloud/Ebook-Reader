// Навигация по глави (EPUB или автоматично разпознати в текст).
export default function ChapterSelector({ chapters, active, onSelect }) {
  if (!chapters || chapters.length < 2) return null;

  return (
    <section className="control-section chapters">
      <span className="eyebrow">📖 · ГЛАВИ</span>
      <h3>{chapters.length} глави</h3>
      <div className="chapter-list">
        {chapters.map((chapter, index) => (
          <button
            key={index}
            className={index === active ? 'active' : ''}
            onClick={() => onSelect(index)}
          >
            <span>{index + 1}</span>
            <b>{chapter.title}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
