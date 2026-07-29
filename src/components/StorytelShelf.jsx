import { useEffect, useState } from 'react';
import { Headphones, Play, RefreshCw } from 'lucide-react';
import Cover from './Cover';
import {
  downloadRemoteArtwork,
  formatRemoteSize,
  loadMegaCatalog,
  STORYTEL_LIBRARY_URL,
} from '../services/remoteBooks';

const cleanTitle = (name = '') => name.replace(/\.(m4b|m4a|mp3|aac)$/i, '');

export const selectFeaturedStorytel = (items, limit = 10) => {
  const groups = new Map();
  items
    .filter((item) => item.kind === 'audio')
    .sort((a, b) => cleanTitle(a.name).localeCompare(cleanTitle(b.name), 'bg'))
    .forEach((item) => {
      const category = item.category || 'Други';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });

  const selected = [];
  const queues = [...groups.values()];
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    queues.forEach((queue) => {
      if (selected.length < limit && queue.length) selected.push(queue.shift());
    });
  }
  return selected;
};

export default function StorytelShelf({ onOpen }) {
  const [items, setItems] = useState([]);
  const [covers, setCovers] = useState({});
  const [status, setStatus] = useState('loading');
  const [openingId, setOpeningId] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const objectUrls = [];

    const load = async () => {
      setStatus('loading');
      setCovers({});
      try {
        const catalog = await loadMegaCatalog(STORYTEL_LIBRARY_URL);
        const featured = selectFeaturedStorytel(catalog.items);
        if (!active) return;
        setItems(featured);
        setStatus(featured.length ? 'ready' : 'empty');

        await Promise.all(featured.map(async (item) => {
          try {
            const { cover } = await downloadRemoteArtwork(item);
            if (!cover || !active) return;
            const url = URL.createObjectURL(cover);
            objectUrls.push(url);
            setCovers((current) => ({ ...current, [item.id]: url }));
          } catch {
            // Генерираната корица остава като чист резервен вариант.
          }
        }));
      } catch {
        if (active) setStatus('error');
      }
    };

    load();
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [reload]);

  const open = async (item) => {
    if (openingId) return;
    setOpeningId(item.id);
    try {
      await onOpen(item);
    } finally {
      setOpeningId('');
    }
  };

  if (status === 'empty') return null;

  return (
    <section className="storytel-shelf" aria-label="Предложения от Storytel">
      <div className="storytel-shelf-head">
        <div>
          <span className="eyebrow coral">STORYTEL · ПОДБРАНО ЗА ТЕБ</span>
          <h2>Следващата ти история</h2>
        </div>
        {status === 'ready' && <span>{items.length} предложения</span>}
      </div>

      {status === 'loading' && (
        <div className="storytel-shelf-row loading" aria-label="Зареждам предложенията">
          {Array.from({ length: 6 }, (_, index) => <i key={index} />)}
        </div>
      )}

      {status === 'error' && (
        <button className="storytel-retry" onClick={() => setReload((value) => value + 1)}>
          <RefreshCw aria-hidden="true" />
          Зареди предложенията
        </button>
      )}

      {status === 'ready' && (
        <div className="storytel-shelf-row">
          {items.map((item) => {
            const title = cleanTitle(item.name);
            return (
              <article className="storytel-card" key={item.id}>
                <button
                  className="storytel-cover"
                  onClick={() => open(item)}
                  disabled={!!openingId}
                  aria-label={`Пусни ${title}`}
                >
                  <Cover book={{ title, cover: covers[item.id] }} />
                  <span className="storytel-audio-badge"><Headphones aria-hidden="true" /></span>
                  <span className="storytel-play">
                    {openingId === item.id ? '…' : <Play fill="currentColor" aria-hidden="true" />}
                  </span>
                </button>
                <b title={title}>{title}</b>
                <small>{[item.category, formatRemoteSize(item.size)].filter(Boolean).join(' · ')}</small>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
