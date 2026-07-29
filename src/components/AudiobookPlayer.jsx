import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BookmarkPlus,
  CarFront,
  Check,
  ChevronDown,
  Download,
  FileText,
  Gauge,
  Heart,
  ListMusic,
  Minimize2,
  MoonStar,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Timer,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { AudioEnhancer, AUDIO_PROFILES } from '../services/audioEnhancer';
import {
  activeTranscriptCue,
  buildApproximateCues,
  parseTimedText,
} from '../services/transcript';
import {
  ACCESS_BLOCKED_EVENT,
  reportListenerActivity,
} from '../services/listenerPresence';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const STILLNESS_MINUTES = 15;

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
  onTranscriptChange,
  onAudioSettings,
  onOfflineSettings,
  onCacheBook,
}) {
  const audioRef = useRef(null);
  const frameRef = useRef(null);
  const lastSavedRef = useRef(book.initialTime || 0);
  const timeRef = useRef(book.initialTime || 0);
  const durationRef = useRef(0);
  const wakeLockRef = useRef(null);
  const enhancerRef = useRef(null);
  const enhancerActivatedRef = useRef(false);
  const transcriptInputRef = useRef(null);
  const activeCueRef = useRef(null);
  const onAudioSettingsRef = useRef(onAudioSettings);
  const onOfflineSettingsRef = useRef(onOfflineSettings);
  const presenceRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(book.initialTime || 0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [energy, setEnergy] = useState(0);
  const [message, setMessage] = useState('');
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepRemaining, setSleepRemaining] = useState(0);
  const [sleepChapterEnd, setSleepChapterEnd] = useState(0);
  const [sleepWhenStill, setSleepWhenStill] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const chapterListRef = useRef(null);
  const [carMode, setCarMode] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAudioTools, setShowAudioTools] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [audioProfile, setAudioProfile] = useState(book.audioProfile || 'natural');
  const [audioBass, setAudioBass] = useState(book.audioBass || 0);
  const [audioClarity, setAudioClarity] = useState(book.audioClarity || 0);
  const [audioNormalize, setAudioNormalize] = useState(!!book.audioNormalize);
  const [offlineChapters, setOfflineChapters] = useState(book.offlineChapters || []);
  const [offlineAutoNext, setOfflineAutoNext] = useState(book.offlineAutoNext !== false);
  const [offlineAutoClean, setOfflineAutoClean] = useState(book.offlineAutoClean !== false);

  const chapters = useMemo(() => {
    const source = Array.isArray(book.chapters) ? book.chapters : [];
    return source.map((chapter, index) => ({
      ...chapter,
      end: chapter.end > chapter.start
        ? chapter.end
        : source[index + 1]?.start || duration || 0,
    }));
  }, [book.chapters, duration]);
  const activeChapterIndex = chapters.reduce(
    (found, chapter, index) => (chapter.start <= currentTime + 0.05 ? index : found),
    0,
  );
  const activeChapter = chapters[activeChapterIndex] || null;

  useEffect(() => {
    if (!showChapters || !chapterListRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const list = chapterListRef.current;
      const active = list?.querySelector(`[data-chapter-index="${activeChapterIndex}"]`);
      if (!list || !active) return;
      list.scrollTop = Math.max(
        0,
        active.offsetTop - (list.clientHeight / 2) + (active.offsetHeight / 2),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeChapterIndex, showChapters]);

  const transcriptCues = useMemo(() => {
    if (book.transcriptCues?.length) return book.transcriptCues;
    return buildApproximateCues(book.transcriptText, chapters, duration);
  }, [book.transcriptCues, book.transcriptText, chapters, duration]);
  const activeCueIndex = activeTranscriptCue(transcriptCues, currentTime);

  useEffect(() => { onAudioSettingsRef.current = onAudioSettings; }, [onAudioSettings]);
  useEffect(() => { onOfflineSettingsRef.current = onOfflineSettings; }, [onOfflineSettings]);

  useEffect(() => {
    if (!showTranscript) return;
    const active = activeCueRef.current;
    const container = active?.parentElement;
    if (active && container) {
      container.scrollTo({
        top: Math.max(0, active.offsetTop - container.clientHeight / 2),
        behavior: 'smooth',
      });
    }
  }, [activeCueIndex, showTranscript]);

  useEffect(() => {
    const settings = {
      audioProfile,
      audioBass,
      audioClarity,
      audioNormalize,
    };
    const isNatural = audioProfile === 'natural'
      && !audioBass
      && !audioClarity
      && !audioNormalize;
    if (isNatural && !enhancerActivatedRef.current) return;
    enhancerActivatedRef.current = true;
    enhancerRef.current ||= new AudioEnhancer(audioRef.current);
    enhancerRef.current.apply({
      profile: audioProfile,
      bass: audioBass,
      clarity: audioClarity,
      normalize: audioNormalize,
    }).catch((error) => setMessage(error.message));
    onAudioSettingsRef.current?.(settings);
  }, [audioProfile, audioBass, audioClarity, audioNormalize]);

  useEffect(() => () => enhancerRef.current?.close(), []);

  useEffect(() => {
    if (!offlineAutoNext || !chapters.length) return;
    const wanted = new Set(offlineChapters);
    wanted.add(activeChapterIndex);
    if (activeChapterIndex < chapters.length - 1) wanted.add(activeChapterIndex + 1);
    const next = [...wanted].sort((a, b) => a - b);
    if (next.join(',') !== offlineChapters.join(',')) {
      setOfflineChapters(next);
      onOfflineSettingsRef.current?.({
        offlineChapters: next,
        offlineAutoNext,
        offlineAutoClean,
      });
    }
  }, [
    activeChapterIndex,
    chapters.length,
    offlineAutoNext,
    offlineAutoClean,
    offlineChapters,
  ]);

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

  presenceRef.current = {
    state: playing ? 'playing' : 'paused',
    book: {
      id: book.id,
      title: book.title,
      type: 'audio',
    },
    position: currentTime,
    duration,
  };

  useEffect(() => {
    const report = () => reportListenerActivity(presenceRef.current);
    report();
    if (!playing) return undefined;
    const timer = window.setInterval(report, 15000);
    return () => window.clearInterval(timer);
  }, [book.id, playing]);

  useEffect(() => {
    const onAccessBlocked = (event) => {
      audioRef.current?.pause();
      setPlaying(false);
      setMessage(event.detail?.message || 'Достъпът на това устройство е спрян.');
    };
    window.addEventListener(ACCESS_BLOCKED_EVENT, onAccessBlocked);
    return () => window.removeEventListener(ACCESS_BLOCKED_EVENT, onAccessBlocked);
  }, []);

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

  useEffect(() => {
    if (!sleepWhenStill) return undefined;
    let deadline = Date.now() + STILLNESS_MINUTES * 60000;
    let lastMagnitude = null;
    setSleepRemaining(STILLNESS_MINUTES * 60);

    const onMotion = (event) => {
      const motion = event.accelerationIncludingGravity || event.acceleration;
      if (!motion) return;
      const magnitude = Math.hypot(motion.x || 0, motion.y || 0, motion.z || 0);
      if (lastMagnitude !== null && Math.abs(magnitude - lastMagnitude) > 0.9) {
        deadline = Date.now() + STILLNESS_MINUTES * 60000;
      }
      lastMagnitude = magnitude;
    };
    window.addEventListener('devicemotion', onMotion);
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSleepRemaining(left);
      if (!left) {
        window.clearInterval(timer);
        audioRef.current?.pause();
        setSleepWhenStill(false);
        setMessage('Аудиокнигата спря след 15 минути без движение.');
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [sleepWhenStill]);

  useEffect(() => {
    if (!carMode || !navigator.wakeLock?.request) return undefined;
    let active = true;
    navigator.wakeLock.request('screen').then((lock) => {
      if (active) wakeLockRef.current = lock;
      else lock.release?.();
    }).catch(() => {});
    return () => {
      active = false;
      wakeLockRef.current?.release?.();
      wakeLockRef.current = null;
    };
  }, [carMode]);

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

  const disableSleepTimer = () => {
    setSleepMinutes(0);
    setSleepChapterEnd(0);
    setSleepWhenStill(false);
    setSleepRemaining(0);
    setShowSleepMenu(false);
  };

  const chooseTimedSleep = (minutes) => {
    setSleepChapterEnd(0);
    setSleepWhenStill(false);
    setSleepMinutes(minutes);
    if (!minutes) setSleepRemaining(0);
    setShowSleepMenu(false);
  };

  const chooseChapterSleep = () => {
    const chapterEnd = activeChapter?.end || 0;
    if (!chapterEnd || chapterEnd <= currentTime) {
      setMessage('Текущата глава няма валиден краен маркер.');
      return;
    }
    setSleepMinutes(0);
    setSleepWhenStill(false);
    setSleepChapterEnd(chapterEnd);
    setSleepRemaining(0);
    setShowSleepMenu(false);
    setMessage(`Таймерът ще спре в края на „${activeChapter.title}“.`);
  };

  const chooseStillnessSleep = async () => {
    if (!('DeviceMotionEvent' in window)) {
      setMessage('Този браузър не поддържа разпознаване на движение.');
      return;
    }
    try {
      if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
        const permission = await window.DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') {
          setMessage('Достъпът до движението на телефона не беше разрешен.');
          return;
        }
      }
      setSleepMinutes(0);
      setSleepChapterEnd(0);
      setSleepWhenStill(true);
      setShowSleepMenu(false);
      setMessage('Таймерът ще спре след 15 минути без движение.');
    } catch {
      setMessage('Таймерът без движение не може да бъде активиран.');
    }
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

  const previousChapter = () => {
    if (!chapters.length) {
      jumpTo(0);
      return;
    }
    const targetIndex = currentTime - activeChapter.start > 4
      ? activeChapterIndex
      : Math.max(0, activeChapterIndex - 1);
    jumpTo(chapters[targetIndex].start);
  };

  const nextChapter = () => {
    if (!chapters.length) {
      jumpTo(Math.max(0, duration - 1));
      return;
    }
    if (activeChapterIndex >= chapters.length - 1) {
      jumpTo(Math.max(0, duration - 1));
      return;
    }
    jumpTo(chapters[activeChapterIndex + 1].start);
  };

  const cycleSpeed = () => {
    const currentIndex = SPEEDS.indexOf(rate);
    changeRate(SPEEDS[(currentIndex + 1) % SPEEDS.length]);
  };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: book.title,
      artist: book.author || book.narrator || 'Voxora',
      album: book.metadata?.series || 'Аудиокнига',
      artwork: book.coverUrl ? [{ src: book.coverUrl }] : [],
    });
    const actions = {
      play: () => audioRef.current?.play(),
      pause: () => audioRef.current?.pause(),
      seekbackward: (details) => skip(-(details.seekOffset || 30)),
      seekforward: (details) => skip(details.seekOffset || 30),
      previoustrack: previousChapter,
      nexttrack: nextChapter,
    };
    Object.entries(actions).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Някои браузъри поддържат Media Session, но не всяко действие.
      }
    });
    return () => {
      Object.keys(actions).forEach((action) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Неподдържано действие.
        }
      });
    };
  }, [
    activeChapterIndex,
    book.author,
    book.coverUrl,
    book.metadata?.series,
    book.narrator,
    book.title,
    chapters,
  ]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (duration > 0 && currentTime >= 0 && currentTime <= duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: rate,
          position: currentTime,
        });
      } catch {
        // Позицията не се поддържа от този браузър.
      }
    }
  }, [currentTime, duration, playing, rate]);

  const loadTranscriptFile = async (file) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const timed = parseTimedText(raw);
      const transcriptText = timed.length
        ? timed.map((cue) => cue.text).join(' ')
        : raw.replace(/\s+/g, ' ').trim();
      const cues = timed.length
        ? timed
        : buildApproximateCues(transcriptText, chapters, duration);
      if (!cues.length) throw new Error('Файлът не съдържа разпознаваем текст.');
      onTranscriptChange?.({ text: transcriptText, cues });
      setShowTranscript(true);
      setMessage(timed.length
        ? `Заредени са ${timed.length} синхронизирани реплики.`
        : 'Текстът е синхронизиран приблизително спрямо дължината на книгата.');
    } catch (error) {
      setMessage(error.message || 'Текстът не може да бъде зареден.');
    }
  };

  const updateOfflineSettings = (patch) => {
    const next = {
      offlineChapters,
      offlineAutoNext,
      offlineAutoClean,
      ...patch,
    };
    if (patch.offlineChapters) setOfflineChapters(patch.offlineChapters);
    if (patch.offlineAutoNext !== undefined) setOfflineAutoNext(patch.offlineAutoNext);
    if (patch.offlineAutoClean !== undefined) setOfflineAutoClean(patch.offlineAutoClean);
    onOfflineSettingsRef.current?.(next);
  };

  const toggleOfflineChapter = (index) => {
    const next = offlineChapters.includes(index)
      ? offlineChapters.filter((value) => value !== index)
      : [...offlineChapters, index].sort((a, b) => a - b);
    updateOfflineSettings({ offlineChapters: next });
  };

  const cacheForOffline = async () => {
    if (book.audioCached || cacheBusy) return;
    setCacheBusy(true);
    setMessage('Подготвям аудиокнигата за офлайн слушане…');
    try {
      const cached = await onCacheBook?.((percent) => {
        setMessage(`Подготвям аудиокнигата за офлайн слушане… ${percent}%`);
      });
      setMessage(cached
        ? 'Аудиокнигата и избраните глави са готови офлайн.'
        : 'Аудиокнигата не можа да бъде запазена офлайн.');
    } catch (error) {
      setMessage(error.message || 'Офлайн изтеглянето се провали.');
    } finally {
      setCacheBusy(false);
    }
  };

  const close = () => {
    saveProgress();
    audioRef.current?.pause();
    reportListenerActivity({ ...presenceRef.current, state: 'stopped' });
    onClose?.(timeRef.current, durationRef.current);
  };

  const sleepLabel = sleepChapterEnd
    ? 'До глава'
    : sleepWhenStill
      ? `${Math.ceil(sleepRemaining / 60)} мин.`
      : sleepRemaining
        ? `${Math.floor(sleepRemaining / 60)}:${String(sleepRemaining % 60).padStart(2, '0')}`
        : '';
  const sleepActive = !!(sleepMinutes || sleepChapterEnd || sleepWhenStill);

  return (
    <div className={`audiobook-player ${playing ? 'is-speaking' : ''}`} style={{ '--voice-energy': energy }}>
      <div className="voice-glow" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
      </div>
      <button className="ab-close" onClick={close} aria-label="Затвори">
        <ChevronDown aria-hidden="true" />
      </button>
      <button
        className={`ab-favorite ${book.favorite ? 'on' : ''}`}
        onClick={onToggleFavorite}
        aria-label={book.favorite ? 'Премахни от любими' : 'Добави в любими'}
      >
        <Heart aria-hidden="true" fill={book.favorite ? 'currentColor' : 'none'} />
      </button>

      {book.coverUrl
        ? <img className="ab-cover" src={book.coverUrl} alt={`Корица на ${book.title}`} />
        : <div className="ab-cover ab-cover-empty"><span>V</span></div>}

      <div className="ab-title">
        <span>АУДИОКНИГА</span>
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
        {book.narrator && <small>Чете: {book.narrator}</small>}
        {(book.metadata?.series || book.metadata?.genre || book.metadata?.year) && (
          <div className="ab-metadata">
            {[book.metadata.series, book.metadata.genre, book.metadata.year].filter(Boolean).map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        )}
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
          if (sleepChapterEnd && time >= sleepChapterEnd - 0.2) {
            event.currentTarget.pause();
            setSleepChapterEnd(0);
            setMessage('Аудиокнигата спря в края на главата.');
          }
          if (Math.abs(time - lastSavedRef.current) >= 5) saveProgress();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); saveProgress(); }}
        onEnded={() => {
          setPlaying(false);
          saveProgress();
          reportListenerActivity({ ...presenceRef.current, state: 'stopped' });
          onFinished?.();
        }}
      />

      <button
        className="ab-current-chapter"
        onClick={() => setShowChapters((value) => !value)}
        aria-expanded={showChapters}
        disabled={!chapters.length}
      >
        <ListMusic aria-hidden="true" />
        <b>{activeChapter?.title || book.chapterTitle || 'Глава 1'}</b>
        {chapters.length > 0 && <small>{activeChapterIndex + 1}/{chapters.length}</small>}
      </button>

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
        <button className="ab-track" onClick={previousChapter} aria-label={chapters.length ? 'Предишна глава' : 'В началото'}>
          <SkipBack aria-hidden="true" />
        </button>
        <button className="ab-skip" onClick={() => skip(-30)} aria-label="Назад 30 секунди">
          <RotateCcw aria-hidden="true" />
          <small>30</small>
        </button>
        <button className="ab-main" onClick={toggle} aria-label={playing ? 'Пауза' : 'Пусни'}>
          {playing
            ? <Pause aria-hidden="true" fill="currentColor" />
            : <Play aria-hidden="true" fill="currentColor" />}
        </button>
        <button className="ab-skip" onClick={() => skip(30)} aria-label="Напред 30 секунди">
          <RotateCw aria-hidden="true" />
          <small>30</small>
        </button>
        <button className="ab-track" onClick={nextChapter} aria-label={chapters.length ? 'Следваща глава' : 'В края'}>
          <SkipForward aria-hidden="true" />
        </button>
      </div>

      <div className="ab-quick-tools has-car-mode">
        <button className={showSpeedMenu ? 'on' : ''} onClick={() => { setShowSpeedMenu((value) => !value); setShowSleepMenu(false); }}>
          <strong>{rate}×</strong>
          <span>Скорост</span>
        </button>
        <button className={showOffline || book.audioCached ? 'on' : ''} onClick={() => {
          setShowOffline((value) => !value);
          setShowAudioTools(false);
          setShowTranscript(false);
        }}>
          <strong>{book.audioCached ? <Check aria-hidden="true" /> : <Download aria-hidden="true" />}</strong>
          <span>Офлайн</span>
        </button>
        <button onClick={() => { setCarMode(true); setShowSleepMenu(false); setShowSpeedMenu(false); }}>
          <strong><CarFront aria-hidden="true" /></strong>
          <span>Авто режим</span>
        </button>
        <button className={showSleepMenu || sleepActive ? 'on' : ''} onClick={() => { setShowSleepMenu((value) => !value); setShowSpeedMenu(false); }}>
          <strong><Timer aria-hidden="true" /></strong>
          <span>{sleepLabel || 'Таймер'}</span>
        </button>
        <button onClick={() => onBookmark?.(currentTime)}>
          <strong><BookmarkPlus aria-hidden="true" /></strong>
          <span>Отметка</span>
        </button>
      </div>

      <div className="ab-premium-tools">
        <button className={showTranscript ? 'on' : ''} onClick={() => {
          setShowTranscript((value) => !value);
          setShowAudioTools(false);
          setShowOffline(false);
        }}>
          <FileText aria-hidden="true" />
          <span>Текст</span>
        </button>
        <button className={showAudioTools ? 'on' : ''} onClick={() => {
          setShowAudioTools((value) => !value);
          setShowTranscript(false);
          setShowOffline(false);
        }}>
          <SlidersHorizontal aria-hidden="true" />
          <span>Звук</span>
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
        <div className="ab-popover ab-tools smart-sleep-options">
          {[0, 15, 30, 45, 60].map((minutes) => (
            <button
              key={minutes}
              className={sleepMinutes === minutes && !sleepChapterEnd && !sleepWhenStill ? 'on' : ''}
              onClick={() => chooseTimedSleep(minutes)}
            >
              {minutes ? `${minutes} мин.` : 'Изкл.'}
            </button>
          ))}
          {chapters.length > 0 && (
            <button className={sleepChapterEnd ? 'on' : ''} onClick={chooseChapterSleep}>
              Край на глава
            </button>
          )}
          <button className={sleepWhenStill ? 'on' : ''} onClick={chooseStillnessSleep}>
            <MoonStar aria-hidden="true" /> Без движение
          </button>
        </div>
      )}

      {showAudioTools && (
        <section className="ab-premium-panel ab-audio-tools">
          <header>
            <div>
              <span>ЗВУК</span>
              <b>{AUDIO_PROFILES[audioProfile]?.label}</b>
            </div>
            <SlidersHorizontal aria-hidden="true" />
          </header>
          <div className="ab-profile-options">
            {Object.entries(AUDIO_PROFILES).map(([key, profile]) => (
              <button
                key={key}
                className={audioProfile === key ? 'on' : ''}
                onClick={() => setAudioProfile(key)}
              >
                {profile.label}
              </button>
            ))}
          </div>
          <label className="ab-audio-slider">
            <span>Плътност <b>{audioBass > 0 ? `+${audioBass}` : audioBass}</b></span>
            <input
              type="range"
              min="-4"
              max="4"
              step="1"
              value={audioBass}
              onChange={(event) => setAudioBass(Number(event.target.value))}
            />
          </label>
          <label className="ab-audio-slider">
            <span>Яснота <b>{audioClarity > 0 ? `+${audioClarity}` : audioClarity}</b></span>
            <input
              type="range"
              min="-3"
              max="4"
              step="1"
              value={audioClarity}
              onChange={(event) => setAudioClarity(Number(event.target.value))}
            />
          </label>
          <label className="ab-audio-toggle">
            <input
              type="checkbox"
              checked={audioNormalize}
              onChange={(event) => setAudioNormalize(event.target.checked)}
            />
            <span><b>Еднаква сила</b></span>
          </label>
        </section>
      )}

      {showOffline && (
        <section className="ab-premium-panel ab-offline-manager">
          <header>
            <div>
              <span>ОФЛАЙН ГЛАВИ</span>
              <b>{book.audioCached ? 'Готова офлайн' : `${offlineChapters.length} избрани`}</b>
            </div>
            <WifiOff aria-hidden="true" />
          </header>
          {!book.audioCached && (
            <button className="ab-offline-download" onClick={cacheForOffline} disabled={cacheBusy}>
              <Download aria-hidden="true" />
              {cacheBusy ? 'Подготвям…' : 'Изтегли избраните глави'}
            </button>
          )}
          <div className="ab-offline-options">
            <label>
              <input
                type="checkbox"
                checked={offlineAutoNext}
                onChange={(event) => updateOfflineSettings({ offlineAutoNext: event.target.checked })}
              />
              <span><b>Следваща глава</b></span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={offlineAutoClean}
                onChange={(event) => updateOfflineSettings({ offlineAutoClean: event.target.checked })}
              />
              <span><b>Автоматично почистване</b></span>
            </label>
          </div>
          {chapters.length > 0 && (
            <div className="ab-offline-chapters">
              {chapters.map((chapter, index) => {
                const selected = book.audioCached || offlineChapters.includes(index);
                return (
                  <button
                    key={`${chapter.start}-${chapter.title}-offline`}
                    className={selected ? 'on' : ''}
                    onClick={() => toggleOfflineChapter(index)}
                    disabled={book.audioCached}
                  >
                    <span>{selected ? <Check aria-hidden="true" /> : index + 1}</span>
                    <b>{chapter.title}</b>
                    <small>{fmt(Math.max(0, chapter.end - chapter.start))}</small>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showTranscript && (
        <section className="ab-premium-panel ab-transcript">
          <header>
            <div>
              <span>СИНХРОНИЗИРАН ТЕКСТ</span>
              <b>{transcriptCues.length ? `${transcriptCues.length} части` : 'Няма добавен текст'}</b>
            </div>
            <button onClick={() => transcriptInputRef.current?.click()}>
              <Upload aria-hidden="true" />
              Добави
            </button>
            <input
              ref={transcriptInputRef}
              hidden
              type="file"
              accept=".srt,.vtt,.txt,text/plain,text/vtt,application/x-subrip"
              onChange={(event) => {
                loadTranscriptFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </header>
          {transcriptCues.length ? (
            <div className="ab-transcript-lines">
              {transcriptCues.map((cue, index) => (
                <button
                  key={`${cue.start}-${index}`}
                  ref={index === activeCueIndex ? activeCueRef : null}
                  className={index === activeCueIndex ? 'active' : ''}
                  onClick={() => jumpTo(cue.start)}
                >
                  <small>{fmt(cue.start)}</small>
                  <span>{cue.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <button className="ab-transcript-empty" onClick={() => transcriptInputRef.current?.click()}>
              <FileText aria-hidden="true" />
              <span>Добави SRT, VTT или TXT</span>
            </button>
          )}
        </section>
      )}

      {showChapters && chapters.length > 0 && (
        <>
          <button
            className="ab-chapters-backdrop"
            type="button"
            onClick={() => setShowChapters(false)}
            aria-label="Затвори списъка с глави"
          />
          <div
            className="ab-chapters"
            ref={chapterListRef}
            role="dialog"
            aria-modal="true"
            aria-label="Глави на аудиокнигата"
          >
            <div className="ab-chapters-head">
              <div>
                <span>ГЛАВИ</span>
                <small>{activeChapterIndex + 1} от {chapters.length}</small>
              </div>
              <button
                type="button"
                onClick={() => setShowChapters(false)}
                aria-label="Затвори списъка с глави"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {chapters.map((chapter, index) => (
              <button
                key={`${chapter.start}-${chapter.title}`}
                data-chapter-index={index}
                className={index === activeChapterIndex ? 'active' : ''}
                onClick={() => {
                  jumpTo(chapter.start);
                  setShowChapters(false);
                }}
              >
                <span>{index + 1}</span>
                <b>{chapter.title}</b>
                <small>{fmt(Math.max(0, chapter.end - chapter.start))}</small>
              </button>
            ))}
          </div>
        </>
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

      {carMode && (
        <div className="car-mode-player">
          <header>
            <div>
              <CarFront aria-hidden="true" />
              <span>VOXORA AUTO</span>
            </div>
            <button onClick={() => { setCarMode(false); setShowSleepMenu(false); }} aria-label="Изход от автомобилен режим">
              <Minimize2 aria-hidden="true" />
              Изход
            </button>
          </header>

          <div className="car-book">
            {book.coverUrl && <img src={book.coverUrl} alt="" />}
            <div>
              <h2>{book.title}</h2>
              <p>{activeChapter?.title || book.chapterTitle || 'Глава 1'}</p>
            </div>
          </div>

          <div className="car-progress">
            <i style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
          </div>
          <div className="car-time">
            <span>{fmt(currentTime)}</span>
            <span>-{fmt(Math.max(0, duration - currentTime))}</span>
          </div>

          <div className="car-main-controls">
            <button onClick={() => skip(-30)} aria-label="Назад 30 секунди">
              <RotateCcw aria-hidden="true" />
              <small>30</small>
            </button>
            <button className="car-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Пусни'}>
              {playing
                ? <Pause aria-hidden="true" fill="currentColor" />
                : <Play aria-hidden="true" fill="currentColor" />}
            </button>
            <button onClick={() => skip(30)} aria-label="Напред 30 секунди">
              <RotateCw aria-hidden="true" />
              <small>30</small>
            </button>
          </div>

          <div className="car-chapter-controls">
            <button onClick={previousChapter}><SkipBack aria-hidden="true" /> Предишна</button>
            <button onClick={nextChapter}>Следваща <SkipForward aria-hidden="true" /></button>
          </div>

          <div className="car-tools">
            <button onClick={cycleSpeed}><Gauge aria-hidden="true" /><span>{rate}×</span></button>
            <button className={sleepActive ? 'on' : ''} onClick={() => setShowSleepMenu((value) => !value)}>
              <Timer aria-hidden="true" /><span>{sleepLabel || 'Таймер'}</span>
            </button>
            <button onClick={() => onBookmark?.(currentTime)}><BookmarkPlus aria-hidden="true" /><span>Отметка</span></button>
          </div>

          {showSleepMenu && (
            <div className="car-sleep-options">
              <button onClick={disableSleepTimer}>Изкл.</button>
              {[15, 30, 60].map((minutes) => (
                <button key={minutes} onClick={() => chooseTimedSleep(minutes)}>{minutes} мин.</button>
              ))}
              {chapters.length > 0 && <button onClick={chooseChapterSleep}>Край на глава</button>}
              <button onClick={chooseStillnessSleep}>Без движение</button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
