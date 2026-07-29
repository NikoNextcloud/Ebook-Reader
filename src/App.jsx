import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextInput from './components/TextInput';
import VoiceSelector from './components/VoiceSelector';
import SpeedControl from './components/SpeedControl';
import MusicSelector from './components/MusicSelector';
import SleepTimer from './components/SleepTimer';
import Library from './components/Library';
import ChapterSelector from './components/ChapterSelector';
import StoragePanel from './components/StoragePanel';
import StorageManager from './components/StorageManager';
import Home from './components/Home';
import NowPlaying from './components/NowPlaying';
import AudioPlayer from './components/AudioPlayer';
import AudiobookPlayer from './components/AudiobookPlayer';
import AdminPanel from './components/AdminPanel';
import { AmbientAudio } from './services/ambientAudio';
import {
  AUDIO_GESTURE_REQUIRED,
  GeminiTTS,
  splitTextForSpeech,
} from './services/geminiTtsService';
import {
  loadBooks, saveBook, saveAudioBook, updatePosition, updateAudioPosition,
  updateTitle, removeBook, makeTitle, setBookField, addBookmark, removeBookmark,
  addAudioBookmark, removeAudioBookmark, exportLibrary, importLibrary,
  getLibraryWriteError, clearLibraryWriteError,
} from './services/library';
import {
  audioStreamUrl, downloadRemoteItem, isMegaUrl, openRemoteCatalog,
} from './services/remoteBooks';
import { setRemoteFavorite } from './services/remoteFavorites';
import { loadSettings, saveSettings } from './services/settings';
import { detectLanguage, langLabel } from './services/lang';
import { idbClear } from './services/idbCache';
import {
  audioBookCacheKey,
  cacheAudioBook,
  loadOfflineSettings,
  loadCachedAudioBook,
  pruneAudioBookCache,
  removeCachedAudioBook,
} from './services/audiobookCache';
import { addListening, flushListening, getStats } from './services/stats';
import { prepareCoverImage } from './services/coverImage';
import {
  loadM4bDetails,
  normalizeAudioChapters,
} from './services/m4bChapters';
import {
  ACCESS_BLOCKED_EVENT,
  reportListenerActivity,
} from './services/listenerPresence';

const STILLNESS_MINUTES = 15;

const sample = 'Понякога най-добрите истории не чакат да бъдат написани. Те вече са тук — в статиите, които пазим, в бележките, към които се връщаме, и в думите, за които рядко намираме време. Voxora превръща всеки текст в лично аудио изживяване.';

