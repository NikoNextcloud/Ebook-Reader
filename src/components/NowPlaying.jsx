import { useState } from 'react';
import Cover from './Cover';

const fmt = (s) => {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEPS = [15, 30, 45, 60];

export default function NowPlaying({
  book, status, progress, position, chapters, activeChapter, rate, remainingMins,
  chunks, activeChunk, wordFraction, sleepMinutes, sleepRemaining, chapterMode, voiceEnergy = 0,
  onClose, onPlay, onPause, onStop, onPrev, onNext, onSkip, onSeek, onRate, onBookmark, onSpeed,
  onSelectChapter, onJumpBookmark, onRemoveBookmark, onJumpChunk, onSleep, onChapterMode,
}) {
  const [showText, setShowText] = useState(false);

  const renderChunk = (chunk, index) => {
    if (index !== activeChunk) {
      return <span key={index} className={index < activeChunk ? 'read-word' : ''} onClick={() => onJumpChunk(index)}>{chunk}{' '}</span>;
    }
    const wArr = chunk.split(' ');
    const target = wordFraction * (chunk.length || 1);
    let acc = 0;
    let wi = 0;
    for (let k = 0; k < wArr.length; k += 1) { acc += wArr[k].length + 1; wi = k; if (acc >= target) break; }
    return (
      <span key={index} className="active-chunk" onClick={() => onJumpChunk(index)}>
        {wArr.map((w, k) => <span key={k} className={k === wi ? 'current-word' : k < wi ? 'read-word' : ''}>{w}{' '}</span>)}
      </span>
    );
  };

  const chunkPct = position?.chunkDuration ? (position.chunkTime / position.chunkDuration) * 100 : 0;
  const canSeek = status === 'speaking' || status === 'paused';
  const seek = (e) => {
    if (!canSeek) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek?.((e.clientX - r.left) / r.width);
  };

  return (
    <div className={`now-playing ${status === 'speaking' ? 'is-speaking' : ''}`} style={{ '--voice-energy': voiceEnergy }}>
      <div className="voice-glow" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
      </div>
      <button className="np-close" onClick={onClose} aria-label="Затвори">▾</button>

      <div className="np-cover">
        <Cover book={book} size="lg" />
      </div>
      <div className="np-title">
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
      </div>

      <div className="np-rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={n <= (book.rating || 0) ? 'on' : ''} onClick={() => onRate(book.id, n === book.rating ? 0 : n)} aria-label={`${n} звезди`}>★</button>
        ))}
      </div>

      <div className={`np-scrubber ${canSeek ? 'seekable' : ''}`} onClick={seek} role="slider" aria-valuenow={Math.round(chunkPct)}>
        <i style={{ width: `${chunkPct}%` }} />
      </div>
      <div className="np-time">
        <span>{fmt(position?.chunkTime)}</span>
        <span>{status === 'loading' ? 'зареждам…' : position ? `част ${position.chunk + 1}/${position.total} · остават ~${remainingMins} мин.` : ''}</span>
        <span>{fmt(position?.chunkDuration)}</span>
      </div>

      <div className="np-transport">
        <button onClick={onPrev} aria-label="Предишна част">⏮</button>
        <button onClick={() => onSkip(-15)} aria-label="Назад 15с">«15</button>
        {status === 'speaking'
          ? <button className="np-main" onClick={onPause} aria-label="Пауза">Ⅱ</button>
          : <button className="np-main" onClick={onPlay} aria-label="Пусни">▶</button>}
        <button onClick={() => onSkip(15)} aria-label="Напред 15с">15»</button>
        <button onClick={onNext} aria-label="Следваща част">⏭</button>
      </div>

      <div className="np-tools">
        <div className="np-speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={Math.abs(rate - s) < 0.01 ? 'on' : ''} onClick={() => onSpeed(s)}>{s}×</button>
          ))}
        </div>
        <div className="np-tool-btns">
          <button onClick={onBookmark}>🔖 Отметка</button>
          <button className={showText ? 'on' : ''} onClick={() => setShowText((v) => !v)}>Aa Следи текста</button>
          <button onClick={onStop}>■ Стоп</button>
        </div>
        <div className="np-sleep">
          <span>Сън{sleepMinutes > 0 && sleepRemaining != null ? ` · ${Math.ceil(sleepRemaining / 60)} мин.` : ''}:</span>
          <button className={!sleepMinutes && !chapterMode ? 'on' : ''} onClick={() => { onChapterMode(false); onSleep(0); }}>Изкл.</button>
          {SLEEPS.map((m) => (
            <button key={m} className={sleepMinutes === m && !chapterMode ? 'on' : ''} onClick={() => { onChapterMode(false); onSleep(m); }}>{m}</button>
          ))}
          {chapters?.length > 1 && (
            <button className={chapterMode ? 'on' : ''} onClick={() => { onSleep(0); onChapterMode(!chapterMode); }}>Глава</button>
          )}
        </div>
      </div>

      {showText && chunks?.length > 0 && (
        <div className="np-text reading-view" onClick={(e) => e.stopPropagation()}>
          <p>{chunks.map(renderChunk)}</p>
        </div>
      )}

      {chapters?.length > 1 && (
        <div className="np-chapters">
          <h3>Глави</h3>
          {chapters.map((chapter, index) => {
            const minutes = Math.max(1, Math.ceil((chapter.text.split(/\s+/).length) / (165 * rate)));
            return (
              <button key={index} className={`np-chapter ${index === activeChapter ? 'active' : ''}`} onClick={() => onSelectChapter(index)}>
                <span className="np-ch-mark">{index < activeChapter ? '✓' : index + 1}</span>
                <b>{chapter.title}</b>
                <small>{minutes} мин.</small>
              </button>
            );
          })}
        </div>
      )}

      {book.bookmarks?.length > 0 && (
        <div className="np-bookmarks">
          <h3>Отметки</h3>
          {book.bookmarks.map((mark) => (
            <div key={mark.chunkIndex} className="np-bookmark-row">
              <button onClick={() => onJumpBookmark(mark.chunkIndex)}>🔖 {mark.label}</button>
              <button className="np-bookmark-delete" onClick={() => onRemoveBookmark?.(mark.chunkIndex)} aria-label="Изтрий отметката">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
