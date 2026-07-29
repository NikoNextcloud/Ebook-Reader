import {
  idbDelete,
  idbEntries,
  idbGet,
  idbSet,
} from './idbCache';

const PREFIX = 'remote-audiobook|';
const SETTINGS_KEY = 'voxora-offline-settings-v1';

export const DEFAULT_OFFLINE_SETTINGS = {
  autoClean: true,
  maxBytes: 2 * 1024 * 1024 * 1024,
};

export const loadOfflineSettings = () => {
  try {
    return {
      ...DEFAULT_OFFLINE_SETTINGS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
    };
  } catch {
    return { ...DEFAULT_OFFLINE_SETTINGS };
  }
};

export const saveOfflineSettings = (settings) => {
  const next = { ...loadOfflineSettings(), ...settings };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Настройката остава активна за текущата сесия само ако localStorage е недостъпен.
  }
  return next;
};

export const audioBookCacheKey = (remoteKey, sourceUrl) => {
  const identity = remoteKey || sourceUrl || '';
  return identity ? `${PREFIX}${identity}` : '';
};

export const cacheAudioBook = async ({
  remoteKey,
  sourceUrl,
  file,
  metadata = null,
  cover = null,
}) => {
  const key = audioBookCacheKey(remoteKey, sourceUrl);
  if (!key || !file) return false;
  try {
    const estimate = await navigator.storage?.estimate?.();
    const available = estimate?.quota && Number.isFinite(estimate.usage)
      ? estimate.quota - estimate.usage
      : Infinity;
    if (available < file.size * 1.08) return false;
    await navigator.storage?.persist?.();
  } catch {
    /* StorageManager не се поддържа; IndexedDB все пак може да работи. */
  }
  return idbSet(key, {
    blob: file,
    name: file.name || 'audiobook.m4b',
    type: file.type || 'audio/mp4',
    metadata,
    cover,
    remoteKey: remoteKey || '',
    sourceUrl: sourceUrl || '',
    savedAt: Date.now(),
  });
};

export const loadCachedAudioBook = async ({ remoteKey, sourceUrl }) => {
  const key = audioBookCacheKey(remoteKey, sourceUrl);
  if (!key) return null;
  const saved = await idbGet(key);
  if (!saved?.blob) return null;
  const file = new window.File([saved.blob], saved.name || 'audiobook.m4b', {
    type: saved.type || saved.blob.type || 'audio/mp4',
  });
  return {
    file,
    metadata: saved.metadata || null,
    cover: saved.cover || null,
    cachedAt: saved.savedAt || 0,
  };
};

export const listCachedAudioBooks = async () => {
  const entries = await idbEntries(PREFIX);
  return entries
    .filter(({ value }) => value?.blob)
    .map(({ key, value }) => {
      const identity = key.slice(PREFIX.length);
      const looksLikeUrl = /^https?:\/\//i.test(identity);
      return {
        key,
        remoteKey: value.remoteKey || (looksLikeUrl ? '' : identity),
        sourceUrl: value.sourceUrl || (looksLikeUrl ? identity : ''),
        name: value.name || 'audiobook.m4b',
        size: Number(value.blob.size) || 0,
        savedAt: value.savedAt || 0,
        title: value.metadata?.title || '',
      };
    })
    .sort((a, b) => b.savedAt - a.savedAt);
};

export const removeCachedAudioBook = async ({ remoteKey, sourceUrl, cacheKey }) => {
  const key = cacheKey?.startsWith(PREFIX)
    ? cacheKey
    : audioBookCacheKey(remoteKey, sourceUrl);
  if (key) await idbDelete(key);
};

export const pruneAudioBookCache = async ({
  protectedKeys = [],
  maxBytes = loadOfflineSettings().maxBytes,
} = {}) => {
  const entries = await listCachedAudioBooks();
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= maxBytes) return [];
  const protectedSet = new Set(protectedKeys.filter(Boolean));
  const candidates = [...entries]
    .filter((entry) => !protectedSet.has(entry.key))
    .sort((a, b) => a.savedAt - b.savedAt);
  const removed = [];

  for (const entry of candidates) {
    if (total <= maxBytes) break;
    await idbDelete(entry.key);
    total -= entry.size;
    removed.push(entry);
  }
  return removed;
};