export default function App() {
  const initial = useRef(loadSettings()).current;
  const startBooks = useRef(loadBooks()).current;
  const [view, setView] = useState(startBooks.length ? 'home' : 'create');
  const [text, setTextState] = useState(sample);
  const [alternateVoices, setAlternateVoices] = useState(initial.alternateVoices !== false);
  const [voice, setVoice] = useState(initial.voice);
  const [gender, setGender] = useState(initial.gender);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [rate, setRate] = useState(initial.rate);
  const [music, setMusic] = useState(initial.music);
  const [genre, setGenre] = useState(initial.genre);
  const [volume, setVolume] = useState(initial.volume);
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
  const [motionSleep, setMotionSleep] = useState(false);
  const [chapters, setChapters] = useState(null);
  const [activeChapter, setActiveChapter] = useState(0);
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(() => getStats());
  const [voiceEnergy, setVoiceEnergy] = useState(0);
  const [audioBook, setAudioBook] = useState(null);
  const [editorReady, setEditorReady] = useState(false);
  const [draftCover, setDraftCover] = useState('');
  const [storageOpen, setStorageOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const ambient = useRef(new AmbientAudio());
  const geminiTts = useRef(new GeminiTTS());
  const geminiPreviewTts = useRef(new GeminiTTS());
  const geminiDownloadTts = useRef(new GeminiTTS());
  const tts = geminiTts;
  const previewTts = geminiPreviewTts;
  const downloadTts = geminiDownloadTts;
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
  const refreshBooks = useCallback(() => {
    setBooks(loadBooks());
    // Ако паметта на браузъра е препълнена, казваме го вместо да губим позиция мълчаливо.
    const storageError = getLibraryWriteError();
    if (storageError) {
      setMessage(storageError);
      clearLibraryWriteError();
    }
  }, []);

  const currentBook = useMemo(
    () => books.find((b) => b.id === currentBookId)
      || (currentBookId ? {
        id: currentBookId,
        title: fileTitle.current || makeTitle(text),
        text,
        cover: draftCover,
        chunkIndex: 0,
        bookmarks: [],
      } : null),
    [books, currentBookId, draftCover, text],
  );
  const textPresenceRef = useRef(null);
  textPresenceRef.current = currentBook ? {
    state: status === 'speaking'
      ? 'playing'
      : status === 'paused'
        ? 'paused'
        : 'stopped',
    book: {
      id: currentBook.id,
      title: currentBook.title,
      type: 'text',
    },
    position: (mins * 60 * progress) / 100,
    duration: mins * 60,
  } : null;

  useEffect(() => { chaptersRef.current = chapters; }, [chapters]);
  useEffect(() => { activeChapterRef.current = activeChapter; }, [activeChapter]);
  useEffect(() => { chapterModeRef.current = chapterMode; }, [chapterMode]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => {
    if (view !== 'create') setEditorReady(false);
  }, [view]);

  useEffect(() => () => {
    geminiTts.current.stop();
    geminiPreviewTts.current.stop();
    geminiDownloadTts.current.stop();
    ambient.current.stop();
    audioBookUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => ambient.current.setVolume(volume), [volume]);
  useEffect(() => localStorage.setItem('gemini_api_key', apiKey), [apiKey]);
  useEffect(() => saveSettings({
    alternateVoices,
    voice,
    gender,
    rate,
    music,
    genre,
    volume,
  }), [
    alternateVoices,
    voice,
    gender,
    rate,
    music,
    genre,
    volume,
  ]);
  // Приложението има една премиум тема — няма превключвател светло/тъмно.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'premium');
  }, []);
  useEffect(() => { if (status === 'speaking' && music) { ambient.current.start(genre); ambient.current.setVolume(volume); } }, [genre]);
  useEffect(() => {
    if (status !== 'speaking') return;
    if (music) { ambient.current.start(genre); ambient.current.setVolume(volume); } else ambient.current.stop();
  }, [music]);

  // Натрупване на време за статистиката, докато се слуша.
  useEffect(() => {
    if (status !== 'speaking') return undefined;
    const id = setInterval(() => addListening(1), 1000);
    return () => { clearInterval(id); flushListening(); setStats(getStats()); };
  }, [status]);

  useEffect(() => {
    if (audioBook || !currentBook || !['speaking', 'paused', 'stopped'].includes(status)) {
      return undefined;
    }
    const report = () => reportListenerActivity(textPresenceRef.current);
    report();
    if (status !== 'speaking') return undefined;
    const timer = window.setInterval(report, 15000);
    return () => window.clearInterval(timer);
  }, [audioBook, currentBook?.id, status]);

  useEffect(() => {
    const onAccessBlocked = (event) => {
      geminiTts.current.stop();
      ambient.current.stop();
      setVoiceEnergy(0);
      setStatus('stopped');
      setMessage(event.detail?.message || 'Достъпът на това устройство е спрян.');
    };
    window.addEventListener(ACCESS_BLOCKED_EVENT, onAccessBlocked);
    return () => window.removeEventListener(ACCESS_BLOCKED_EVENT, onAccessBlocked);
  }, []);

  const setText = (value) => {
    setTextState(value);
    if (currentBookId) setCurrentBookId(null);
    if (chapters) { setChapters(null); setActiveChapter(0); }
  };

  const ensureSaved = () => {
    const record = saveBook({
      id: currentBookId,
      title: fileTitle.current,
      text,
      cover: draftCover,
    });
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
        alternateVoices,
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
    setDraftCover(book.cover || '');
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
        apiKey: apiKey.trim(),
        voiceName: name,
        alternateVoices: false,
        rate: 1,
        language,
        singleChunk: true,
        onEnd: () => setPreviewing(''),
      });
    } catch (error) {
      setMessage(error.message || 'Пробата на гласа не може да се зареди.');
      setPreviewing('');
    }
  };

  const pause = () => { tts.current.pause(); ambient.current.pause(); setVoiceEnergy(0); setStatus('paused'); flushListening(); setStats(getStats()); };
  const stop = () => { tts.current.stop(); ambient.current.stop(); setVoiceEnergy(0); setStatus('stopped'); flushListening(); setStats(getStats()); };
  const skip = (seconds) => tts.current.skip(seconds);
  const seek = (fraction) => tts.current.seekFraction(fraction);
  const next = () => tts.current.next();
  const prev = () => tts.current.prev();
  const changeSpeed = (value) => { setRate(value); tts.current.setPlaybackRate(value); };

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
  const openTextBook = (book) => { setPlayerOpen(true); openAndPlay(book); };
  const deleteBook = (id) => {
    const removed = books.find((book) => book.id === id);
    if (removed?.mediaType === 'audio') removeCachedAudioBook(removed);
    removeBook(id);
    if (id === currentBookId) setCurrentBookId(null);
    refreshBooks();
  };
  const renameBook = (id, title) => { updateTitle(id, title); if (id === currentBookId) fileTitle.current = title; refreshBooks(); };
  const rateBook = (id, value) => { setBookField(id, { rating: value }); refreshBooks(); };
  const toggleFavorite = (book) => {
    const next = !book.favorite;
    setBookField(book.id, { favorite: next });
    if (book.remoteKey) setRemoteFavorite(book.remoteKey, next);
    refreshBooks();
  };
  const toggleFinished = (book) => { setBookField(book.id, { finished: !book.finished }); refreshBooks(); };
  const enqueue = (book) => { setQueue((q) => (q.includes(book.id) ? q : [...q, book.id])); setMessage(`„${book.title}“ е добавена в опашката.`); };
  const changeBookCover = async (book, file) => {
    try {
      const cover = await prepareCoverImage(file);
      setBookField(book.id, { cover, updatedAt: Date.now() });
      if (book.id === currentBookId) setDraftCover(cover);
      refreshBooks();
      setMessage(`Корицата на „${book.title}“ е обновена.`);
      return cover;
    } catch (error) {
      setMessage(error.message || 'Корицата не може да бъде добавена.');
      throw error;
    }
  };
  const changeDraftCover = async (file, options = {}) => {
    const cover = options.prepared ? file : await prepareCoverImage(file);
    setDraftCover(cover || '');
    if (currentBookId) {
      setBookField(currentBookId, { cover: cover || '', updatedAt: Date.now() });
      refreshBooks();
    }
    return cover;
  };
  const clearDraftCover = () => {
    setDraftCover('');
    if (currentBookId) {
      setBookField(currentBookId, { cover: '', updatedAt: Date.now() });
      refreshBooks();
    }
  };

  const onLoaded = ({
    title, text: loadedText, chapters: loadedChapters, author, cover,
    favorite, source, sourceUrl, remoteKey,
  }) => {
    const nextCover = cover || draftCover || '';
    fileTitle.current = title;
    setDraftCover(nextCover);
    setChapters(loadedChapters || null);
    setActiveChapter(0);
    const record = saveBook({
      title,
      text: loadedText,
      author,
      cover: nextCover,
      favorite,
      source,
      sourceUrl,
      remoteKey,
    });
    if (record) { setCurrentBookId(record.id); refreshBooks(); }
  };
  const openAudioBook = ({ file, streamUrl, name, metadata, cover }, context = {}) => {
    tts.current.stop();
    ambient.current.stop();
    setStatus('stopped');
    setPlayerOpen(false);
    audioBookUrls.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    // При поток няма локален файл — плеърът чете направо от сървъра.
    const sourceBook = context.book || context.item || {};
    const audioUrl = streamUrl || URL.createObjectURL(file);
    const coverSource = sourceBook.cover || cover || '';
    const generatedCoverUrl = coverSource instanceof Blob ? URL.createObjectURL(coverSource) : '';
    const coverUrl = generatedCoverUrl || coverSource;
    audioBookUrls.current = [streamUrl ? '' : audioUrl, generatedCoverUrl].filter(Boolean);
    const fileName = file?.name || name || '';
    const title = metadata?.title
      || sourceBook.title
      || sourceBook.name?.replace(/\.(m4b|m4a|mp3|aac)$/i, '')
      || fileName.replace(/\.(m4b|m4a|mp3|aac)$/i, '');
    const sourceUrl = sourceBook.url || context.item?.url || '';
    const knownAudioChapters = normalizeAudioChapters(
      sourceBook.audioChapters || metadata?.chapters || metadata?.chapterMarkers,
    );
    const transcriptText = sourceBook.transcriptText
      || metadata?.transcriptText
      || metadata?.transcript
      || '';
    const transcriptCues = sourceBook.transcriptCues || metadata?.transcriptCues || [];
    const record = saveAudioBook({
      id: context.libraryId,
      title,
      author: metadata?.authors?.join(', ') || context.author || '',
      narrator: metadata?.narrators?.join(', ') || '',
      fileName,
      source: context.source || 'mega',
      sourceUrl,
      remoteKey: context.remoteKey,
      category: sourceBook.category || context.item?.category || '',
      favorite: context.favorite,
      cover: typeof coverSource === 'string' ? coverSource : undefined,
      audioChapters: knownAudioChapters,
      series: metadata?.series,
      genre: metadata?.genre,
      year: metadata?.year,
      description: metadata?.description,
      codec: metadata?.codec,
      transcriptText,
      transcriptCues,
    });
    const stableRemoteKey = record?.remoteKey
      || (record?.source === 'local' && record?.id ? `local:${record.id}` : '');
    if (record) {
      if (stableRemoteKey && stableRemoteKey !== record.remoteKey) {
        setBookField(record.id, { remoteKey: stableRemoteKey });
        record.remoteKey = stableRemoteKey;
      }
      refreshBooks();
      if (coverSource instanceof Blob && !sourceBook.cover) {
        prepareCoverImage(coverSource).then((storedCover) => {
          setBookField(record.id, { cover: storedCover });
          refreshBooks();
          setAudioBook((current) => (
            current?.id === record.id ? { ...current, coverUrl: storedCover } : current
          ));
        }).catch(() => {
          // Временната Blob корица остава видима в текущата сесия.
        });
      }
      if (file && !context.fromCache && ['mega', 'local'].includes(record.source || context.source)) {
        cacheAudioBook({
          remoteKey: stableRemoteKey,
          sourceUrl: record.sourceUrl,
          file,
          metadata,
          cover,
        }).then((cached) => {
          if (cached) {
            setBookField(record.id, { audioCached: true });
            refreshBooks();
          }
          setAudioBook((current) => (current?.id === record.id ? {
            ...current,
            cacheNotice: cached
              ? 'Запазена е за бързо продължаване при следващо отваряне.'
              : 'Няма достатъчно свободна памет за бързо офлайн зареждане.',
          } : current));
        });
      }
    }
    setAudioBook({
      id: record?.id,
      title,
      author: metadata?.authors?.join(', ') || record?.author || '',
      narrator: metadata?.narrators?.join(', ') || record?.narrator || '',
      audioUrl,
      coverUrl,
      fileName,
      favorite: !!record?.favorite,
      initialTime: record?.audioPosition || 0,
      audioBookmarks: record?.audioBookmarks || [],
      sourceUrl: record?.sourceUrl || '',
      remoteKey: stableRemoteKey || record?.remoteKey || '',
      cacheNotice: context.fromCache ? 'Заредена е директно от паметта на телефона.' : '',
      chapters: knownAudioChapters,
      transcriptText: record?.transcriptText || transcriptText,
      transcriptCues: record?.transcriptCues || transcriptCues,
      audioProfile: record?.audioProfile || 'natural',
      audioBass: record?.audioBass || 0,
      audioClarity: record?.audioClarity || 0,
      audioNormalize: !!record?.audioNormalize,
      offlineChapters: record?.offlineChapters || [],
      offlineAutoNext: record?.offlineAutoNext !== false,
      offlineAutoClean: record?.offlineAutoClean !== false,
      audioCached: !!record?.audioCached,
      metadata: {
        series: record?.series || '',
        genre: record?.genre || '',
        year: record?.year || '',
        description: record?.description || '',
        codec: record?.codec || '',
      },
    });
    if (/\.(m4b|m4a|mp4)$/i.test(fileName)) {
      loadM4bDetails({
        file,
        url: audioUrl,
        metadata,
        savedChapters: sourceBook.audioChapters,
      }).then(async (details) => {
        const embedded = details.metadata || {};
        const audioChapters = details.chapters || [];
        const storedCover = details.cover
          ? await prepareCoverImage(details.cover).catch(() => '')
          : '';
        const patch = {
          audioChapters,
          title: embedded.title || record?.title || title,
          author: embedded.authors?.join(', ') || record?.author || '',
          narrator: embedded.narrators?.join(', ') || record?.narrator || '',
          series: embedded.series || record?.series || '',
          genre: embedded.genre || record?.genre || '',
          year: embedded.year || record?.year || '',
          description: embedded.description || record?.description || '',
          codec: embedded.codec || record?.codec || '',
        };
        if (storedCover && !sourceBook.cover && !cover) patch.cover = storedCover;
        if (record?.id) {
          setBookField(record.id, patch);
          refreshBooks();
        }
        setAudioBook((current) => (
          current?.audioUrl === audioUrl ? {
            ...current,
            title: patch.title,
            author: patch.author,
            narrator: patch.narrator,
            chapters: audioChapters,
            coverUrl: storedCover || current.coverUrl,
            metadata: {
              series: patch.series,
              genre: patch.genre,
              year: patch.year,
              description: patch.description,
              codec: patch.codec,
            },
          } : current
        ));
      });
    }
  };
  const closeAudioBook = (currentTime, duration) => {
    if (audioBook?.id) updateAudioPosition(audioBook.id, currentTime, duration);
    setAudioBook(null);
    audioBookUrls.current.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    audioBookUrls.current = [];
    refreshBooks();
  };
  const refreshAudioBook = (id) => {
    const saved = loadBooks().find((book) => book.id === id);
    if (saved) {
      setAudioBook((current) => (current?.id === id ? {
        ...current,
        favorite: !!saved.favorite,
        audioBookmarks: saved.audioBookmarks || [],
        chapters: saved.audioChapters || current.chapters || [],
        transcriptText: saved.transcriptText || '',
        transcriptCues: saved.transcriptCues || [],
        audioProfile: saved.audioProfile || 'natural',
        audioBass: saved.audioBass || 0,
        audioClarity: saved.audioClarity || 0,
        audioNormalize: !!saved.audioNormalize,
        offlineChapters: saved.offlineChapters || [],
        offlineAutoNext: saved.offlineAutoNext !== false,
        offlineAutoClean: saved.offlineAutoClean !== false,
        audioCached: !!saved.audioCached,
        metadata: {
          series: saved.series || '',
          genre: saved.genre || '',
          year: saved.year || '',
          description: saved.description || '',
          codec: saved.codec || '',
        },
      } : current));
    }
    refreshBooks();
  };
  const toggleAudioFavorite = () => {
    if (!audioBook?.id) return;
    const next = !audioBook.favorite;
    setBookField(audioBook.id, { favorite: next });
    if (audioBook.remoteKey) setRemoteFavorite(audioBook.remoteKey, next);
    refreshAudioBook(audioBook.id);
  };
  const bookmarkAudio = (time) => {
    if (!audioBook?.id) return;
    addAudioBookmark(audioBook.id, time);
    refreshAudioBook(audioBook.id);
  };
  const deleteAudioBookmark = (time) => {
    if (!audioBook?.id) return;
    removeAudioBookmark(audioBook.id, time);
    refreshAudioBook(audioBook.id);
  };
  const saveAudioTranscript = ({ text: transcriptText, cues: transcriptCues }) => {
    if (!audioBook?.id) return;
    setBookField(audioBook.id, { transcriptText, transcriptCues, updatedAt: Date.now() });
    refreshAudioBook(audioBook.id);
    setMessage('Синхронизираният текст е запазен към аудиокнигата.');
  };
  const saveAudioSettings = (settings) => {
    if (!audioBook?.id) return;
    setBookField(audioBook.id, { ...settings, updatedAt: Date.now() });
    refreshAudioBook(audioBook.id);
  };
  const saveOfflineSettings = (settings) => {
    if (!audioBook?.id) return;
    setBookField(audioBook.id, { ...settings, updatedAt: Date.now() });
    refreshAudioBook(audioBook.id);
  };
  const cacheCurrentAudioBook = async (onProgress) => {
    if (!audioBook?.id || !audioBook.audioUrl) return false;
    if (audioBook.audioCached) return true;
    const response = await fetch(audioBook.audioUrl);
    if (!response.ok) throw new Error(`Офлайн изтеглянето върна HTTP ${response.status}.`);
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body?.getReader();
    const chunks = [];
    let loaded = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        if (total) onProgress?.(Math.min(99, Math.round((loaded / total) * 100)));
      }
    } else {
      chunks.push(new Uint8Array(await response.arrayBuffer()));
    }
    const type = response.headers.get('content-type') || 'audio/mp4';
    const file = new window.File(chunks, audioBook.fileName || 'audiobook.m4b', { type });
    const cacheIdentity = audioBook.remoteKey || `library:${audioBook.id}`;
    const cached = await cacheAudioBook({
      remoteKey: cacheIdentity,
      sourceUrl: audioBook.sourceUrl,
      file,
      metadata: {
        title: audioBook.title,
        authors: audioBook.author ? [audioBook.author] : [],
        narrators: audioBook.narrator ? [audioBook.narrator] : [],
        chapters: audioBook.chapters,
      },
      cover: audioBook.coverUrl,
    });
    if (!cached) return false;
    setBookField(audioBook.id, {
      audioCached: true,
      remoteKey: cacheIdentity,
      updatedAt: Date.now(),
    });
    setAudioBook((current) => (current ? {
      ...current,
      audioCached: true,
      remoteKey: cacheIdentity,
    } : current));
    if (audioBook.offlineAutoClean !== false && loadOfflineSettings().autoClean) {
      const removed = await pruneAudioBookCache({
        protectedKeys: [audioBookCacheKey(cacheIdentity, audioBook.sourceUrl)],
      });
      removed.forEach((entry) => {
        const removedBook = books.find((book) => (
          (entry.remoteKey && book.remoteKey === entry.remoteKey)
          || (entry.sourceUrl && book.sourceUrl === entry.sourceUrl)
        ));
        if (removedBook?.id) setBookField(removedBook.id, { audioCached: false });
      });
    }
    refreshBooks();
    onProgress?.(100);
    return true;
  };
  const resumeAudioBook = async (book) => {
    if (audioBook?.id === book.id) return;
    setMessage(`Проверявам запазеното аудио за „${book.title}“…`);
    try {
      const cached = await loadCachedAudioBook(book);
      if (cached) {
        openAudioBook(cached, {
          book,
          libraryId: book.id,
          favorite: book.favorite,
          remoteKey: book.remoteKey,
          source: book.source,
          fromCache: true,
        });
        setMessage('Аудиокнигата е заредена бързо от паметта на телефона.');
        return;
      }
      if (!book.sourceUrl) {
        setMessage('Локалният аудиофайл вече не е в офлайн паметта. Избери го отново.');
        setView('create');
        return;
      }
      // Mega книгите се пускат на поток — тръгват веднага, без сваляне.
      if (isMegaUrl(book.sourceUrl)) {
        openAudioBook(
          { streamUrl: audioStreamUrl(book.sourceUrl, book.fileName), name: book.fileName || book.title },
          {
            book,
            libraryId: book.id,
            favorite: book.favorite,
            remoteKey: book.remoteKey,
            source: book.source,
          },
        );
        setMessage('');
        return;
      }

      setMessage(`Зареждам „${book.title}“ от Storytel…`);
      const catalog = await openRemoteCatalog(book.sourceUrl, book.title);
      const item = catalog.items[0];
      if (!item) throw new Error('Аудиофайлът вече не е наличен.');
      // Показваме проценти, а не само „зареждам“.
      const downloaded = await downloadRemoteItem(item, (percent) => {
        setMessage(`Свалям „${book.title}“… ${percent}%`);
      });
      openAudioBook(downloaded, {
        item,
        book: { ...item, name: book.title, url: book.sourceUrl },
        libraryId: book.id,
        favorite: book.favorite,
        remoteKey: book.remoteKey,
        source: book.source,
      });
      setMessage('');
    } catch (error) {
      setMessage(error.message || 'Аудиокнигата не може да се зареди отново.');
      setView('create');
    }
  };
  const openBook = (book) => {
    if (book.mediaType === 'audio') {
      resumeAudioBook(book);
      return;
    }
    openTextBook(book);
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
  const toggleCurrentFavorite = () => {
    const record = ensureSaved();
    if (!record) return;
    const next = !record.favorite;
    setBookField(record.id, { favorite: next });
    if (record.remoteKey) setRemoteFavorite(record.remoteKey, next);
    refreshBooks();
    setMessage(next ? 'Добавено в любими.' : 'Премахнато от любими.');
  };

  // ——— Сваляне / офлайн / резервно копие ———
  const download = async () => {
    if (!text.trim()) return;
    if (!apiKey.trim()) { setMessage('Добави Gemini API ключ, за да свалиш аудиото.'); return; }
    setDownloading(true);
    setMessage('Подготвям аудио файла…');
    try {
      downloadTts.current.prepare(text, {
        apiKey: apiKey.trim(),
        voiceName: voice,
        gender,
        alternateVoices,
        rate,
        language,
      });
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
      downloadTts.current.prepare(text, {
        apiKey: apiKey.trim(),
        voiceName: voice,
        gender,
        alternateVoices,
        rate,
        language,
      });
      await downloadTts.current.cacheAll(setCacheProgress);
      if (currentBookId) { setBookField(currentBookId, { cachedOffline: true }); refreshBooks(); }
      setMessage('Книгата е готова за офлайн слушане. ✅');
    } catch (error) {
      setMessage(error.message || 'Офлайн свалянето се провали.');
    } finally {
      setCaching(false);
    }
  };

  const clearCache = async () => {
    await idbClear();
    books
      .filter((book) => book.audioCached || book.cachedOffline)
      .forEach((book) => setBookField(book.id, { audioCached: false, cachedOffline: false }));
    refreshBooks();
    setMessage('Кешираният звук и запазените Storytel аудиофайлове са изтрити.');
  };
  const removeAudioCacheEntry = async (entry, book) => {
    await removeCachedAudioBook({ cacheKey: entry.key });
    if (book?.id) setBookField(book.id, { audioCached: false });
    refreshBooks();
    setMessage(`Офлайн файлът на „${book?.title || entry.title || entry.name}“ е изтрит. Прогресът и отметките са запазени.`);
  };
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

  useEffect(() => {
    if (!motionSleep) return undefined;
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
        tts.current.pause();
        ambient.current.pause();
        setStatus((previous) => (previous === 'speaking' ? 'paused' : previous));
        setMotionSleep(false);
        setMessage('Четенето спря след 15 минути без движение.');
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [motionSleep]);

  const chooseMotionSleep = async () => {
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
      setChapterMode(false);
      setMotionSleep(true);
      setMessage('Таймерът ще спре след 15 минути без движение.');
    } catch {
      setMessage('Таймерът без движение не може да бъде активиран.');
    }
  };

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
        <img className="app-logo" src="/voxora-logo.png" alt="Voxora" />
        <div className="header-right">
          {view === 'create' && books.length > 0 && (
            <button className="nav-home" onClick={() => { setView('home'); setStats(getStats()); }}>← Библиотека</button>
          )}
          <span className="status-dot">● Gemini AI Audio</span>
          <button className="profile" aria-label="Профил">В</button>
        </div>
      </header>

      {view === 'home' ? (
        <Home
          books={books}
          stats={stats}
          queue={queue}
          onOpen={openBook}
          onNew={() => {
            setView('create');
            setText('');
            setCurrentBookId(null);
            setDraftCover('');
            fileTitle.current = '';
          }}
          onRate={rateBook}
          onToggleFavorite={toggleFavorite}
          onToggleFinished={toggleFinished}
          onQueue={enqueue}
          onRemove={deleteBook}
          onCoverChange={changeBookCover}
          onOpenStorage={() => setStorageOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
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
          <div className={`workspace ${editorReady ? '' : 'source-workspace'}`}>
            <TextInput
              text={text}
              setText={setText}
              cover={draftCover}
              onCoverFile={changeDraftCover}
              onCoverClear={clearDraftCover}
              onLoaded={onLoaded}
              onAudioLoaded={openAudioBook}
              onEditorMode={setEditorReady}
            />
            {editorReady && <aside className="card settings">
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
              <label className="alt-voices">
                <input type="checkbox" checked={alternateVoices} onChange={(event) => setAlternateVoices(event.target.checked)} />
                <span>
                  <b>Редувай мъжки и женски глас</b>
                  <small>{alternateVoices ? 'Всяка следваща част се чете от другия глас.' : 'Цялата книга се чете от един разказвач.'}</small>
                </span>
              </label>
              {text.trim() && <p className="lang-badge">Разпознат език: <b>{langLabel(language)}</b></p>}
              <SpeedControl value={rate} onChange={setRate} />
              <MusicSelector enabled={music} setEnabled={setMusic} genre={genre} setGenre={setGenre} volume={volume} setVolume={setVolume} />
              <SleepTimer
                minutes={sleepMinutes}
                onChange={(value) => { setMotionSleep(false); setSleepMinutes(value); }}
                remaining={sleepRemaining}
                chapterMode={chapterMode}
                onChapterMode={(value) => { setMotionSleep(false); setChapterMode(value); }}
                hasChapters={!!(chapters && chapters.length > 1)}
                motionMode={motionSleep}
                onMotionMode={chooseMotionSleep}
              />
              <StoragePanel
                hasText={!!text.trim()}
                caching={caching}
                cacheProgress={cacheProgress}
                onCacheOffline={cacheOffline}
                onManageStorage={() => setStorageOpen(true)}
                onExport={exportLib}
                onImport={importLib}
              />
              {heavy && (
                <p className="quota-note">
                  ⚠ Дълъг текст: ~{chunks.length} AI заявки (~{mins} мин. звук).
                  {' Може да изразходи дневния лимит наведнъж.'}
                </p>
              )}
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
                <button
                  className={`save-book ${currentBook?.favorite ? 'on' : ''}`}
                  onClick={toggleCurrentFavorite}
                  disabled={!text.trim()}
                  title={currentBook?.favorite ? 'Премахни от любими' : 'Добави в любими'}
                >
                  ♥
                </button>
              </div>
            </aside>}
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
          motionMode={motionSleep}
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
          onSleep={(value) => { setMotionSleep(false); setSleepMinutes(value); }}
          onChapterMode={(value) => { setMotionSleep(false); setChapterMode(value); }}
          onMotionMode={chooseMotionSleep}
        />
      )}
      {audioBook && (
        <AudiobookPlayer
          book={audioBook}
          onClose={closeAudioBook}
          onProgress={(time, duration) => updateAudioPosition(audioBook.id, time, duration)}
          onToggleFavorite={toggleAudioFavorite}
          onBookmark={bookmarkAudio}
          onRemoveBookmark={deleteAudioBookmark}
          onTranscriptChange={saveAudioTranscript}
          onAudioSettings={saveAudioSettings}
          onOfflineSettings={saveOfflineSettings}
          onCacheBook={cacheCurrentAudioBook}
          onFinished={() => {
            setBookField(audioBook.id, { finished: true });
            refreshAudioBook(audioBook.id);
          }}
          onListening={(seconds) => addListening(seconds)}
        />
      )}
      {storageOpen && (
        <StorageManager
          books={books}
          onClose={() => setStorageOpen(false)}
          onClearAll={clearCache}
          onRemoveCachedBook={removeAudioCacheEntry}
          onStatus={setMessage}
        />
      )}
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
      {view === 'create' && <footer>VOXORA · Gemini AI гласове</footer>}
    </>
  );
}
