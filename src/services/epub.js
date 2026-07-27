// Разчита EPUB (zip с XHTML файлове) и връща главите като { title, text }.
// JSZip се зарежда лениво само когато потребителят отвори EPUB.
const stripHtml = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style').forEach((node) => node.remove());
  return (doc.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
};

const resolvePath = (base, relative) => {
  const stack = base.split('/').slice(0, -1);
  relative.split('/').forEach((part) => {
    if (part === '..') stack.pop();
    else if (part !== '.') stack.push(part);
  });
  return stack.join('/');
};

// Умалява корица до макс 260px и връща лек JPEG data URL.
const shrinkImage = (bytes) => new Promise((resolve) => {
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const max = 260;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.72));
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  img.src = url;
});

export const parseEpub = async (arrayBuffer) => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. namiri OPF файла през META-INF/container.xml
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = containerXml
    ? new DOMParser().parseFromString(containerXml, 'application/xml').querySelector('rootfile')?.getAttribute('full-path')
    : Object.keys(zip.files).find((name) => name.endsWith('.opf'));

  if (!opfPath) throw new Error('Невалиден EPUB файл.');

  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');

  // 2. заглавие и автор на книгата
  const bookTitle = opf.querySelector('title')?.textContent?.trim() || '';
  const author = opf.querySelector('creator')?.textContent?.trim() || '';

  // 3. карта id -> href от manifest (+ href на корицата)
  const manifest = {};
  let coverHref = null;
  opf.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    manifest[id] = href;
    const props = item.getAttribute('properties') || '';
    if (props.includes('cover-image') || /cover/i.test(id)) {
      if (/\.(jpe?g|png|gif|webp)$/i.test(href || '')) coverHref = href;
    }
  });

  // 4. извади и умали корицата (за да не тежи на localStorage)
  let cover = null;
  if (coverHref) {
    try {
      const bytes = await zip.file(resolvePath(opfPath, coverHref))?.async('uint8array');
      if (bytes) cover = await shrinkImage(bytes);
    } catch { /* без корица */ }
  }

  // 5. ред на четене от spine
  const chapters = [];
  const spineItems = [...opf.querySelectorAll('spine > itemref')];

  for (let i = 0; i < spineItems.length; i += 1) {
    const href = manifest[spineItems[i].getAttribute('idref')];
    if (!href) continue;
    const fullPath = resolvePath(opfPath, href);
    const html = await zip.file(fullPath)?.async('string'); // eslint-disable-line no-await-in-loop
    if (!html) continue;
    const text = stripHtml(html);
    if (text.length < 20) continue; // прескачай корици/празни страници
    const heading = new DOMParser().parseFromString(html, 'text/html').querySelector('h1,h2,h3')?.textContent?.trim();
    chapters.push({ title: heading || `Глава ${chapters.length + 1}`, text });
  }

  if (!chapters.length) throw new Error('EPUB файлът не съдържа четим текст.');
  return { title: bookTitle, author, cover, chapters };
};
