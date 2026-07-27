import { useEffect, useRef, useState } from 'react';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const fmt = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
};

// Обяснява защо аудиото не тръгва: проверява грешката на плеъра и, ако е нужно,
// пита сървъра какво отговаря — така не обвиняваме телефона напразно.
const describeAudioProblem = async (audio, url) => {
  const code = audio?.error?.code;
  if (code === 4) {
    try {
      const probe = await fetch(url, { headers: { Range: 'bytes=0-1' } });
      if (!probe.ok && probe.status !== 206) {
        const detail = await probe.text().catch(() => '');
        return `Източникът не дава аудиото (HTTP ${probe.status})${detail ? ` · ${detail.slice(0, 160)}` : ''}.`;
      }
      return 'Форматът на тази аудиокнига не се поддържа от браузъра.';
    } catch {
      return 'Няма връзка с източника на аудиото.';
    }
  }
  if (code === 2) return 'Връзката прекъсна при зареждането на аудиото. Опитай отново.';
  if (code === 3) return 'Аудиофайлът е повреден или непълен.';
  return 'Аудиото не може да се пусне в момента.';
};

export default function AudiobookPlayer({
  book,
  onClose,
  onProgress,
  onToggleFavorite,
  onBookmark,
  onRemoveBookmark,
  onFinished,
  onListening,
}) {
  const audioRef = useRef(null);
  const frameRef = useRef(null);
  const lastSavedRef = useRef(book.initialTime || 0);
  const timeRef = useRef(book.initialTime || 0);
  const durationRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(book.initialTime || 0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [energy, setEnergy] = useState(0);
  const [message, setMessage] = useState('');
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepRemaining, setSleepRemaining] = useState(0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);

  useEffect(() => {
    if (book.cacheNotice) setMessage(book.cacheNotice);
  }, [book.cacheNotice]);

  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused) {
        setEnergy(0);
        return;
      }
      const t = audio.currentTime || performance.now() / 1000;
      setEnergy(0.2 + Math.abs(Math.sin(t * 2.6)) * 0.18 + Math.abs(Math.sin(t * 5.4)) * 0.1);
      frameRef.current = window.requestAnimationFrame(tick);
    };
    if (playing) tick();
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    };
  }, [playing]);

  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => onListening?.(1), 1000);
    return () => window.clearInterval(timer);
  }, [onListening, playing]);

  useEffect(() => {
    if (!sleepMinutes) {
      setSleepRemaining(0);
      return undefined;
    }
    const deadline = Date.now() + sleepMinutes * 60000;
    setSleepRemaining(sleepMinutes * 60);
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSleepRemaining(left);
      if (!left) {
        window.clearInterval(timer);
        audioRef.current?.pause();
        setSleepMinutes(0);
        setMessage('Таймерът за сън спря аудиокнигата.');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleepMinutes]);

  const saveProgress = () => {
    onProgress?.(timeRef.current, durationRef.current);
    lastSavedRef.current = timeRef.current;
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
      setMessage('');
    } catch (error) {
      // Само NotAllowedError значи, че телефонът е блокирал звука. При всичко
      // друго проблемът е в самия файл/поток и трябва да го кажем честно.
      if (error?.name === 'NotAllowedError') {
        setMessage('Телефонът блокира звука. Натисни Play още веднъж.');
        return;
      }
      setMessage(await describeAudioProblem(audio, book.audioUrl));
    }
  };

  const skip = (seconds) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
  };

  const seek = (event) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Number(event.target.value);
    timeRef.current = audio.currentTime;
    saveProgress();
  };

  const changeRate = (value) => {
    setRate(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  };

  const jumpToBookmark = (time) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    timeRef.current = time;
    setCurrentTime(time);
    saveProgress();
  };

  const jumpTo = (time) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration || audio.duration || 0, time));
    timeRef.current = audio.currentTime;
    setCurrentTime(audio.currentTime);
  };

  const close = () => {
    saveProgress();
    audioRef.current?.pause();
    onClose?.(timeRef.current, durationRef.current);
  };

  const sleepLabel = sleepRemaining
    ? `${Math.floor(sleepRemaining / 60)}:${String(sleepRemaining % 60).padStart(2, '0')}`
    : '';

  return (
    <div className={`audiobook-player ${playing ? 'is-speaking' : ''}`} style={{ '--voice-energy': energy }}>
      <div className="voice-glow" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
      </div>
      <button className="ab-close" onClick={close} aria-label="Затвори">⌄</button>
      <button
        className={`ab-favorite ${book.favorite ? 'on' : ''}`}
        onClick={onToggleFavorite}
        aria-label={book.favorite ? 'Премахни от любими' : 'Добави в любими'}
      >
        ♥
      </button>

      {book.coverUrl
        ? <img className="ab-cover" src={book.coverUrl} alt={`Корица на ${book.title}`} />
        : <div className="ab-cover ab-cover-empty"><span>V</span></div>}

      <div className="ab-title">
        <span>АУДИОКНИГА</span>
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
        {book.narrator && <small>Чете: {book.narrator}</small>}
      </div>

      <audio
        ref={audioRef}
        src={book.audioUrl}
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          const nextDuration = audio.duration || 0;
          const resumeAt = Math.min(book.initialTime || 0, Math.max(0, nextDuration - 1));
          durationRef.current = nextDuration;
          timeRef.current = resumeAt;
          setDuration(nextDuration);
          setCurrentTime(resumeAt);
          if (resumeAt) audio.currentTime = resumeAt;
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime || 0;
          const total = event.currentTarget.duration || durationRef.current;
          timeRef.current = time;
          durationRef.current = total;
          setCurrentTime(time);
          if (Math.abs(time - lastSavedRef.current) >= 5) saveProgress();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); saveProgress(); }}
        onEnded={() => {
          setPlaying(false);
          saveProgress();
          onFinished?.();
        }}
      />

      <div className="ab-current-chapter">
        <span aria-hidden="true">☷</span>
        <b>{book.chapterTitle || 'Глава 1'}</b>
      </div>

      <div className="ab-progress">
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="1"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          style={{ '--ab-progress': `${duration ? (currentTime / duration) * 100 : 0}%` }}
          aria-label="Позиция в аудиокнигата"
        />
        <div>
          <span>{fmt(currentTime)}</span>
          <span>{fmt(Math.max(0, duration - currentTime))} остават</span>
          <span>-{fmt(Math.max(0, duration - currentTime))}</span>
        </div>
      </div>

      {message && <p className="ab-message" role="status">{message}</p>}

      <div className="ab-transport">
        <button className="ab-track" onClick={() => jumpTo(0)} aria-label="В началото">⏮</button>
        <button className="ab-skip" onClick={() => skip(-30)} aria-label="Назад 30 секунди"><span>↶</span><small>30</small></button>
        <button className="ab-main" onClick={toggle} aria-label={playing ? 'Пауза' : 'Пусни'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button className="ab-skip" onClick={() => skip(30)} aria-label="Напред 30 секунди"><span>↷</span><small>30</small></button>
        <button className="ab-track" onClick={() => jumpTo(Math.max(0, duration - 1))} aria-label="В края">⏭</button>
      </div>

      <div className="ab-quick-tools">
        <button className={showSpeedMenu ? 'on' : ''} onClick={() => { setShowSpeedMenu((value) => !value); setShowSleepMenu(false); }}>
          <strong>{rate}×</strong>
          <span>Скорост</span>
        </button>
        <a href={book.audioUrl} download={book.fileName}>
          <strong>↓</strong>
          <span>Офлайн</span>
        </a>
        <button className={showSleepMenu || sleepMinutes ? 'on' : ''} onClick={() => { setShowSleepMenu((value) => !value); setShowSpeedMenu(false); }}>
          <strong>◷</strong>
          <span>{sleepLabel || 'Таймер'}</span>
        </button>
        <button onClick={() => onBookmark?.(currentTime)}>
          <strong>＋</strong>
          <span>Отметка</span>
        </button>
      </div>

      {showSpeedMenu && (
        <div className="ab-popover ab-speeds" aria-label="Скорост">
          {SPEEDS.map((speed) => (
            <button key={speed} className={rate === speed ? 'on' : ''} onClick={() => { changeRate(speed); setShowSpeedMenu(false); }}>{speed}×</button>
          ))}
        </div>
      )}

      {showSleepMenu && (
        <div className="ab-popover ab-tools">
          {[0, 15, 30, 45, 60].map((minutes) => (
            <button
              key={minutes}
              className={sleepMinutes === minutes ? 'on' : ''}
              onClick={() => { setSleepMinutes(minutes); setShowSleepMenu(false); }}
            >
              {minutes ? `${minutes} мин.` : 'Изкл.'}
            </button>
          ))}
        </div>
      )}

      {book.audioBookmarks?.length > 0 && (
        <div className="ab-bookmarks">
          <span>ОТМЕТКИ</span>
          {book.audioBookmarks.map((mark) => (
            <div key={mark.time}>
              <button onClick={() => jumpToBookmark(mark.time)}>{mark.label || fmt(mark.time)}</button>
              <button onClick={() => onRemoveBookmark?.(mark.time)} aria-label="Изтрий отметката">×</button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
