// Опитва да раздели обикновен текст на глави по заглавни редове.
// Без \b — той не работи коректно след кирилица (\w е само ASCII).
const HEADING = /^\s*(глава|част|раздел|chapter|part)([\s.:№#-]|\d|$)/i;

export const splitIntoChapters = (text = '') => {
  const lines = text.split('\n');
  const marks = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const isHeading = HEADING.test(trimmed) || (/^\d+([.)]|\s|$)/.test(trimmed) && trimmed.length <= 60 && trimmed);
    if (isHeading && trimmed.length && trimmed.length <= 80) marks.push({ index, title: trimmed });
  });

  if (marks.length < 2) return null; // няма смисъл от глави

  const chapters = [];
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].index;
    const to = i + 1 < marks.length ? marks[i + 1].index : lines.length;
    const body = lines.slice(from, to).join('\n').trim();
    if (body) chapters.push({ title: marks[i].title.slice(0, 60), text: body });
  }
  return chapters.length >= 2 ? chapters : null;
};
