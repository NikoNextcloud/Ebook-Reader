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

export default function AudiobookPlayer({ book, onClose }) {
  const audioRef = useRef(null);
  const frameRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [energy, setEnergy] = useState(0);
  const [message, setMessage] = useState('');

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
    } catch {
      setMessage('Телефонът блокира звука. Отвори страницата в Safari или Chrome и натисни Play отново.');
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
  };

  const changeRate = (value) => {
    setRate(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  };

  return (
    <div className={`audiobook-player ${playing ? 'is-speaking' : ''}`} style={{ '--voice-energy': energy }}>
      <div className="voice-glow" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
      </div>
      <button className="ab-close" onClick={onClose} aria-label="Затвори">×</button>

      {book.coverUrl
        ? <img className="ab-cover" src={book.coverUrl} alt="" />
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
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      <div className="ab-progress">
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="1"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          aria-label="Позиция в аудиокнигата"
        />
        <div><span>{fmt(currentTime)}</span><span>{fmt(duration)}</span></div>
      </div>

      {message && <p className="ab-message" role="status">{message}</p>}

      <div className="ab-transport">
        <button onClick={() => skip(-30)} aria-label="Назад 30 секунди">«30</button>
        <button className="ab-main" onClick={toggle} aria-label={playing ? 'Пауза' : 'Пусни'}>{playing ? 'Ⅱ' : '▶'}</button>
        <button onClick={() => skip(30)} aria-label="Напред 30 секунди">30»</button>
      </div>

      <div className="ab-speeds" aria-label="Скорост">
        {SPEEDS.map((speed) => (
          <button key={speed} className={rate === speed ? 'on' : ''} onClick={() => changeRate(speed)}>{speed}×</button>
        ))}
      </div>

      <a className="ab-download" href={book.audioUrl} download={book.fileName}>↓ Запази аудиокнигата</a>
    </div>
  );
}
