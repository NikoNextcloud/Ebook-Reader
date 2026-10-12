import {
  downloadNodeToBlob,
  isMegaUrl,
  loadMegaCatalog,
  MAX_IN_APP_AUDIO_BYTES,
} from './remoteBooks';

// Resolve a shared folder/file link in the visitor's own browser instead of
// the application's server. This only works when MEGA permits that visitor
// to access the shared file; it cannot unlock an administratively blocked file.
export const megaFolderUrl = (sourceUrl) => {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== 'https:' || !isMegaUrl(sourceUrl)) {
    throw new Error('Невалиден адрес към MEGA.');
  }
  const folderId = parsed.pathname.match(/^\/folder\/([^/]+)/i)?.[1];
  const key = parsed.hash.slice(1).split('/')[0];
  return folderId && key ? `https://mega.nz/folder/${folderId}#${key}` : sourceUrl;
};

export const findMegaAudio = (catalog, url, name = '') => {
  const items = (catalog?.items || []).filter((item) => item.kind === 'audio' && item._node);
  const exact = items.find((item) => item.url === url);
  if (exact) return exact;
  // Never silently play the wrong book if multiple folders share a filename.
  const named = name ? items.filter((item) => item.name === name) : [];
  return named.length === 1 ? named[0] : null;
};

export const downloadMegaDirect = async (sourceUrl, fileName, onProgress) => {
  const rootUrl = megaFolderUrl(sourceUrl);
  const catalog = await loadMegaCatalog(rootUrl);
  const item = findMegaAudio(catalog, sourceUrl, fileName);
  if (!item) throw new Error('Аудиофайлът не е намерен в публичната MEGA папка.');
  if (item.size > MAX_IN_APP_AUDIO_BYTES) {
    throw new Error('Книгата е над 220 MB. За безопасност я изтегли през MEGA и избери файла от устройството.');
  }
  const type = /\.mp3$/i.test(item.name) ? 'audio/mpeg'
    : /\.aac$/i.test(item.name) ? 'audio/aac' : 'audio/mp4';
  const blob = await downloadNodeToBlob(item._node, { onProgress, type });
  return { file: new File([blob], item.name, { type }), name: item.name };
};
