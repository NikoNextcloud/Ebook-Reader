import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookAudio,
  CircleCheck,
  Database,
  HardDrive,
  RefreshCw,
  SlidersHorizontal,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  listCachedAudioBooks,
  loadOfflineSettings,
  saveOfflineSettings,
} from '../services/audiobookCache';

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index < 2 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

const findBook = (books, entry) => books.find((book) => (
  (entry.remoteKey && book.remoteKey === entry.remoteKey)
  || (entry.sourceUrl && book.sourceUrl === entry.sourceUrl)
));

export default function StorageManager({
  books,
  onClose,
  onClearAll,
  onRemoveCachedBook,
  onStatus,
}) {
  const [entries, setEntries] = useState([]);
  const [usage, setUsage] = useState(0);
  const [quota, setQuota] = useState(0);
  const [persistent, setPersistent] = useState(null);
  const [supportsPersistence, setSupportsPersistence] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [offlineSettings, setOfflineSettings] = useState(() => loadOfflineSettings());

  const refresh = useCallback(async () => {
    setLoading(true);
    const [nextEntries, estimate, persisted] = await Promise.all([
      listCachedAudioBooks(),
      navigator.storage?.estimate?.().catch(() => null),
      navigator.storage?.persisted?.().catch(() => null),
    ]);
    setEntries(nextEntries);
    setUsage(estimate?.usage || 0);
    setQuota(estimate?.quota || 0);
    setPersistent(persisted);
    setSupportsPersistence(typeof navigator.storage?.persist === 'function');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, refresh]);

  const cachedBooks = useMemo(
    () => entries.map((entry) => ({ entry, book: findBook(books, entry) })),
    [books, entries],
  );
  const cachedTotal = entries.reduce((sum, entry) => sum + entry.size, 0);
  const usedPercent = quota ? Math.min(100, Math.round((usage / quota) * 100)) : 0;

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) return;
    setBusy('persistence');
    try {
      const granted = await navigator.storage.persist();
      setPersistent(granted);
      onStatus?.(granted
        ? 'Постоянната памет е активирана.'
        : 'Браузърът не разреши постоянна памет. Офлайн книгите остават налични, но могат да бъдат премахнати при недостиг на място.');
    } finally {
      setBusy('');
    }
  };

  const updateOfflineSettings = (patch) => {
    setOfflineSettings(saveOfflineSettings(patch));
  };

  const removeOne = async (entry, book) => {
    if (!window.confirm(`Да се изтрие ли офлайн файлът на „${book?.title || entry.title || entry.name}“?`)) return;
    setBusy(entry.key);
    await onRemoveCachedBook(entry, book);
    await refresh();
    setBusy('');
  };

  const clearAll = async () => {
    if (!window.confirm('Да се изтрият ли всички офлайн аудиофайлове? Книгите, прогресът и отметките ще останат.')) return;
    setBusy('all');
    await onClearAll();
    await refresh();
    setBusy('');
  };

  return (
    <div className="storage-manager-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="storage-manager" role="dialog" aria-modal="true" aria-labelledby="storage-title">
        <header className="storage-manager-head">
          <div>
            <span className="eyebrow">ОФЛАЙН И ПАМЕТ</span>
            <h2 id="storage-title">Управление на паметта</h2>
          </div>
          <button className="storage-icon-button" onClick={onClose} aria-label="Затвори">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="storage-overview">
          <div className="storage-overview-title">
            <HardDrive aria-hidden="true" />
            <div>
              <strong>{formatBytes(usage)} използвани</strong>
              <span>{quota ? `от ${formatBytes(quota)} налични за Voxora` : 'Размерът се изчислява от браузъра'}</span>
            </div>
            <b>{usedPercent}%</b>
          </div>
          <div className="storage-meter" aria-label={`${usedPercent}% използвана памет`}>
            <i style={{ width: `${usedPercent}%` }} />
          </div>
          <div className="storage-overview-foot">
            <span><Database aria-hidden="true" /> Аудиокниги: {formatBytes(cachedTotal)}</span>
            <button className="storage-refresh" onClick={refresh} disabled={loading} aria-label="Обнови информацията">
              <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>

        <div className={`storage-persistence ${persistent ? 'is-active' : ''}`}>
          {persistent ? <CircleCheck aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
          <div>
            <strong>{persistent ? 'Постоянната памет е активна' : 'Защити офлайн книгите'}</strong>
            <span>{persistent
              ? 'Браузърът няма да ги премахва автоматично при недостиг на място.'
              : 'Поискай от браузъра да пази изтеглените книги постоянно.'}</span>
          </div>
          {!persistent && supportsPersistence && (
            <button onClick={requestPersistence} disabled={busy === 'persistence'}>
              {busy === 'persistence' ? 'Проверявам…' : 'Активирай'}
            </button>
          )}
          {!persistent && !supportsPersistence && <small>Не се поддържа от този браузър</small>}
        </div>

        <div className="storage-auto-clean">
          <SlidersHorizontal aria-hidden="true" />
          <label>
            <span><b>Автоматично почистване</b></span>
            <input
              type="checkbox"
              checked={offlineSettings.autoClean}
              onChange={(event) => updateOfflineSettings({ autoClean: event.target.checked })}
            />
          </label>
          <label>
            <span>Лимит</span>
            <select
              value={offlineSettings.maxBytes}
              onChange={(event) => updateOfflineSettings({ maxBytes: Number(event.target.value) })}
            >
              <option value={512 * 1024 * 1024}>512 MB</option>
              <option value={1024 * 1024 * 1024}>1 GB</option>
              <option value={2 * 1024 * 1024 * 1024}>2 GB</option>
              <option value={4 * 1024 * 1024 * 1024}>4 GB</option>
            </select>
          </label>
        </div>

        <div className="storage-list-head">
          <div>
            <h3>Свалени аудиокниги</h3>
            <span>{entries.length} {entries.length === 1 ? 'файл' : 'файла'}</span>
          </div>
          {entries.length > 0 && (
            <button className="storage-clear-all" onClick={clearAll} disabled={busy === 'all'}>
              <Trash2 aria-hidden="true" />
              {busy === 'all' ? 'Изтривам…' : 'Изтрий всички'}
            </button>
          )}
        </div>

        <div className="storage-book-list">
          {loading ? (
            <p className="storage-empty">Проверявам офлайн паметта…</p>
          ) : cachedBooks.length === 0 ? (
            <div className="storage-empty">
              <BookAudio aria-hidden="true" />
              <p>Няма свалени аудиокниги.</p>
              <span>Когато запазиш книга офлайн, тя ще се появи тук.</span>
            </div>
          ) : cachedBooks.map(({ entry, book }) => (
            <article className="storage-book-row" key={entry.key}>
              {book?.cover
                ? <img src={book.cover} alt="" />
                : <div className="storage-book-placeholder"><BookAudio aria-hidden="true" /></div>}
              <div className="storage-book-info">
                <strong>{book?.title || entry.title || entry.name}</strong>
                <span>{formatBytes(entry.size)}{entry.savedAt ? ` · ${new Date(entry.savedAt).toLocaleDateString('bg-BG')}` : ''}</span>
              </div>
              <button
                className="storage-delete-one"
                onClick={() => removeOne(entry, book)}
                disabled={busy === entry.key}
                aria-label={`Изтрий офлайн файла на ${book?.title || entry.title || entry.name}`}
              >
                {busy === entry.key ? <RefreshCw className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
