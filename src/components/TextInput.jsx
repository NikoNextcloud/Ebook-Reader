import { useRef, useState } from 'react';
import { splitIntoChapters } from '../services/chapters';

const ext = (name) => name.toLowerCase().split('.').pop();

export default function TextInput({ text, setText, onLoaded }) {
  const input = useRef();
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState('');

  const finish = (title, value) => {
    const clean = (value || '').trim();
    if (!clean) { setStatus('Файлът е празен.'); return; }
    const chapters = splitIntoChapters(clean);
    setText(chapters ? chapters[0].text : clean);
    onLoaded?.({ title, text: clean, chapters });
    setStatus(`Готово · ${clean.split(/\s+/).filter(Boolean).length} думи${chapters ? ` · ${chapters.length} глави` : ''}`);
  };

  const load = async (file) => {
    if (!file) return;
    setStatus(`Зареждам ${file.name}…`);
    const title = file.name.replace(/\.(txt|docx|pdf|epub)$/i, '');
    try {
      const type = ext(file.name);
      if (type === 'txt') {
        finish(title, await file.text());
      } else if (type === 'docx') {
        const mammoth = (await import('mammoth')).default;
        finish(title, (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value);
      } else if (type === 'pdf') {
        const pdfjsLib = await import('pdfjs-dist');
        const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let value = '';
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const content = await (await pdf.getPage(i)).getTextContent(); // eslint-disable-line no-await-in-loop
          value += `${content.items.map((x) => x.str).join(' ')}\n\n`;
        }
        finish(title, value);
      } else if (type === 'epub') {
        const { parseEpub } = await import('../services/epub');
        const book = await parseEpub(await file.arrayBuffer());
        setText(book.chapters[0].text);
        onLoaded?.({ title: book.title || title, text: book.chapters.map((c) => c.text).join('\n\n'), chapters: book.chapters });
        setStatus(`Готово · ${book.chapters.length} глави`);
      } else {
        throw new Error('Поддържат се .txt, .docx, .pdf и .epub файлове.');
      }
    } catch (error) {
      setStatus(error.message || 'Файлът не може да бъде прочетен.');
    }
  };

  const fromUrl = async () => {
    if (!url.trim()) return;
    setStatus('Свалям текста от линка…');
    try {
      const html = await (await fetch(url.trim())).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,nav,header,footer,aside').forEach((n) => n.remove());
      const title = doc.querySelector('title')?.textContent?.trim() || 'Статия';
      finish(title, doc.body?.textContent || '');
      setShowUrl(false);
      setUrl('');
    } catch {
      setStatus('Линкът не може да се прочете (възможно е сайтът да блокира достъпа). Копирай текста ръчно.');
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
          <button className="upload ghost" onClick={() => setShowUrl((v) => !v)}>🔗 Линк</button>
          <button className="upload" onClick={() => input.current.click()}>＋ Качи файл</button>
        </div>
        <input ref={input} hidden type="file" accept=".txt,.docx,.pdf,.epub" onChange={(e) => load(e.target.files[0])} />
      </div>
      {showUrl && (
        <div className="url-row">
          <input type="url" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromUrl()} />
          <button onClick={fromUrl}>Извлечи</button>
        </div>
      )}
      <textarea aria-label="Текст за четене" value={text} onChange={(e) => setText(e.target.value)} placeholder="Постави статия, история, бележки или откъс от книга — или пусни файл тук…" />
      <div className="text-meta">
        <span>{status || 'TXT · DOCX · PDF · EPUB · или пусни файл'}</span>
        <span>{text.length.toLocaleString('bg-BG')} знака</span>
      </div>
    </section>
  );
}
