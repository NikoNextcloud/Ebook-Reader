import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextInput from './components/TextInput';
import VoiceSelector from './components/VoiceSelector';
import SpeedControl from './components/SpeedControl';
import MusicSelector from './components/MusicSelector';
import SleepTimer from './components/SleepTimer';
import Library from './components/Library';
import ChapterSelector from './components/ChapterSelector';
import StoragePanel from './components/StoragePanel';
import Home from './components/Home';
import NowPlaying from './components/NowPlaying';
import AudioPlayer from './components/AudioPlayer';
import AudiobookPlayer from './components/AudiobookPlayer';
import { AmbientAudio } from './services/ambientAudio';
import {
  AUDIO_GESTURE_REQUIRED,
  GeminiTTS,
  splitTextForSpeech,
} from './services/geminiTtsService';
import {
  loadBooks, saveBook, updatePosition, updateTitle, removeBook, makeTitle, setBookField,
  addBookmark, removeBookmark, exportLibrary, importLibrary,
} from './services/library';
import { loadSettings, saveSettings } from './services/settings';
import { detectLanguage, langLabel } from './services/lang';
import { idbClear } from './services/idbCache';
import { addListening, getStats } from './services/stats';

const sample = 'Понякога най-добрите истории не чакат да бъдат написани. Те вече са тук — в статиите, които пазим, в бележките, към които се връщаме, и в думите, за които рядко намираме време. Voxora превръща всеки текст в лично аудио изживяване.';
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '◐', light: '☀', dark: '🌙' };

