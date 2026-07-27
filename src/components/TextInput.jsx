import { useEffect, useRef, useState } from 'react';
import { splitIntoChapters } from '../services/chapters';
import { cleanPdfText, cleanMarkdown, cleanRtf, cleanHtml } from '../services/textCleanup';
import BookSourcePicker from './BookSourcePicker';

const ext = (name) => name.toLowerCase().split('.').pop();

export default function TextInput({ text, setText, onLoaded, onAudioLoaded, onEditorMode }) {
  const input = useRef();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');
  const [sourceMode, setSourceMode] = useState('');

  useEffect(() => {
    onEditorMode?.(sourceMode === 'manual');
  }, [onEditorMode, sourceMode]);

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

  if (sourceMode !== 'manual') {
    return (
      <section className="card text-card source-card">
        <BookSourcePicker
          onManual={() => setSourceMode('manual')}
          onDocument={async (file) => {
            await load(file);
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
        <input ref={input} hidden type="file" accept=".txt,.md,.rtf,.html,.htm,.docx,.pdf,.epub" onChange={(e) => load(e.target.files[0])} />
      </div>
      {showUrl && (
        <div className="url-row">
          <input type="url" value={url} placeholder="https:// линк към статия" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
          <button onClick={fromUrl} disabled={busy}>{busy ? '…' : 'Извлечи'}</button>
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
