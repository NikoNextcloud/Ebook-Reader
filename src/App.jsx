import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextInput from './components/TextInput';
import VoiceSelector from './components/VoiceSelector';
import SpeedControl from './components/SpeedControl';
import MusicSelector from './components/MusicSelector';
import SleepTimer from './components/SleepTimer';
import Library from './components/Library';
import ChapterSelector from './components/ChapterSelector';
import AudioPlayer from './components/AudioPlayer';
import { AmbientAudio } from './services/ambientAudio';
import { GeminiTTS, splitTextForSpeech } from './services/geminiTtsService';
import { loadBooks, saveBook, updatePosition, updateTitle, removeBook, makeTitle } from './services/library';
import { loadSettings, saveSettings } from './services/settings';
import { detectLanguage, langLabel } from './services/lang';

const sample = 'Понякога най-добрите истории не чакат да бъдат написани. Те вече са тук — в статиите, които пазим, в бележките, към които се връщаме, и в думите, за които рядко намираме време. Voxora превръща всеки текст в лично аудио изживяване.';
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '◐', light: '☀', dark: '🌙' };

export default function App() {
  const initial = useRef(loadSettings()).current;
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
  const [focusMode, setFocusMode] = useState(false);
  const [books, setBooks] = useState(() => loadBooks());
  const [currentBookId, setCurrentBookId] = useState(null);
  const [activeChunk, setActiveChunk] = useState(-1);
  const [downloading, setDownloading] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  const [sleepRemaining, setSleepRemaining] = useState(null);
  const [chapters, setChapters] = useState(null);
  const [activeChapter, setActiveChapter] = useState(0);

  const ambient = useRef(new AmbientAudio());
  const tts = useRef(new GeminiTTS());
  const previewTts = useRef(new GeminiTTS());
  const downloadTts = useRef(new GeminiTTS());
  const fileTitle = useRef('');
  const activeSpan = useRef(null);

  const chunks = useMemo(() => splitTextForSpeech(text), [text]);
  const language = useMemo(() => detectLanguage(text), [text]);
  const words = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);
  const mins = Math.max(1, Math.ceil(words / (165 * rate)));
  const refreshBooks = useCallback(() => setBooks(loadBooks()), []);

  useEffect(() => () => {
    tts.current.stop();
    previewTts.current.stop();
    downloadTts.current.stop();
    ambient.current.stop();
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
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключа, за да използваш AI гласовете.'); return; }

    previewTts.current.stop();
    setPreviewing('');
    setFocusMode(true);
    setMessage('AI гласът се подготвя…');
    setStatus('loading');
    setProgress(0);
    setActiveChunk(startChunk || 0);

    try {
      if (music) { ambient.current.start(genre); ambient.current.setVolume(volume); }
      await tts.current.generate(sourceText, {
        apiKey: apiKey.trim(),
        voiceName: voice,
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
        onError: (error) => {
          ambient.current.stop();
          setFocusMode(false);
          setStatus('error');
          setMessage(error.message || 'Четенето спря, защото следващата част не можа да се генерира.');
        },
        onEnd: () => {
          setProgress(100);
          setStatus('finished');
          setFocusMode(false);
          ambient.current.stop();
          if (bookId) updatePosition(bookId, 0);
        },
      });
      setStatus('speaking');
      setMessage('');
    } catch (error) {
      ambient.current.stop();
      setFocusMode(false);
      setStatus('error');
      setMessage(error.message || 'Гласът не може да бъде генериран. Провери ключа.');
    }
  };

  const speak = async (fromStart) => {
    if (!text.trim()) return;
    if (status === 'paused' && !fromStart) {
      await tts.current.resume();
      ambient.current.resume();
      setStatus('speaking');
      setFocusMode(true);
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
      await previewTts.current.generate('Здравей! Аз съм твоят разказвач. Така ще звучи текстът, който избереш.', {
        apiKey: apiKey.trim(), voiceName: name, rate: 1, language, singleChunk: true, onEnd: () => setPreviewing(''),
      });
    } catch (error) {
      setMessage(error.message || 'Пробата на гласа не може да се зареди.');
      setPreviewing('');
    }
  };

  const pause = () => { tts.current.pause(); ambient.current.pause(); setStatus('paused'); };
  const stop = () => { tts.current.stop(); ambient.current.stop(); setFocusMode(false); setStatus('stopped'); };
  const restart = () => speak(true);
  const skip = (seconds) => tts.current.skip(seconds);
  const seek = (fraction) => tts.current.seekFraction(fraction);
  const next = () => tts.current.next();
  const prev = () => tts.current.prev();
  const cycleTheme = () => setTheme((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);

  // ——— Библиотека ———
  const openBook = (book) => {
    tts.current.stop();
    ambient.current.stop();
    setTextState(book.text);
    setChapters(null);
    setActiveChapter(0);
    fileTitle.current = book.title;
    setCurrentBookId(book.id);
    setStatus('idle');
    setProgress(0);
    setPosition(null);
    setActiveChunk(-1);
    setMessage('');
  };
  const resumeBook = (book) => { openBook(book); beginPlayback(book.text, book.chunkIndex || 0, book.id); };
  const deleteBook = (id) => { removeBook(id); if (id === currentBookId) setCurrentBookId(null); refreshBooks(); };
  const renameBook = (id, title) => { updateTitle(id, title); if (id === currentBookId) fileTitle.current = title; refreshBooks(); };
  const onLoaded = ({ title, text: loadedText, chapters: loadedChapters }) => {
    fileTitle.current = title;
    setChapters(loadedChapters || null);
    setActiveChapter(0);
    const record = saveBook({ title, text: loadedText });
    if (record) { setCurrentBookId(record.id); refreshBooks(); }
  };
  const selectChapter = (index) => {
    if (!chapters?.[index]) return;
    tts.current.stop();
    ambient.current.stop();
    setActiveChapter(index);
    setTextState(chapters[index].text);
    setStatus('idle');
    setProgress(0);
    setPosition(null);
    setActiveChunk(-1);
  };
  const saveCurrent = () => {
    const record = saveBook({ id: currentBookId, title: fileTitle.current || makeTitle(text), text });
    if (record) { setCurrentBookId(record.id); refreshBooks(); setMessage('Запазено в библиотеката — можеш да редактираш заглавието с ✎.'); }
  };

  // ——— Сваляне на аудиото ———
  const download = async () => {
    if (!text.trim()) return;
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключ, за да свалиш аудиото.'); return; }
    setDownloading(true);
    setMessage('Подготвям аудио файла… (може да отнеме време при дълъг текст)');
    try {
      downloadTts.current.prepare(text, { apiKey: apiKey.trim(), voiceName: voice, rate, language });
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
      setMessage(error.message || 'Свалянето се провали. Опитай отново.');
    } finally {
      setDownloading(false);
    }
  };

  // ——— Таймер за сън ———
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

  // ——— Медийни контроли на заключен екран / слушалки ———
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const book = books.find((item) => item.id === currentBookId);
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: book?.title || fileTitle.current || 'Voxora',
        artist: `Глас ${voice}`,
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

  useEffect(() => {
    if (focusMode && activeSpan.current) activeSpan.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeChunk, focusMode]);

  return (
    <>
      <header>
        <a className="brand" href="#top"><span>V</span>VOXORA</a>
        <div className="header-right">
          <span className="status-dot">● Gemini AI Audio</span>
          <button className="theme-toggle" onClick={cycleTheme} aria-label={`Тема: ${theme}`} title={`Тема: ${theme}`}>{THEME_ICON[theme]}</button>
          <button className="profile" aria-label="Профил">В</button>
        </div>
      </header>
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
          <TextInput text={text} setText={setText} onLoaded={onLoaded} />
          <aside className="card settings">
            <Library books={books} activeId={currentBookId} onOpen={openBook} onResume={resumeBook} onRemove={deleteBook} onRename={renameBook} />
            <ChapterSelector chapters={chapters} active={activeChapter} onSelect={selectChapter} />
            <VoiceSelector selected={voice} onSelect={setVoice} gender={gender} onGender={setGender} apiKey={apiKey} onApiKey={setApiKey} onPreview={preview} previewing={previewing} />
            {text.trim() && <p className="lang-badge">Разпознат език: <b>{langLabel(language)}</b></p>}
            <SpeedControl value={rate} onChange={setRate} />
            <MusicSelector enabled={music} setEnabled={setMusic} genre={genre} setGenre={setGenre} volume={volume} setVolume={setVolume} />
            <SleepTimer minutes={sleepMinutes} onChange={setSleepMinutes} remaining={sleepRemaining} />
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
      <AudioPlayer
        status={status}
        progress={progress}
        position={position}
        onPlay={() => speak(false)}
        onPause={pause}
        onStop={stop}
        onRestart={restart}
        onPrev={prev}
        onNext={next}
        onSkip={skip}
        onSeek={seek}
        onDownload={download}
        downloading={downloading}
        disabled={!text.trim()}
      />
      {focusMode && (
        <div className="listening-overlay" onClick={() => setFocusMode(false)}>
          <div
            className={`pulse-reader ${status === 'paused' ? 'paused' : ''}`}
            style={{ '--pulse-speed': `${Math.max(0.65, 1.45 / rate)}s` }}
            onClick={(event) => event.stopPropagation()}
          >
            <i /><i /><i />
            <div className="pulse-core">
              <span>{status === 'loading' ? '…' : status === 'paused' ? 'Ⅱ' : '◖'}</span>
              <b>{status === 'loading' ? 'Подготвям гласа' : status === 'paused' ? 'На пауза' : 'Слушай'}</b>
              <small>{Math.round(progress)}%</small>
            </div>
          </div>
          {chunks.length > 0 && (
            <div className="reading-view" onClick={(event) => event.stopPropagation()}>
              <div className="reading-title">
                <span>Следи текста</span>
                <span>{Math.min(activeChunk + 1, chunks.length)} / {chunks.length}</span>
              </div>
              <p>
                {chunks.map((chunk, index) => (
                  <span
                    key={index}
                    ref={index === activeChunk ? activeSpan : null}
                    className={index === activeChunk ? 'current-word' : index < activeChunk ? 'read-word' : ''}
                    onClick={() => tts.current.jumpToChunk(index)}
                  >
                    {chunk}{' '}
                  </span>
                ))}
              </p>
            </div>
          )}
          <p className="overlay-hint">Натисни извън карето, за да редактираш · докосни изречение, за да прескочиш</p>
        </div>
      )}
      <footer>VOXORA · Gemini AI гласове</footer>
    </>
  );
}
