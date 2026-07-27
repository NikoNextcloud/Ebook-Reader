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
  book, status, position, chapters, activeChapter, rate, remainingMins,
  chunks, activeChunk, wordFraction, sleepMinutes, sleepRemaining, chapterMode, voiceEnergy = 0, message,
  onClose, onPlay, onPause, onStop, onPrev, onNext, onSkip, onSeek, onRate, onBookmark, onSpeed,
  onSelectChapter, onJumpBookmark, onRemoveBookmark, onJumpChunk, onSleep, onChapterMode,
}) {
  const [showText, setShowText] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);

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
  const chapterTitle = chapters?.[activeChapter]?.title || `Част ${(position?.chunk || 0) + 1}`;
  const sleepLabel = chapterMode
    ? 'Глава'
    : sleepMinutes > 0 && sleepRemaining != null
      ? `${Math.ceil(sleepRemaining / 60)} мин.`
      : 'Таймер';
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

      <div className="np-current-chapter">
        <span aria-hidden="true">☷</span>
        <b>{chapterTitle}</b>
      </div>

      <div className={`np-scrubber ${canSeek ? 'seekable' : ''}`} onClick={seek} role="slider" aria-valuenow={Math.round(chunkPct)}>
        <i style={{ width: `${chunkPct}%` }} />
      </div>
      <div className="np-time">
        <span>{fmt(position?.chunkTime)}</span>
        <span>{status === 'loading' ? 'зареждам…' : position ? `част ${position.chunk + 1}/${position.total} · остават ~${remainingMins} мин.` : ''}</span>
        <span>{fmt(position?.chunkDuration)}</span>
      </div>

      {message && ['paused', 'error'].includes(status) && (
        <div className="np-audio-notice" role="status" aria-live="polite">
          <span aria-hidden="true">▶</span>
          <p>{message}</p>
        </div>
      )}

      <div className="np-transport">
        <button onClick={onPrev} aria-label="Предишна част">⏮</button>
        <button className="np-skip" onClick={() => onSkip(-30)} aria-label="Назад 30 секунди"><span>↶</span><small>30</small></button>
        {status === 'loading'
          ? <button className="np-main is-loading" disabled aria-label="Гласът се подготвя">…</button>
          : status === 'speaking'
            ? <button className="np-main" onClick={onPause} aria-label="Пауза">Ⅱ</button>
            : <button className="np-main" onClick={onPlay} aria-label="Пусни">▶</button>}
        <button className="np-skip" onClick={() => onSkip(30)} aria-label="Напред 30 секунди"><span>↷</span><small>30</small></button>
        <button onClick={onNext} aria-label="Следваща част">⏭</button>
      </div>

      <div className="np-quick-tools">
        <button className={showSpeedMenu ? 'on' : ''} onClick={() => { setShowSpeedMenu((value) => !value); setShowSleepMenu(false); }}>
          <strong>{rate}×</strong>
          <span>Скорост</span>
        </button>
        <button className={showText ? 'on' : ''} onClick={() => setShowText((value) => !value)}>
          <strong>Aa</strong>
          <span>Текст</span>
        </button>
        <button className={showSleepMenu || sleepMinutes || chapterMode ? 'on' : ''} onClick={() => { setShowSleepMenu((value) => !value); setShowSpeedMenu(false); }}>
          <strong>◷</strong>
          <span>{sleepLabel}</span>
        </button>
        <button onClick={onBookmark}>
          <strong>＋</strong>
          <span>Отметка</span>
        </button>
      </div>

      {showSpeedMenu && (
        <div className="np-popover np-speeds" aria-label="Скорост">
          {SPEEDS.map((s) => (
            <button key={s} className={Math.abs(rate - s) < 0.01 ? 'on' : ''} onClick={() => { onSpeed(s); setShowSpeedMenu(false); }}>{s}×</button>
          ))}
        </div>
      )}

      {showSleepMenu && (
        <div className="np-popover np-sleep">
          <button className={!sleepMinutes && !chapterMode ? 'on' : ''} onClick={() => { onChapterMode(false); onSleep(0); setShowSleepMenu(false); }}>Изкл.</button>
          {SLEEPS.map((m) => (
            <button key={m} className={sleepMinutes === m && !chapterMode ? 'on' : ''} onClick={() => { onChapterMode(false); onSleep(m); setShowSleepMenu(false); }}>{m} мин.</button>
          ))}
          {chapters?.length > 1 && (
            <button className={chapterMode ? 'on' : ''} onClick={() => { onSleep(0); onChapterMode(!chapterMode); setShowSleepMenu(false); }}>След глава</button>
          )}
        </div>
      )}

      <button className="np-stop" onClick={onStop}>■ Спри четенето</button>

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
