import { useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  Headphones,
  Play,
  RefreshCw,
} from 'lucide-react';
import Cover from './Cover';
import {
  downloadRemoteArtwork,
  formatRemoteSize,
  loadFourEtiLibrary,
  loadMegaCatalog,
  STORYTEL_LIBRARY_URL,
} from '../services/remoteBooks';

const FOUR_ETI_URL = 'https://4eti.me/';
const cleanTitle = (name = '') => name.replace(/\.(m4b|m4a|mp3|aac)$/i, '');

export const dailyRecommendationKey = (date = new Date()) => (
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
);

const hashText = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const dailySort = (items, seed) => [...items].sort((a, b) => {
  const aScore = hashText(`${seed}:${a.id || a.url || a.name}`);
  const bScore = hashText(`${seed}:${b.id || b.url || b.name}`);
  return aScore - bScore || (a.name || '').localeCompare(b.name || '', 'bg');
});

export const selectDailyRecommendations = (
  items,
  { limit = 10, kind, seed = dailyRecommendationKey() } = {},
) => {
  const groups = new Map();
  items
    .filter((item) => !kind || item.kind === kind)
    .forEach((item) => {
      const category = item.category || 'Други';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });

  const queues = dailySort([...groups.entries()], `${seed}:categories`)
    .map(([, group]) => dailySort(group, seed));
  const selected = [];
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    queues.forEach((queue) => {
      if (selected.length < limit && queue.length) selected.push(queue.shift());
    });
  }
  return selected;
};

export const selectFeaturedStorytel = (items, limit = 10, seed) => (
  selectDailyRecommendations(items, { limit, kind: 'audio', seed })
);

export const selectFeaturedLibrary = (items, limit = 10, seed) => (
  selectDailyRecommendations(items, { limit, kind: 'page', seed })
);

function RecommendationCarousel({
  items,
  covers,
  openingId,
  onOpen,
  variant,
}) {
  const rowRef = useRef(null);
  const pausedRef = useRef(false);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    scrollLeft: 0,
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (items.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const row = rowRef.current;
      if (!row || pausedRef.current || document.hidden) return;
      const firstCard = row.firstElementChild;
      const step = (firstCard?.getBoundingClientRect().width || 148) + 14;
      const nearEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - step;
      row.scrollTo({ left: nearEnd ? 0 : row.scrollLeft + step, behavior: 'smooth' });
    }, 6200);
    return () => window.clearInterval(timer);
  }, [items]);

  const moveWithKeyboard = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const row = rowRef.current;
    const step = (row?.firstElementChild?.getBoundingClientRect().width || 148) + 14;
    row?.scrollBy({ left: event.key === 'ArrowRight' ? step : -step, behavior: 'smooth' });
  };

  const startDrag = (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const row = rowRef.current;
    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      scrollLeft: row.scrollLeft,
    };
    pausedRef.current = true;
    row.setPointerCapture(event.pointerId);
  };

  const drag = (event) => {
    if (!dragRef.current.active) return;
    const distance = event.clientX - dragRef.current.startX;
    if (Math.abs(distance) > 5) {
      dragRef.current.moved = true;
      setDragging(true);
      event.preventDefault();
    }
    rowRef.current.scrollLeft = dragRef.current.scrollLeft - distance;
  };

  const stopDrag = (event) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    if (rowRef.current.hasPointerCapture(event.pointerId)) {
      rowRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const suppressDraggedClick = (event) => {
    if (!dragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current.moved = false;
  };

  return (
    <div
      ref={rowRef}
      className={`storytel-shelf-row ${dragging ? 'dragging' : ''}`}
      tabIndex="0"
      onKeyDown={moveWithKeyboard}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onClickCapture={suppressDraggedClick}
      onDragStart={(event) => event.preventDefault()}
      onPointerEnter={() => { pausedRef.current = true; }}
      onPointerLeave={() => { pausedRef.current = false; }}
      onFocus={() => { pausedRef.current = true; }}
      onBlur={() => { pausedRef.current = false; }}
    >
      {items.map((item) => {
        const title = cleanTitle(item.name);
        const isAudio = variant === 'storytel';
        return (
          <article className="storytel-card" key={item.id || item.url}>
            <button
              className="storytel-cover"
              onClick={() => onOpen(item)}
              disabled={!!openingId}
              aria-label={`${isAudio ? 'Пусни' : 'Отвори'} ${title}`}
            >
              <Cover book={{ title, cover: covers[item.id] || item.cover }} />
              <span className="storytel-audio-badge">
                {isAudio
                  ? <Headphones aria-hidden="true" />
                  : <BookOpenText aria-hidden="true" />}
              </span>
              <span className="storytel-play">
                {openingId === (item.id || item.url)
                  ? '…'
                  : <Play fill="currentColor" aria-hidden="true" />}
              </span>
            </button>
            <b title={title}>{title}</b>
            <small>
              {isAudio
                ? [item.category, formatRemoteSize(item.size)].filter(Boolean).join(' · ')
                : 'Библиотека · е-книга'}
            </small>
          </article>
        );
      })}
    </div>
  );
}

function DailyShelf({
  ariaLabel,
  eyebrow,
  title,
  variant,
  loader,
  selector,
  onOpen,
  withArtwork = false,
}) {
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
        const catalog = await loader();
        const featured = selector(catalog.items);
        if (!active) return;
        setItems(featured);
        setStatus(featured.length ? 'ready' : 'empty');

        if (withArtwork) {
          await Promise.all(featured.map(async (item) => {
            try {
              const { cover } = await downloadRemoteArtwork(item);
              if (!cover || !active) return;
              const url = URL.createObjectURL(cover);
              objectUrls.push(url);
              setCovers((current) => ({ ...current, [item.id]: url }));
            } catch {
              // Генерираната корица остава като резервен вариант.
            }
          }));
        }
      } catch {
        if (active) setStatus('error');
      }
    };

    load();
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [loader, reload, selector, withArtwork]);

  const open = async (item) => {
    if (openingId) return;
    const id = item.id || item.url;
    setOpeningId(id);
    try {
      await onOpen(item);
    } finally {
      setOpeningId('');
    }
  };

  if (status === 'empty') return null;

  return (
    <section className={`storytel-shelf ${variant}-top-shelf`} aria-label={ariaLabel}>
      <div className="storytel-shelf-head">
        <div>
          <span className="eyebrow coral">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {status === 'ready' && <span>{items.length} книги</span>}
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
        <RecommendationCarousel
          items={items}
          covers={covers}
          openingId={openingId}
          onOpen={open}
          variant={variant}
        />
      )}
    </section>
  );
}

const loadStorytel = () => loadMegaCatalog(STORYTEL_LIBRARY_URL);
const loadLibrary = () => loadFourEtiLibrary(FOUR_ETI_URL);

export default function StorytelShelf({ onOpen, onOpenLibrary }) {
  return (
    <div className="daily-recommendations">
      <DailyShelf
        ariaLabel="Топ 10 предложения от Storytel"
        eyebrow="STORYTEL · ДНЕВНА СЕЛЕКЦИЯ"
        title="Топ 10 Storytel книги"
        variant="storytel"
        loader={loadStorytel}
        selector={selectFeaturedStorytel}
        onOpen={onOpen}
        withArtwork
      />
      <DailyShelf
        ariaLabel="Топ 10 предложения от Библиотека"
        eyebrow="БИБЛИОТЕКА · ДНЕВНА СЕЛЕКЦИЯ"
        title="Топ 10 книги"
        variant="library"
        loader={loadLibrary}
        selector={selectFeaturedLibrary}
        onOpen={onOpenLibrary}
      />
    </div>
  );
}
