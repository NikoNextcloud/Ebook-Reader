import { useEffect, useRef, useState } from 'react';
import { splitIntoChapters } from '../services/chapters';
import { cleanPdfText, cleanMarkdown, cleanRtf, cleanHtml } from '../services/textCleanup';
import {
  downloadRemoteItem,
  resolveFourEtiBookItem,
} from '../services/remoteBooks';
import {
  loadRemoteFavorites,
  remoteBookKey,
} from '../services/remoteFavorites';
import BookSourcePicker from './BookSourcePicker';

const ext = (name) => name.toLowerCase().split('.').pop();

export default function TextInput({
  text, setText, cover, onCoverFile, onCoverClear, onLoaded, onAudioLoaded, onEditorMode,
  remoteSuggestion, onRemoteSuggestionHandled,
}) {
  const input = useRef();
  const coverInput = useRef();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');
  const [sourceMode, setSourceMode] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const handledSuggestion = useRef('');

  useEffect(() => {
    onEditorMode?.(sourceMode === 'manual');
  }, [onEditorMode, sourceMode]);

  const finish = (title, value, details = {}) => {
    const clean = (value || '').trim();
    if (!clean) { setStatus('Не беше открит текст.'); return; }
    const chapters = splitIntoChapters(clean);
    setText(chapters ? chapters[0].text : clean);
    onLoaded?.({ title, text: clean, chapters, ...details, cover: details.cover ?? cover });
    setStatus(`Готово · ${clean.split(/\s+/).filter(Boolean).length} думи${chapters ? ` · ${chapters.length} глави` : ''}`);
  };

  const load = async (file, details = {}) => {
    if (!file) return;
    setBusy(true);
    setStatus(`Зареждам ${file.name}…`);
    const fileTitle = file.name.replace(/\.(txt|docx|pdf|epub|mobi|azw3|fb2|cbz|md|rtf|html?|m4b|m4a|mp3|aac)$/i, '');
    const title = details.title || fileTitle;
    try {
      const type = ext(file.name);
      if (['m4b', 'm4a', 'mp3', 'aac'].includes(type)) {
        onAudioLoaded?.(
          { file, name: file.name, metadata: null, cover: null },
          { source: 'local', book: { name: file.name } },
        );
        setStatus(`Готово · ${file.name}`);
      } else if (type === 'txt') {
        finish(title, await file.text(), details);
      } else if (type === 'md' || type === 'markdown') {
        finish(title, cleanMarkdown(await file.text()), details);
      } else if (type === 'rtf') {
        finish(title, cleanRtf(await file.text()), details);
      } else if (type === 'html' || type === 'htm') {
        finish(title, cleanHtml(await file.text()), details);
      } else if (type === 'docx') {
        const mammoth = (await import('mammoth')).default;
        finish(title, (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value, details);
      } else if (type === 'pdf') {
        const buffer = await file.arrayBuffer();
        const pdfjsLib = await import('pdfjs-dist');
        const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
        const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
        let value = '';
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const content = await (await pdf.getPage(i)).getTextContent();
          value += `${content.items.map((x) => x.str).join(' ')}\n\n`;
        }
        // Малко текст спрямо броя страници → вероятно сканиран PDF, пробвай OCR.
        if (value.replace(/\s/g, '').length < pdf.numPages * 40) {
          setStatus('Изглежда сканиран PDF — разпознавам текста (OCR)… това може да отнеме време.');
          const { ocrPdf } = await import('../services/ocr');
          value = await ocrPdf(buffer.slice(0), (p) => setStatus(`OCR разпознаване… ${p}%`));
        }
        finish(title, cleanPdfText(value), details);
      } else if (type === 'epub') {
        const { parseEpub } = await import('../services/epub');
        const book = await parseEpub(await file.arrayBuffer());
        setText(book.chapters[0].text);
        onLoaded?.({
          title: details.title || book.title || title,
          author: details.author || book.author,
          text: book.chapters.map((c) => c.text).join('\n\n'),
          chapters: book.chapters,
          ...details,
          cover: details.cover || book.cover || cover,
        });
        if (book.cover) onCoverFile?.(book.cover, { prepared: true });
        setStatus(`Готово · ${book.chapters.length} глави`);
      } else if (['mobi', 'azw3', 'fb2', 'cbz'].includes(type)) {
        const { parseEbookFile } = await import('../services/ebookFormats');
        const book = await parseEbookFile(file, (percent) => {
          setStatus(type === 'cbz'
            ? `Разпознавам текста в CBZ… ${percent}%`
            : `Разчитам ${type.toUpperCase()}… ${percent}%`);
        });
        const importedCover = details.cover || (book.cover && onCoverFile
          ? await onCoverFile(book.cover).catch(() => '')
          : '');
        const fullText = book.chapters.map((chapter) => chapter.text).join('\n\n');
        setText(book.chapters[0].text);
        onLoaded?.({
          title: details.title || book.title || title,
          author: details.author || book.author,
          text: fullText,
          chapters: book.chapters,
          ...details,
          cover: importedCover || cover,
        });
        setStatus(`Готово · ${book.chapters.length} ${type === 'cbz' ? 'страници' : 'глави'}`);
      } else {
        throw new Error('Поддържат се EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT и DOCX файлове.');
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
      const normalized = /^https?:\/\//i.test(target) ? target : `https://${target}`;
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

  const chooseCover = async (file) => {
    if (!file || coverBusy) return;
    setCoverBusy(true);
    try {
      await onCoverFile?.(file);
      setStatus('Корицата е добавена.');
    } catch (error) {
      setStatus(error.message || 'Корицата не може да бъде добавена.');
    } finally {
      setCoverBusy(false);
      if (coverInput.current) coverInput.current.value = '';
    }
  };

  useEffect(() => {
    const requestId = remoteSuggestion?.requestId;
    const book = remoteSuggestion?.item;
    if (!requestId || !book || handledSuggestion.current === requestId) return undefined;
    handledSuggestion.current = requestId;
    let active = true;

    const importSuggestion = async () => {
      setSourceMode('manual');
      setBusy(true);
      setStatus(`Подготвям „${book.name}“…`);
      try {
        const item = await resolveFourEtiBookItem(book);
        const downloaded = await downloadRemoteItem(item, (percent) => {
          if (active) setStatus(`Свалям „${book.name}“… ${percent}%`);
        });
        if (!active) return;
        const key = remoteBookKey('4eti', book);
        await load(downloaded.file, {
          title: book.name,
          favorite: loadRemoteFavorites().has(key),
          source: '4eti',
          sourceUrl: book.url,
          remoteKey: key,
        });
      } catch (error) {
        if (active) setStatus(error.message || 'Книгата не може да бъде заредена.');
      } finally {
        if (active) {
          setBusy(false);
          onRemoteSuggestionHandled?.();
        }
      }
    };

    importSuggestion();
    return () => { active = false; };
  }, [remoteSuggestion?.requestId]);

  if (sourceMode !== 'manual') {
    return (
      <section className="card text-card source-card">
        <BookSourcePicker
          onManual={() => setSourceMode('manual')}
          onDocument={async (file, context) => {
            await load(file, {
              title: context?.book?.name,
              favorite: context?.favorite,
              source: context?.source,
              sourceUrl: context?.book?.url,
              remoteKey: context?.remoteKey,
            });
            setSourceMode('manual');
          }}
          onAudio={onAudioLoaded}
        />
      </section>
    );
  }

  return (
    <section
      className={`card text-card ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="section-head">
        <div>
          <button className="source-change" onClick={() => setSourceMode('')}>← Източник</button>
          <span className="eyebrow">МОЯТ ТЕКСТ</span>
          <h2>Какво искаш да чуеш?</h2>
        </div>
        <div className="text-actions">
          <button className="upload ghost" onClick={pasteClipboard} title="Постави от клипборда">⧉</button>
          <button className="upload ghost" onClick={() => setShowUrl((v) => !v)}>🔗 Линк</button>
          <button className="upload" onClick={() => input.current.click()}>＋ Качи файл</button>
        </div>
        <input ref={input} hidden type="file" accept=".txt,.md,.rtf,.html,.htm,.docx,.pdf,.epub,.mobi,.azw3,.fb2,.cbz,.m4b,.m4a,.mp3,.aac" onChange={(e) => load(e.target.files[0])} />
      </div>
      {showUrl && (
        <div className="url-row">
          <input type="url" value={url} placeholder="https:// линк към статия" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
          <button onClick={fromUrl} disabled={busy}>{busy ? '…' : 'Извлечи'}</button>
        </div>
      )}
      <div className="manual-cover-row">
        <button
          className="manual-cover-preview"
          type="button"
          onClick={() => coverInput.current?.click()}
          aria-label={cover ? 'Смени корицата' : 'Добави корица'}
        >
          {cover ? <img src={cover} alt="Избрана корица" /> : <span>＋</span>}
        </button>
        <div>
          <b>Корица на книгата</b>
          <small>JPEG, PNG или WebP · изображението се намалява автоматично</small>
        </div>
        <button className="manual-cover-action" type="button" onClick={() => coverInput.current?.click()} disabled={coverBusy}>
          {coverBusy ? 'Обработвам…' : cover ? 'Смени' : 'Избери'}
        </button>
        {cover && (
          <button className="manual-cover-remove" type="button" onClick={onCoverClear} aria-label="Премахни корицата">×</button>
        )}
        <input
          ref={coverInput}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => chooseCover(event.target.files[0])}
        />
      </div>
      <textarea aria-label="Текст за четене" value={text} onChange={(e) => setText(e.target.value)} placeholder="Постави статия, история, бележки или откъс от книга — или пусни файл тук…" />
      <div className="text-meta">
        <span>{status || 'EPUB · PDF · MOBI · AZW3 · FB2 · CBZ · TXT · DOCX'}</span>
        <span>{text.length.toLocaleString('bg-BG')} знака</span>
      </div>
    </section>
  );
}
