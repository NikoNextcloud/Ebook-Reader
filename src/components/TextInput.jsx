import { useRef, useState } from 'react';
import { splitIntoChapters } from '../services/chapters';
import { cleanPdfText, cleanMarkdown, cleanRtf, cleanHtml } from '../services/textCleanup';
import {
  MAX_IN_APP_AUDIO_BYTES,
  discoverFourEtiPage,
  downloadRemoteItem,
  formatRemoteSize,
  isFourEtiUrl,
  isMegaUrl,
  isYandexPublicUrl,
  normalizeRemoteUrl,
  openRemoteCatalog,
} from '../services/remoteBooks';

const ext = (name) => name.toLowerCase().split('.').pop();

export default function TextInput({ text, setText, onLoaded, onAudioLoaded }) {
  const input = useRef();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');
  const [remoteCatalog, setRemoteCatalog] = useState(null);
  const [remoteSearch, setRemoteSearch] = useState('');

  const finish = (title, value) => {
    const clean = (value || '').trim();
    if (!clean) { setStatus('Не беше открит текст.'); return; }
    const chapters = splitIntoChapters(clean);
    setText(chapters ? chapters[0].text : clean);
    onLoaded?.({ title, text: clean, chapters });
    setStatus(`Готово · ${clean.split(/\s+/).filter(Boolean).length} думи${chapters ? ` · ${chapters.length} глави` : ''}`);
  };

  const load = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(`Зареждам ${file.name}…`);
    const title = file.name.replace(/\.(txt|docx|pdf|epub|md|rtf|html?|)$/i, '');
    try {
      const type = ext(file.name);
      if (type === 'txt') {
        finish(title, await file.text());
      } else if (type === 'md' || type === 'markdown') {
        finish(title, cleanMarkdown(await file.text()));
      } else if (type === 'rtf') {
        finish(title, cleanRtf(await file.text()));
      } else if (type === 'html' || type === 'htm') {
        finish(title, cleanHtml(await file.text()));
      } else if (type === 'docx') {
        const mammoth = (await import('mammoth')).default;
        finish(title, (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value);
      } else if (type === 'pdf') {
        const buffer = await file.arrayBuffer();
        const pdfjsLib = await import('pdfjs-dist');
        const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
        const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
        let value = '';
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const content = await (await pdf.getPage(i)).getTextContent(); // eslint-disable-line no-await-in-loop
          value += `${content.items.map((x) => x.str).join(' ')}\n\n`;
        }
        // Малко текст спрямо броя страници → вероятно сканиран PDF, пробвай OCR.
        if (value.replace(/\s/g, '').length < pdf.numPages * 40) {
          setStatus('Изглежда сканиран PDF — разпознавам текста (OCR)… това може да отнеме време.');
          const { ocrPdf } = await import('../services/ocr');
          value = await ocrPdf(buffer.slice(0), (p) => setStatus(`OCR разпознаване… ${p}%`));
        }
        finish(title, cleanPdfText(value));
      } else if (type === 'epub') {
        const { parseEpub } = await import('../services/epub');
        const book = await parseEpub(await file.arrayBuffer());
        setText(book.chapters[0].text);
        onLoaded?.({ title: book.title || title, text: book.chapters.map((c) => c.text).join('\n\n'), chapters: book.chapters });
        setStatus(`Готово · ${book.chapters.length} глави`);
      } else {
        throw new Error('Поддържат се .txt, .md, .rtf, .html, .docx, .pdf и .epub файлове.');
      }
    } catch (error) {
      setStatus(error.message || 'Файлът не може да бъде прочетен.');
    } finally {
      setBusy(false);
    }
  };

  const fromUrl = async () => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setStatus('Свалям текста от линка…');
    try {
      const normalized = normalizeRemoteUrl(target);

      if (isMegaUrl(normalized) || isYandexPublicUrl(normalized)) {
        setStatus(isMegaUrl(normalized) ? 'Отварям Mega папката…' : 'Отварям Yandex Disk…');
        const catalog = await openRemoteCatalog(normalized);
        setRemoteCatalog(catalog);
        setRemoteSearch('');
        setStatus(`Намерени: ${catalog.items.length} поддържани файла.`);
        return;
      }

      if (isFourEtiUrl(normalized)) {
        setStatus('Търся публичните файлове на книгата в 4eti.me…');
        const catalog = await discoverFourEtiPage(normalized);
        if (catalog.items.length === 1) {
          const resolved = await openRemoteCatalog(catalog.items[0].url, catalog.items[0].name);
          setRemoteCatalog(resolved);
          setStatus(`Намерени: ${resolved.items.length} формата.`);
        } else {
          setRemoteCatalog(catalog);
          setStatus(`Намерени: ${catalog.items.length} източника.`);
        }
        setRemoteSearch('');
        return;
      }

      if (/\.(txt|md|rtf|html?|docx|pdf|epub)(?:[?#]|$)/i.test(normalized)) {
        const catalog = await openRemoteCatalog(normalized);
        setRemoteCatalog(catalog);
        setRemoteSearch('');
        setStatus('Файлът е готов за импорт.');
        return;
      }

      // r.jina.ai е четец с CORS достъп — връща чист текст на статията.
      const response = await fetch(`https://r.jina.ai/${normalized}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const article = (await response.text()).trim();
      if (!article) throw new Error('empty');
      const title = article.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 60) || 'Статия';
      finish(title, cleanMarkdown(article));
      setShowUrl(false);
      setUrl('');
    } catch {
      setStatus('Линкът не може да се прочете. Провери адреса или копирай текста ръчно.');
    } finally {
      setBusy(false);
    }
  };

  const chooseRemote = async (item) => {
    if (busy) return;

    if (item.kind === 'page') {
      setBusy(true);
      setStatus(`Търся форматите на ${item.name}…`);
      try {
        const discovered = await discoverFourEtiPage(item.url);
        if (discovered.items.length === 1) {
          const catalog = await openRemoteCatalog(discovered.items[0].url, discovered.items[0].name);
          setRemoteCatalog(catalog);
          setStatus(`Намерени: ${catalog.items.length} формата.`);
        } else {
          setRemoteCatalog(discovered);
          setStatus(`Намерени: ${discovered.items.length} източника.`);
        }
        setRemoteSearch('');
      } catch (error) {
        setStatus(error.message || 'Книгата не може да се отвори.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (item.kind === 'source') {
      setBusy(true);
      setStatus(`Отварям ${item.name}…`);
      try {
        const catalog = await openRemoteCatalog(item.url, item.name);
        setRemoteCatalog(catalog);
        setRemoteSearch('');
        setStatus(`Намерени: ${catalog.items.length} поддържани файла.`);
      } catch (error) {
        setStatus(error.message || 'Източникът не може да се отвори.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (item.kind === 'audio' && item.size > MAX_IN_APP_AUDIO_BYTES) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      setStatus(`${item.name} е твърде голяма за паметта на телефона. Отворих я директно в Mega.`);
      return;
    }

    if (
      item.kind === 'audio'
      && item.size > 80 * 1024 * 1024
      && !window.confirm(`Аудиокнигата е ${formatRemoteSize(item.size)} и ще се зареди в паметта на телефона. Да продължа ли?`)
    ) return;

    setBusy(true);
    setStatus(`Свалям ${item.name}${item.size ? ` · ${formatRemoteSize(item.size)}` : ''}…`);
    try {
      const downloaded = await downloadRemoteItem(item);
      if (item.kind === 'audio') {
        onAudioLoaded?.(downloaded);
        setStatus(`Готово · ${item.name}`);
      } else {
        await load(downloaded.file);
      }
      setRemoteCatalog(null);
      setRemoteSearch('');
      setShowUrl(false);
      setUrl('');
    } catch (error) {
      setStatus(error.message || 'Файлът не може да се свали.');
    } finally {
      setBusy(false);
    }
  };

  const pasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) { setText(clip.trim()); setStatus(`Поставени · ${clip.trim().split(/\s+/).filter(Boolean).length} думи`); }
    } catch {
      setStatus('Няма достъп до клипборда — постави с Ctrl+V.');
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files[0]) load(event.dataTransfer.files[0]);
  };

  return (
    <section
      className={`card text-card ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="section-head">
        <div>
          <span className="eyebrow">01 · ТВОЯТ ТЕКСТ</span>
          <h2>Какво искаш да чуеш?</h2>
        </div>
        <div className="text-actions">
          <button className="upload ghost" onClick={pasteClipboard} title="Постави от клипборда">⧉</button>
          <button className="upload ghost" onClick={() => setShowUrl((v) => !v)}>🔗 Линк</button>
          <button className="upload" onClick={() => input.current.click()}>＋ Качи файл</button>
        </div>
        <input ref={input} hidden type="file" accept=".txt,.md,.rtf,.html,.htm,.docx,.pdf,.epub" onChange={(e) => load(e.target.files[0])} />
      </div>
      {showUrl && (
        <div className="url-row">
          <input type="url" value={url} placeholder="Mega, 4eti.me или друг https:// линк" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
          <button onClick={fromUrl} disabled={busy}>{busy ? '…' : 'Извлечи'}</button>
        </div>
      )}
      {remoteCatalog && (
        <div className="remote-picker">
          <div className="remote-picker-head">
            <div>
              <span>ИЗТОЧНИК</span>
              <b>{remoteCatalog.title}</b>
            </div>
            <button onClick={() => { setRemoteCatalog(null); setRemoteSearch(''); }} aria-label="Затвори списъка">×</button>
          </div>
          {remoteCatalog.items.length > 8 && (
            <input
              className="remote-search"
              type="search"
              value={remoteSearch}
              placeholder="Търси заглавие или автор"
              onChange={(event) => setRemoteSearch(event.target.value)}
            />
          )}
          <div className="remote-results">
            {remoteCatalog.items
              .filter((item) => `${item.name} ${item.path || ''}`.toLocaleLowerCase('bg-BG').includes(remoteSearch.toLocaleLowerCase('bg-BG')))
              .slice(0, 80)
              .map((item) => (
                <button key={item.id} onClick={() => chooseRemote(item)} disabled={busy}>
                  <span className={`remote-kind ${item.kind}`}>{item.kind === 'audio' ? '▶' : ['source', 'page'].includes(item.kind) ? '↗' : 'Aa'}</span>
                  <span className="remote-name">
                    <b>{item.name}</b>
                    <small>{[item.path, formatRemoteSize(item.size)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <span className="remote-action">{item.kind === 'audio' && item.size > MAX_IN_APP_AUDIO_BYTES ? 'Mega' : '↓'}</span>
                </button>
              ))}
          </div>
          <small className="remote-count">
            {remoteCatalog.items.filter((item) => `${item.name} ${item.path || ''}`.toLocaleLowerCase('bg-BG').includes(remoteSearch.toLocaleLowerCase('bg-BG'))).length} резултата
          </small>
        </div>
      )}
      <textarea aria-label="Текст за четене" value={text} onChange={(e) => setText(e.target.value)} placeholder="Постави статия, история, бележки или откъс от книга — или пусни файл тук…" />
      <div className="text-meta">
        <span>{status || 'TXT · MD · RTF · HTML · DOCX · PDF · EPUB'}</span>
        <span>{text.length.toLocaleString('bg-BG')} знака</span>
      </div>
    </section>
  );
}
