// Почистване на извлечен текст за по-добро четене на глас.

// PDF: обединява пренесени с тире думи, слепва редове в абзаци, маха номера на страници.
export const cleanPdfText = (raw) => {
  if (!raw) return '';
  return raw
    .replace(/([\p{L}\p{N}]+)-\n\s*([\p{L}\p{N}]+)/gu, '$1$2') // при-\nмер → пример (вкл. кирилица)
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => {
      // махни редове, които са само число (номер на страница)
      if (/^\d{1,4}$/.test(line)) return false;
      // махни повтарящи се колонтитули
      return !(line && lines.indexOf(line) !== index && line.length < 40 && lines.filter((l) => l === line).length > 2);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// Markdown → чист текст (маха # * _ ` линкове, но пази думите).
export const cleanMarkdown = (raw) =>
  (raw || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_>]{1,3}/g, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Основно RTF → текст (маха control words и фигурни скоби).
export const cleanRtf = (raw) =>
  (raw || '')
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '') // control words: \rtf1, \b, \fs24 …
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// HTML → текст (използва DOMParser, маха скриптове и навигация).
export const cleanHtml = (raw) => {
  const doc = new DOMParser().parseFromString(raw || '', 'text/html');
  doc.querySelectorAll('script,style,nav,header,footer,aside,noscript').forEach((node) => node.remove());
  return (doc.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
};
