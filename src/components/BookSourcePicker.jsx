import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  ChevronRight,
  FileText,
  Headphones,
  Heart,
  LibraryBig,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  audioStreamUrl,
  discoverFourEtiPage,
  downloadRemoteItem,
  downloadRemoteArtwork,
  formatRemoteSize,
  loadFourEtiLibrary,
  loadMegaCatalog,
  openRemoteCatalog,
  STORYTEL_LIBRARY_URL,
} from '../services/remoteBooks';
import {
  loadRemoteFavorites,
  remoteBookKey,
  setRemoteFavorite,
} from '../services/remoteFavorites';

const FOUR_ETI_URL = 'https://4eti.me/';
const ALL_CATEGORY = { id: 'all', name: 'Всички' };

const documentScore = (item) => {
  if (/\.docx$/i.test(item.name)) return 0;
  if (/\.epub$/i.test(item.name)) return 1;
  if (/\.fb2$/i.test(item.name)) return 2;
  if (/\.(mobi|azw3)$/i.test(item.name)) return 3;
  if (/\.(txt|rtf|html?|md)$/i.test(item.name)) return 4;
  if (/\.pdf$/i.test(item.name)) return 5;
  if (/\.cbz$/i.test(item.name)) return 6;
  return 7;
};

export default function BookSourcePicker({ onManual, onDocument, onAudio }) {
  const [source, setSource] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [favoriteKeys, setFavoriteKeys] = useState(() => loadRemoteFavorites());
  const [showFavorites, setShowFavorites] = useState(false);
  const [progress, setProgress] = useState(null);

  const visibleItems = useMemo(() => {
    if (!catalog) return [];
    const query = search.trim().toLocaleLowerCase('bg-BG');
    return catalog.items.filter((item) => {
      const inCategory = source !== 'mega'
        || !activeCategory
        || activeCategory === ALL_CATEGORY.name
        || item.category === activeCategory;
      const matches = !query
        || `${item.name} ${item.path || ''}`.toLocaleLowerCase('bg-BG').includes(query);
      const favorite = favoriteKeys.has(remoteBookKey(source, item));
      return inCategory && matches && (!showFavorites || favorite);
    });
  }, [activeCategory, catalog, favoriteKeys, search, showFavorites, source]);

  const chooseSource = async (nextSource) => {
    if (nextSource === 'manual') {
      onManual();
      return;
    }

    setSource(nextSource);
    setBusy(true);
    setCatalog(null);
    setSearch('');
    setShowFavorites(false);
    setStatus(nextSource === 'mega' ? 'Зареждам Storytel…' : 'Зареждам библиотеката…');
    try {
      if (nextSource === 'mega') {
        const loaded = await loadMegaCatalog(STORYTEL_LIBRARY_URL);
        setCatalog(loaded);
        setCategories([ALL_CATEGORY, ...loaded.categories]);
        setActiveCategory(ALL_CATEGORY.name);
        setStatus(`${loaded.items.length} аудиокниги`);
      } else {
        const loaded = await loadFourEtiLibrary(FOUR_ETI_URL);
        setCatalog(loaded);
        setCategories(loaded.categories);
        setActiveCategory(loaded.categories[0]?.name || 'Нови');
        setStatus(`${loaded.items.length} книги в „Нови“`);
      }
    } catch (error) {
      setStatus(error.message || 'Библиотеката не може да се зареди.');
    } finally {
      setBusy(false);
    }
  };

  const chooseCategory = async (category) => {
    if (busy || category.name === activeCategory) return;
    setActiveCategory(category.name);
    setSearch('');
    setShowFavorites(false);

    if (source === 'mega') return;
    setBusy(true);
    setStatus(`Зареждам „${category.name}“…`);
    try {
      const loaded = await loadFourEtiLibrary(category.url);
      setCatalog({ ...loaded, categories });
      setStatus(`${loaded.items.length} книги в „${category.name}“`);
    } catch (error) {
      setStatus(error.message || 'Категорията не може да се зареди.');
    } finally {
      setBusy(false);
    }
  };

  const importRemoteItem = async (item, context = {}) => {
    const book = context.book || item;
    const key = remoteBookKey(source, book);
    const details = {
      item,
      book,
      source,
      favorite: favoriteKeys.has(key),
      remoteKey: key,
    };

    // Аудиокнигите вече НЕ се свалят цели. Плеърът ги пуска на поток през
    // /api/mega-stream и тегли само парчето, което свири — така тръгват
    // веднага и не задръстват паметта на телефона (проблемът на iPhone).
    if (item.kind === 'audio' && item.provider === 'mega') {
      let artwork = { metadata: null, cover: null };
      try {
        artwork = await downloadRemoteArtwork(item);
      } catch {
        // Книгата може да се пусне и без автоматична корица.
      }
      onAudio({
        streamUrl: audioStreamUrl(item.url, item.name),
        name: item.name,
        size: item.size,
        ...artwork,
      }, details);
      return;
    }

    setProgress({ percent: 0, received: 0, total: item.size || 0 });
    try {
      const downloaded = await downloadRemoteItem(item, (percent, received, total) => {
        setProgress({ percent, received, total });
      });
      if (item.kind === 'audio') onAudio(downloaded, details);
      else await onDocument(downloaded.file, details);
    } finally {
      setProgress(null);
    }
  };

  const chooseFourEtiBook = async (book) => {
    const discovered = await discoverFourEtiPage(book.url);
    const candidates = [];
    for (const sourceItem of discovered.items) {
      try {
        // Източниците са малко; проверяваме ги последователно и предпочитаме чист текстов формат.
        const resolved = await openRemoteCatalog(sourceItem.url, sourceItem.name);
        candidates.push(...resolved.items);
      } catch {
        // Някои стари публикации сочат към вече недостъпни хранилища.
      }
    }
    if (!candidates.length) throw new Error('За тази книга не беше намерен достъпен поддържан файл.');
    candidates.sort((a, b) => documentScore(a) - documentScore(b));
    await importRemoteItem(candidates[0], { book });
  };

  const chooseBook = async (item) => {
    if (busy) return;
    setBusy(true);
    setStatus(`Зареждам „${item.name}“…`);
    try {
      if (source === '4eti') await chooseFourEtiBook(item);
      else await importRemoteItem(item, { book: item });
    } catch (error) {
      setStatus(error.message || 'Книгата не може да се зареди.');
    } finally {
      setBusy(false);
    }
  };

  const backToSources = () => {
    setSource('');
    setCatalog(null);
    setCategories([]);
    setActiveCategory('');
    setSearch('');
    setShowFavorites(false);
    setStatus('');
  };

  const toggleFavorite = (item) => {
    const key = remoteBookKey(source, item);
    const next = !favoriteKeys.has(key);
    setFavoriteKeys(new Set(setRemoteFavorite(key, next)));
    setStatus(next ? `„${item.name}“ е добавена в любими.` : `„${item.name}“ е премахната от любими.`);
  };

  if (!source) {
    return (
      <div className="source-step">
        <div className="source-heading">
          <span className="eyebrow">01 · ИЗТОЧНИК</span>
          <h2>Откъде е книгата?</h2>
          <p>Избери своя текст, аудиокнига или заглавие от библиотеката.</p>
        </div>
        <div className="source-options">
          <button onClick={() => chooseSource('manual')}>
            <span><FileText aria-hidden="true" /></span>
            <span className="source-option-copy">
              <b>Моят текст</b>
              <small>Постави текст или качи собствен файл</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
          <button onClick={() => chooseSource('mega')}>
            <span><Headphones aria-hidden="true" /></span>
            <span className="source-option-copy">
              <b>Storytel</b>
              <small>Избери аудиокнига и започни веднага</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
          <button onClick={() => chooseSource('4eti')}>
            <span><LibraryBig aria-hidden="true" /></span>
            <span className="source-option-copy">
              <b>Библиотека</b>
              <small>Открий електронни книги по категории</small>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`source-library source-library-${source}`}>
      <div className="source-library-head">
        <button onClick={backToSources} aria-label="Назад към източниците"><ArrowLeft aria-hidden="true" /></button>
        <span className="source-library-mark" aria-hidden="true">
          {source === 'mega' ? <Headphones /> : <LibraryBig />}
        </span>
        <div>
          <span className="eyebrow">02 · {source === 'mega' ? 'STORYTEL' : 'БИБЛИОТЕКА'}</span>
          <h2>Избери категория и книга</h2>
          <p>{source === 'mega' ? 'Аудиокниги, готови за слушане' : 'Електронни книги за твоя AI разказвач'}</p>
        </div>
      </div>

      <div className="source-catalog-shell">
        <aside className="source-categories">
          <div className="source-categories-title">
            <span>Категории</span>
            <small>{categories.length}</small>
          </div>
          {categories.length > 0 && (
            <div className="source-tabs" role="tablist" aria-label="Категории">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={category.name === activeCategory}
                  className={category.name === activeCategory ? 'active' : ''}
                  onClick={() => chooseCategory(category)}
                >
                  <span>{category.name}</span>
                  {category.count ? <small>{category.count}</small> : null}
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="source-catalog-main">
          <div className="source-search-row">
            <label>
              <Search aria-hidden="true" />
              <input
                type="search"
                value={search}
                placeholder="Търси заглавие или автор"
                onChange={(event) => setSearch(event.target.value)}
                disabled={!catalog}
              />
            </label>
            <button
              className={showFavorites ? 'on' : ''}
              onClick={() => setShowFavorites((value) => !value)}
              aria-label={showFavorites ? 'Покажи всички книги' : 'Покажи само любимите'}
              title={showFavorites ? 'Покажи всички' : 'Само любими'}
              disabled={!catalog}
            >
              <Heart fill={showFavorites ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
            <span><strong>{busy ? '…' : visibleItems.length}</strong><small>резултата</small></span>
          </div>

          <div className={`source-books ${busy && !catalog ? 'loading' : ''}`}>
            {!catalog && <p><Sparkles aria-hidden="true" />{status}</p>}
            {catalog && visibleItems.slice(0, 100).map((item) => {
              const favorite = favoriteKeys.has(remoteBookKey(source, item));
              return (
                <article className="source-book-row" key={item.id}>
                  <button className="source-book-open" onClick={() => chooseBook(item)} disabled={busy}>
                    <span className={`source-book-icon ${item.kind}`}>
                      {item.kind === 'audio' ? <Headphones aria-hidden="true" /> : <BookOpenText aria-hidden="true" />}
                    </span>
                    <span className="source-book-copy">
                      <b>{item.name.replace(/\.(m4b|m4a|mp3|aac)$/i, '')}</b>
                      <small>{[
                        source === 'mega' ? item.category : activeCategory,
                        formatRemoteSize(item.size),
                      ].filter(Boolean).join(' · ')}</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <button
                    className={`source-book-favorite ${favorite ? 'on' : ''}`}
                    onClick={() => toggleFavorite(item)}
                    aria-label={favorite ? 'Премахни от любими' : 'Добави в любими'}
                    title={favorite ? 'Премахни от любими' : 'Добави в любими'}
                  >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                </article>
              );
            })}
            {catalog && !visibleItems.length && !busy && (
              <p><Search aria-hidden="true" />Няма книги по това търсене.</p>
            )}
          </div>
        </section>
      </div>

      {progress ? (
        <div className="source-progress" role="status" aria-live="polite">
          <div className="source-progress-head">
            <span>Свалям аудиокнигата…</span>
            <strong>{progress.percent}%</strong>
          </div>
          <div className="source-progress-bar"><i style={{ width: `${progress.percent}%` }} /></div>
          {progress.total > 0 && (
            <small>{formatRemoteSize(progress.received)} от {formatRemoteSize(progress.total)}</small>
          )}
        </div>
      ) : (
        <p className="source-status" role="status">{busy ? 'Зареждам…' : status}</p>
      )}
    </div>
  );
}