export default function App() {
  const initial = useRef(loadSettings()).current;
  const startBooks = useRef(loadBooks()).current;
  const [view, setView] = useState(startBooks.length ? 'home' : 'create');
  const [text, setTextState] = useState(sample);
  const [voice, setVoice] = useState(initial.voice);
  const [gender, setGender] = useState(initial.gender);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [rate, setRate] = useState(initial.rate);
  const [music, setMusic] = useState(initial.music);
  const [genre, setGenre] = useState(initial.genre);
  const [volume, setVolume] = useState(initial.volume);
  const [theme, setTheme] = useState(initial.theme);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [position, setPosition] = useState(null);
  const [message, setMessage] = useState('');
  const [previewing, setPreviewing] = useState('');
  const [playerOpen, setPlayerOpen] = useState(false);
  const [books, setBooks] = useState(startBooks);
  const [currentBookId, setCurrentBookId] = useState(null);
  const [activeChunk, setActiveChunk] = useState(-1);
  const [downloading, setDownloading] = useState(false);
  const [caching, setCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState(0);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepRemaining, setSleepRemaining] = useState(null);
  const [chapterMode, setChapterMode] = useState(false);
  const [chapters, setChapters] = useState(null);
  const [activeChapter, setActiveChapter] = useState(0);
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(() => getStats());
  const [voiceEnergy, setVoiceEnergy] = useState(0);
  const [audioBook, setAudioBook] = useState(null);

  const ambient = useRef(new AmbientAudio());
  const tts = useRef(new GeminiTTS());
  const previewTts = useRef(new GeminiTTS());
  const downloadTts = useRef(new GeminiTTS());
  const fileTitle = useRef('');
  const chaptersRef = useRef(null);
  const activeChapterRef = useRef(0);
  const chapterModeRef = useRef(false);
  const queueRef = useRef([]);
  const beginPlaybackRef = useRef(() => {});
  const openAndPlayRef = useRef(() => {});
  const audioBookUrls = useRef([]);

  const chunks = useMemo(() => splitTextForSpeech(text), [text]);
  const language = useMemo(() => detectLanguage(text), [text]);
  const words = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);
  const mins = Math.max(1, Math.ceil(words / (165 * rate)));
  const remainingMins = Math.max(0, Math.round(mins * (1 - progress / 100)));
  const heavy = chunks.length > 12;
  const refreshBooks = useCallback(() => setBooks(loadBooks()), []);

  const currentBook = useMemo(
    () => books.find((b) => b.id === currentBookId)
      || (currentBookId ? { id: currentBookId, title: fileTitle.current || makeTitle(text), text, chunkIndex: 0, bookmarks: [] } : null),
    [books, currentBookId, text],
  );

  useEffect(() => { chaptersRef.current = chapters; }, [chapters]);
  useEffect(() => { activeChapterRef.current = activeChapter; }, [activeChapter]);
  useEffect(() => { chapterModeRef.current = chapterMode; }, [chapterMode]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => () => {
    tts.current.stop();
    previewTts.current.stop();
    downloadTts.current.stop();
    ambient.current.stop();
    audioBookUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => ambient.current.setVolume(volume), [volume]);
  useEffect(() => localStorage.setItem('gemini_api_key', apiKey), [apiKey]);
  useEffect(() => saveSettings({ voice, gender, rate, music, genre, volume, theme }), [voice, gender, rate, music, genre, volume, theme]);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.setAttribute('data-theme', theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme);
    apply();
    if (theme === 'auto') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [theme]);
  useEffect(() => { if (status === 'speaking' && music) { ambient.current.start(genre); ambient.current.setVolume(volume); } }, [genre]);
  useEffect(() => {
    if (status !== 'speaking') return;
    if (music) { ambient.current.start(genre); ambient.current.setVolume(volume); } else ambient.current.stop();
  }, [music]);

  // Натрупване на време за статистиката, докато се слуша.
  useEffect(() => {
    if (status !== 'speaking') return undefined;
    const id = setInterval(() => addListening(1), 1000);
    return () => { clearInterval(id); setStats(getStats()); };
  }, [status]);

  const setText = (value) => {
    setTextState(value);
    if (currentBookId) setCurrentBookId(null);
    if (chapters) { setChapters(null); setActiveChapter(0); }
  };

  const ensureSaved = () => {
    const record = saveBook({ id: currentBookId, title: fileTitle.current, text });
    if (record) { setCurrentBookId(record.id); refreshBooks(); }
    return record;
  };

  const beginPlayback = async (sourceText, startChunk, bookId) => {
    if (!sourceText.trim()) return;
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключа, за да използваш AI гласовете.'); setPlayerOpen(false); return; }

    previewTts.current.stop();
    setPreviewing('');
    setPlayerOpen(true);
    setMessage('AI гласът се подготвя…');
    setStatus('loading');
    setProgress(0);
    setActiveChunk(startChunk || 0);

    try {
      await tts.current.unlockAudio().catch(() => {});
      if (music) { ambient.current.start(genre); ambient.current.setVolume(volume); }
      await tts.current.generate(sourceText, {
        apiKey: apiKey.trim(),
        voiceName: voice,
        gender,
        alternateVoices: true,
        rate,
        language,
        startChunk: startChunk || 0,
        onChunk: (index) => { setActiveChunk(index); if (bookId) updatePosition(bookId, index); },
        onPosition: (pos) => {
          setPosition(pos);
          if ('mediaSession' in navigator && pos.chunkDuration) {
            try {
              navigator.mediaSession.setPositionState({
                duration: pos.chunkDuration,
                position: Math.min(pos.chunkTime, pos.chunkDuration),
                playbackRate: rate,
              });
            } catch { /* игнорирай */ }
          }
        },
        onProgress: setProgress,
        onEnergy: setVoiceEnergy,
        onError: (error) => {
          ambient.current.stop();
          setVoiceEnergy(0);
          setStatus('error');
          setMessage(error.message || 'Четенето спря, защото следващата част не можа да се генерира.');
        },
        onEnd: () => {
          const chs = chaptersRef.current;
          const nextIdx = activeChapterRef.current + 1;

          // „Спри в края на главата“
          if (chs && chapterModeRef.current) {
            setStatus('paused');
            ambient.current.pause();
            setChapterMode(false);
            setMessage('Край на главата — таймерът за сън спря четенето. 🌙');
            return;
          }
          // Авто-продължаване към следващата глава
          if (chs && nextIdx < chs.length) {
            setProgress(0);
            setActiveChapter(nextIdx);
            setActiveChunk(0);
            setTextState(chs[nextIdx].text);
            setMessage(`▶ Глава ${nextIdx + 1}: ${chs[nextIdx].title}`);
            beginPlaybackRef.current(chs[nextIdx].text, 0, bookId);
            return;
          }
          // Край на книгата
          setProgress(100);
          setVoiceEnergy(0);
          setStatus('finished');
          ambient.current.stop();
          if (bookId) { updatePosition(bookId, 0); setBookField(bookId, { finished: true }); refreshBooks(); }
          setStats(getStats());

          // Следваща книга от опашката
          if (queueRef.current.length) {
            const [nextId, ...rest] = queueRef.current;
            setQueue(rest);
            const nb = loadBooks().find((b) => b.id === nextId);
            if (nb) { openAndPlayRef.current(nb); return; }
          }
          setPlayerOpen(false);
        },
      });
      setStatus('speaking');
      if (!chaptersRef.current) setMessage('');
    } catch (error) {
      ambient.current.stop();
      setVoiceEnergy(0);
      if (error?.code === AUDIO_GESTURE_REQUIRED) {
        setStatus('paused');
        setMessage(error.message);
        return;
      }
      setStatus('error');
      setMessage(error.message || 'Гласът не може да бъде генериран. Провери ключа.');
    }
  };
  beginPlaybackRef.current = beginPlayback;

  const loadBookState = (book) => {
    tts.current.stop();
    ambient.current.stop();
    setTextState(book.text);
    setChapters(null);
    setActiveChapter(0);
    fileTitle.current = book.title;
    setCurrentBookId(book.id);
    setProgress(0);
    setPosition(null);
    setActiveChunk(-1);
    setMessage('');
  };
  const openAndPlay = (book) => { loadBookState(book); beginPlayback(book.text, book.chunkIndex || 0, book.id); };
  openAndPlayRef.current = openAndPlay;

  const speak = async (fromStart) => {
    if (!text.trim()) return;
    if (status === 'paused' && !fromStart) {
      try {
        await tts.current.resume();
        ambient.current.resume();
        setMessage('');
        setStatus('speaking');
        setPlayerOpen(true);
      } catch (error) {
        setStatus('paused');
        setMessage(error.message || 'Телефонът блокира звука. Отвори страницата директно в Safari или Chrome и натисни Play.');
      }
      return;
    }
    const record = ensureSaved();
    await beginPlayback(text, 0, record?.id);
  };

  const retry = () => beginPlayback(text, tts.current.currentChunk || 0, currentBookId);

  const preview = async (name) => {
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключ, за да чуеш гласа.'); return; }
    previewTts.current.stop();
    setPreviewing(name);
    setVoice(name);
    try {
      await previewTts.current.unlockAudio().catch(() => {});
      await previewTts.current.generate('Здравей! Аз съм твоят разказвач. Така ще звучи текстът, който избереш.', {
        apiKey: apiKey.trim(), voiceName: name, rate: 1, language, singleChunk: true, onEnd: () => setPreviewing(''),
      });
    } catch (error) {
      setMessage(error.message || 'Пробата на гласа не може да се зареди.');
      setPreviewing('');
    }
  };

  const pause = () => { tts.current.pause(); ambient.current.pause(); setVoiceEnergy(0); setStatus('paused'); };
  const stop = () => { tts.current.stop(); ambient.current.stop(); setVoiceEnergy(0); setStatus('stopped'); setStats(getStats()); };
  const skip = (seconds) => tts.current.skip(seconds);
  const seek = (fraction) => tts.current.seekFraction(fraction);
  const next = () => tts.current.next();
  const prev = () => tts.current.prev();
  const changeSpeed = (value) => { setRate(value); tts.current.setPlaybackRate(value); };
  const cycleTheme = () => setTheme((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);

  // ——— Отметки ———
  const bookmark = () => {
    if (!currentBookId) return;
    addBookmark(currentBookId, tts.current.currentChunk || 0, `Част ${(tts.current.currentChunk || 0) + 1}`);
    refreshBooks();
    setMessage('Отметката е запазена. 🔖');
  };
  const jumpBookmark = (book, chunkIndex) => { openAndPlay({ ...book, chunkIndex }); };
  const jumpBookmarkHere = (chunkIndex) => tts.current.jumpToChunk(chunkIndex);
  const deleteBookmark = (id, chunkIndex) => { removeBookmark(id, chunkIndex); refreshBooks(); };

  // ——— Библиотека / карти ———
  const openBook = (book) => { setPlayerOpen(true); openAndPlay(book); };
  const deleteBook = (id) => { removeBook(id); if (id === currentBookId) setCurrentBookId(null); refreshBooks(); };
  const renameBook = (id, title) => { updateTitle(id, title); if (id === currentBookId) fileTitle.current = title; refreshBooks(); };
  const rateBook = (id, value) => { setBookField(id, { rating: value }); refreshBooks(); };
  const toggleFavorite = (book) => { setBookField(book.id, { favorite: !book.favorite }); refreshBooks(); };
  const toggleFinished = (book) => { setBookField(book.id, { finished: !book.finished }); refreshBooks(); };
  const enqueue = (book) => { setQueue((q) => (q.includes(book.id) ? q : [...q, book.id])); setMessage(`„${book.title}“ е добавена в опашката.`); };

  const onLoaded = ({ title, text: loadedText, chapters: loadedChapters, author, cover }) => {
    fileTitle.current = title;
    setChapters(loadedChapters || null);
    setActiveChapter(0);
    const record = saveBook({ title, text: loadedText, author, cover });
    if (record) { setCurrentBookId(record.id); refreshBooks(); }
  };
  const openAudioBook = ({ file, metadata, cover }) => {
    tts.current.stop();
    ambient.current.stop();
    setStatus('stopped');
    setPlayerOpen(false);
    audioBookUrls.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    const audioUrl = URL.createObjectURL(file);
    const coverUrl = cover ? URL.createObjectURL(cover) : '';
    audioBookUrls.current = [audioUrl, coverUrl].filter(Boolean);
    setAudioBook({
      title: metadata?.title || file.name.replace(/\.(m4b|m4a|mp3|aac)$/i, ''),
      author: metadata?.authors?.join(', ') || '',
      narrator: metadata?.narrators?.join(', ') || '',
      audioUrl,
      coverUrl,
      fileName: file.name,
    });
  };
  const closeAudioBook = () => {
    setAudioBook(null);
    audioBookUrls.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    audioBookUrls.current = [];
  };
  const selectChapter = (index) => {
    if (!chapters?.[index]) return;
    setActiveChapter(index);
    setTextState(chapters[index].text);
    setProgress(0);
    setPosition(null);
    setActiveChunk(-1);
    if (apiKey.trim()) beginPlayback(chapters[index].text, 0, currentBookId);
  };
  const saveCurrent = () => {
    const record = saveBook({ id: currentBookId, title: fileTitle.current || makeTitle(text), text });
    if (record) { setCurrentBookId(record.id); refreshBooks(); setMessage('Запазено в библиотеката.'); }
  };

  // ——— Сваляне / офлайн / резервно копие ———
  const download = async () => {
    if (!text.trim()) return;
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключ, за да свалиш аудиото.'); return; }
    setDownloading(true);
    setMessage('Подготвям аудио файла…');
    try {
      downloadTts.current.prepare(text, { apiKey: apiKey.trim(), voiceName: voice, gender, alternateVoices: true, rate, language });
      const blob = await downloadTts.current.downloadAll(() => {});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(fileTitle.current || makeTitle(text, 'voxora')).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'voxora'}.wav`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('Аудиото е свалено.');
    } catch (error) {
      setMessage(error.message || 'Свалянето се провали.');
    } finally {
      setDownloading(false);
    }
  };

  const cacheOffline = async () => {
    if (!text.trim()) return;
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключ, за да свалиш книгата офлайн.'); return; }
    setCaching(true);
    setCacheProgress(0);
    setMessage('Генерирам звука за офлайн слушане…');
    try {
      downloadTts.current.prepare(text, { apiKey: apiKey.trim(), voiceName: voice, gender, alternateVoices: true, rate, language });
      await downloadTts.current.cacheAll(setCacheProgress);
      if (currentBookId) { setBookField(currentBookId, { cachedOffline: true }); refreshBooks(); }
      setMessage('Книгата е готова за офлайн слушане. ✅');
    } catch (error) {
      setMessage(error.message || 'Офлайн свалянето се провали.');
    } finally {
      setCaching(false);
    }
  };

  const clearCache = async () => { await idbClear(); setMessage('Кешираният звук е изтрит.'); };
  const exportLib = () => {
    const blob = new Blob([exportLibrary()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'voxora-library.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const importLib = async (file) => {
    const ok = importLibrary(await file.text());
    setMessage(ok ? 'Библиотеката е импортирана.' : 'Файлът не е валидно резервно копие.');
    refreshBooks();
  };

  // ——— Таймер за сън (минути) ———
  useEffect(() => {
    if (!sleepMinutes) { setSleepRemaining(null); return undefined; }
    const deadline = Date.now() + sleepMinutes * 60000;
    setSleepRemaining(sleepMinutes * 60);
    const id = setInterval(() => {
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      setSleepRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        tts.current.pause();
        ambient.current.pause();
        setStatus((prev) => (prev === 'speaking' ? 'paused' : prev));
        setSleepMinutes(0);
        setMessage('Таймерът за сън спря четенето. 🌙');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [sleepMinutes]);

  // ——— Клавишни комбинации ———
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.code === 'Space') { event.preventDefault(); status === 'speaking' ? pause() : speak(false); }
      else if (event.code === 'ArrowLeft') skip(-15);
      else if (event.code === 'ArrowRight') skip(15);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, text, apiKey, voice, rate, language, music]);

  // ——— Медийни контроли ———
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: currentBook?.title || 'Voxora',
        artist: currentBook?.author || `Глас ${voice}`,
        album: 'Voxora AI Reader',
      });
    } catch { /* MediaMetadata може да липсва */ }
    navigator.mediaSession.playbackState = status === 'speaking' ? 'playing' : status === 'paused' ? 'paused' : 'none';
    const handlers = {
      play: () => speak(false),
      pause: () => pause(),
      stop: () => stop(),
      previoustrack: () => prev(),
      nexttrack: () => next(),
      seekbackward: () => skip(-15),
      seekforward: () => skip(15),
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* неподдържано */ }
    });
  }, [status, currentBookId, voice, books]);

  const wordFraction = position && position.chunk === activeChunk && position.chunkDuration
    ? position.chunkTime / position.chunkDuration
    : 0;

  return (
    <>
      <header className="minimal">
        <div className="header-right">
          {view === 'create' && books.length > 0 && (
            <button className="nav-home" onClick={() => { setView('home'); setStats(getStats()); }}>← Библиотека</button>
          )}
          <span className="status-dot">● Gemini AI Audio</span>
          <button className="theme-toggle" onClick={cycleTheme} aria-label={`Тема: ${theme}`} title={`Тема: ${theme}`}>{THEME_ICON[theme]}</button>
          <button className="profile" aria-label="Профил">В</button>
        </div>
      </header>

      {view === 'home' ? (
        <Home
          books={books}
          stats={stats}
          queue={queue}
          onOpen={openBook}
          onNew={() => { setView('create'); setText(''); setCurrentBookId(null); fileTitle.current = ''; }}
          onRate={rateBook}
          onToggleFavorite={toggleFavorite}
          onToggleFinished={toggleFinished}
          onQueue={enqueue}
          onRemove={deleteBook}
        />
      ) : (
        <main>
          <section className="hero">
            <div>
              <span className="eyebrow coral">ТВОИТЕ ДУМИ. ТВОЯТ РИТЪМ.</span>
              <h1>Превърни текста<br />в <em>изживяване.</em></h1>
              <p>Слушай всичко, за което не ти остава време да прочетеш.</p>
            </div>
            <div className="orb" aria-hidden="true"><i /><i /><i /><span>▶</span></div>
          </section>
          <div className="workspace">
            <TextInput text={text} setText={setText} onLoaded={onLoaded} onAudioLoaded={openAudioBook} />
            <aside className="card settings">
              <Library
                books={books}
                activeId={currentBookId}
                onOpen={(book) => { loadBookState(book); setView('create'); }}
                onResume={openBook}
                onRemove={deleteBook}
                onRename={renameBook}
                onJumpBookmark={jumpBookmark}
                onRemoveBookmark={deleteBookmark}
              />
              <ChapterSelector chapters={chapters} active={activeChapter} onSelect={selectChapter} />
              <VoiceSelector selected={voice} onSelect={setVoice} gender={gender} onGender={setGender} apiKey={apiKey} onApiKey={setApiKey} onPreview={preview} previewing={previewing} />
              {text.trim() && <p className="lang-badge">Разпознат език: <b>{langLabel(language)}</b></p>}
              <SpeedControl value={rate} onChange={setRate} />
              <MusicSelector enabled={music} setEnabled={setMusic} genre={genre} setGenre={setGenre} volume={volume} setVolume={setVolume} />
              <SleepTimer minutes={sleepMinutes} onChange={setSleepMinutes} remaining={sleepRemaining} chapterMode={chapterMode} onChapterMode={setChapterMode} hasChapters={!!(chapters && chapters.length > 1)} />
              <StoragePanel hasText={!!text.trim()} caching={caching} cacheProgress={cacheProgress} onCacheOffline={cacheOffline} onClearCache={clearCache} onExport={exportLib} onImport={importLib} />
              {heavy && <p className="quota-note">⚠ Дълъг текст: ~{chunks.length} AI заявки (~{mins} мин. звук). Може да изразходи дневния лимит наведнъж.</p>}
              {message && (
                <p className={`app-message ${status === 'error' ? 'error' : ''}`}>
                  {message}
                  {status === 'error' && <button className="retry" onClick={retry}>Опитай пак оттук</button>}
                </p>
              )}
              <div className="action-row">
                <button className="start" disabled={!text.trim() || status === 'loading'} onClick={() => speak(true)}>
                  <span>{status === 'loading' ? '…' : '▶'}</span>
                  <div>
                    <b>{status === 'loading' ? 'Генерирам AI гласа…' : 'Започни четенето'}</b>
                    <small>{words} думи · около {mins} мин.</small>
                  </div>
                </button>
                <button className="save-book" onClick={saveCurrent} disabled={!text.trim()} title="Запази в библиотеката">★</button>
              </div>
            </aside>
          </div>
        </main>
      )}

      {!playerOpen && currentBook && ['loading', 'speaking', 'paused'].includes(status) && (
        <AudioPlayer
          status={status}
          progress={progress}
          position={position}
          remainingMins={remainingMins}
          cover={currentBook.cover}
          onExpand={() => setPlayerOpen(true)}
          onPlay={() => speak(false)}
          onPause={pause}
          onStop={stop}
          onPrev={prev}
          onNext={next}
          onSkip={skip}
          onSeek={seek}
          onBookmark={bookmark}
          onDownload={download}
          downloading={downloading}
          disabled={!text.trim()}
        />
      )}
      {playerOpen && currentBook && (
        <NowPlaying
          book={currentBook}
          status={status}
          progress={progress}
          position={position}
          chapters={chapters}
          activeChapter={activeChapter}
          rate={rate}
          remainingMins={remainingMins}
          chunks={chunks}
          activeChunk={activeChunk}
          wordFraction={wordFraction}
          sleepMinutes={sleepMinutes}
          sleepRemaining={sleepRemaining}
          chapterMode={chapterMode}
          voiceEnergy={voiceEnergy}
          message={message}
          onClose={() => setPlayerOpen(false)}
          onPlay={() => speak(false)}
          onPause={pause}
          onStop={() => { stop(); setPlayerOpen(false); }}
          onPrev={prev}
          onNext={next}
          onSkip={skip}
          onSeek={seek}
          onRate={rateBook}
          onBookmark={bookmark}
          onSpeed={changeSpeed}
          onSelectChapter={selectChapter}
          onJumpBookmark={jumpBookmarkHere}
          onRemoveBookmark={(chunkIndex) => deleteBookmark(currentBook.id, chunkIndex)}
          onJumpChunk={(i) => tts.current.jumpToChunk(i)}
          onSleep={setSleepMinutes}
          onChapterMode={setChapterMode}
        />
      )}
      {audioBook && <AudiobookPlayer book={audioBook} onClose={closeAudioBook} />}
      {view === 'create' && <footer>VOXORA · Gemini AI гласове</footer>}
    </>
  );
}
