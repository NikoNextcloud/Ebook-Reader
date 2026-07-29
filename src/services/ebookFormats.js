const imageTypeFromName = (name = '') => {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.gif$/i.test(name)) return 'image/gif';
  return 'image/jpeg';
};

const metadataText = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (value.name) return metadataText(value.name);
    return Object.values(value).map(metadataText).find(Boolean) || '';
  }
  return String(value);
};

const documentText = (document) => {
  if (!document) return '';
  const root = document.body || document.documentElement;
  if (!root) return '';
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script,style,svg,noscript').forEach((node) => node.remove());
  clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  clone.querySelectorAll('p,div,section,article,h1,h2,h3,h4,h5,h6,li,blockquote')
    .forEach((node) => node.append('\n'));
  return (clone.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const flattenToc = (items = []) => items.flatMap((item) => [
  item,
  ...flattenToc(item.subitems || item.children || []),
]);

const ensureImageType = async (blob) => {
  if (!blob || blob.type?.startsWith('image/')) return blob || null;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const type = bytes[0] === 0x89 && bytes[1] === 0x50
    ? 'image/png'
    : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57
      ? 'image/webp'
      : 'image/jpeg';
  return new Blob([blob], { type });
};

const parseReflowableBook = async (file, onProgress) => {
  const { makeBook } = await import('foliate-js/view.js');
  const extension = file.name.toLowerCase().split('.').pop();
  const normalizedFile = file.name.endsWith(`.${extension}`)
    ? file
    : new window.File([file], file.name.replace(/\.[^.]+$/, `.${extension}`), { type: file.type });
  const book = await makeBook(normalizedFile);
  const toc = flattenToc(book.toc);
  const sections = book.sections.filter((section) => section.linear !== 'no');
  const chapters = [];

  try {
    for (let index = 0; index < sections.length; index += 1) {
      onProgress?.(Math.round((index / Math.max(1, sections.length)) * 100));
      const section = sections[index];
      if (typeof section.createDocument !== 'function') continue;
      const document = await section.createDocument();
      const text = documentText(document);
      if (text.length < 10) continue;
      const heading = document.querySelector('h1,h2,h3,title')?.textContent?.trim();
      chapters.push({
        title: heading || toc[chapters.length]?.label || `Глава ${chapters.length + 1}`,
        text,
      });
    }

    if (!chapters.length) {
      throw new Error('Книгата не съдържа четим текст или е защитена с DRM.');
    }

    const rawCover = typeof book.getCover === 'function' ? await book.getCover() : null;
    onProgress?.(100);
    return {
      title: metadataText(book.metadata?.title),
      author: metadataText(book.metadata?.author),
      cover: await ensureImageType(rawCover),
      chapters,
    };
  } finally {
    book.destroy?.();
  }
};

const parseCbz = async (file, onProgress) => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const pages = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.(jpe?g|png|webp|gif)$/i.test(entry.name))
    .sort((a, b) => collator.compare(a.name, b.name));

  if (!pages.length) throw new Error('CBZ архивът не съдържа поддържани изображения.');

  const cover = await pages[0].async('blob');
  const images = [];
  for (let index = 0; index < pages.length; index += 1) {
    const bytes = await pages[index].async('uint8array');
    images.push(new Blob([bytes], { type: imageTypeFromName(pages[index].name) }));
  }

  const { ocrImages } = await import('./ocr');
  const pageTexts = await ocrImages(images, onProgress);
  const chapters = pageTexts
    .map((text, index) => ({ title: `Страница ${index + 1}`, text: text.trim() }))
    .filter((chapter) => chapter.text);

  if (!chapters.length) throw new Error('В CBZ страниците не беше разпознат текст за четене.');
  return {
    title: file.name.replace(/\.cbz$/i, ''),
    author: '',
    cover: new Blob([cover], { type: imageTypeFromName(pages[0].name) }),
    chapters,
  };
};

export const parseEbookFile = async (file, onProgress) => {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'cbz') return parseCbz(file, onProgress);
  if (['mobi', 'azw3', 'fb2'].includes(extension)) {
    return parseReflowableBook(file, onProgress);
  }
  throw new Error('Неподдържан формат на електронна книга.');
};

export const supportedEbookFormats = ['EPUB', 'PDF', 'MOBI', 'AZW3', 'FB2', 'CBZ', 'TXT', 'DOCX'];
