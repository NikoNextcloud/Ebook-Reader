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

  // 2. заглавие на книгата
  const bookTitle = opf.querySelector('title')?.textContent?.trim() || '';

  // 3. карта id -> href от manifest
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((item) => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });

  // 4. ред на четене от spine
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
  return { title: bookTitle, chapters };
};
