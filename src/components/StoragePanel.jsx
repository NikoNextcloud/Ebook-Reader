import { useEffect, useState } from 'react';
import {
  Download,
  HardDrive,
  Upload,
} from 'lucide-react';

// Офлайн сваляне + управление на кеша и резервно копие на библиотеката.
export default function StoragePanel({
  hasText,
  caching,
  cacheProgress,
  onCacheOffline,
  onManageStorage,
  onExport,
  onImport,
}) {
  const [usage, setUsage] = useState(null);

  const refresh = () => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => setUsage(est.usage || 0)).catch(() => {});
    }
  };
  useEffect(refresh, [caching]);

  const mb = usage != null ? (usage / 1048576).toFixed(1) : null;

  return (
    <section className="control-section storage">
      <span className="eyebrow">💾 · ОФЛАЙН И ПАМЕТ</span>
      <h3>Слушай без интернет</h3>
      <button className="storage-btn primary" onClick={onCacheOffline} disabled={!hasText || caching}>
        {caching ? `Генерирам… ${cacheProgress}%` : <><Download aria-hidden="true" /> Свали книгата за офлайн</>}
      </button>
      <div className="storage-row">
        <span>{mb != null ? `Заета памет: ${mb} MB` : 'Кеширан звук'}</span>
        <button className="storage-link" onClick={onManageStorage}><HardDrive aria-hidden="true" /> Управление</button>
      </div>
      <div className="storage-row">
        <button className="storage-link" onClick={onExport}><Download aria-hidden="true" /> Експорт библиотека</button>
        <label className="storage-link import">
          <Upload aria-hidden="true" /> Импорт
          <input type="file" accept=".json" hidden onChange={(e) => { if (e.target.files[0]) onImport(e.target.files[0]); e.target.value = ''; }} />
        </label>
      </div>
    </section>
  );
}
