import { idbDelete, idbGet, idbSet } from './idbCache';

const PREFIX = 'remote-audiobook|';

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

export const removeCachedAudioBook = async ({ remoteKey, sourceUrl }) => {
  const key = audioBookCacheKey(remoteKey, sourceUrl);
  if (key) await idbDelete(key);
};
