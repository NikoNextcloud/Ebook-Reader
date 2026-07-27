// Постоянен кеш за генерирания звук в IndexedDB — позволява офлайн повторно
// слушане и пести Gemini квота между сесиите.
const DB_NAME = 'voxora-audio';
const STORE = 'chunks';
let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB не се поддържа'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const tx = async (mode, run) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = run(store);
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const idbGet = async (key) => {
  try {
    return await tx('readonly', (store) => store.get(key));
  } catch {
    return undefined;
  }
};

export const idbSet = async (key, blob) => {
  try {
    await tx('readwrite', (store) => store.put(blob, key));
    return true;
  } catch {
    /* квотата за диск може да е изчерпана */
    return false;
  }
};

export const idbDelete = async (key) => {
  try {
    await tx('readwrite', (store) => store.delete(key));
  } catch {
    /* игнорирай недостъпен кеш */
  }
};

export const idbClear = async () => {
  try {
    await tx('readwrite', (store) => store.clear());
  } catch {
    /* игнорирай */
  }
};
