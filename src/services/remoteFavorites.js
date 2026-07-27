const KEY = 'voxora_remote_favorites';

const read = () => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
};

const write = (favorites) => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...favorites]));
  } catch {
    // Любимите остават само за текущата сесия, ако хранилището е недостъпно.
  }
};

export const remoteBookKey = (source, item) => `${source}:${item.url || item.id || item.name}`;

export const loadRemoteFavorites = () => read();

export const setRemoteFavorite = (key, favorite) => {
  const favorites = read();
  if (favorite) favorites.add(key);
  else favorites.delete(key);
  write(favorites);
  return favorites;
};
