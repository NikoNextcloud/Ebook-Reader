const TIMECODE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

export const parseTimecode = (value = '') => {
  const match = String(value).trim().match(TIMECODE);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const milliseconds = Number(String(match[4] || '').padEnd(3, '0') || 0);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

const cleanCueText = (lines) => lines
  .join(' ')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const parseTimedText = (input = '') => {
  const blocks = String(input)
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n{2,}/);
  const cues = [];

  blocks.forEach((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return;
    const [rawStart, rawEnd] = lines[timingIndex].split('-->');
    const start = parseTimecode(rawStart);
    const end = parseTimecode(rawEnd?.trim().split(/\s+/)[0]);
    const text = cleanCueText(lines.slice(timingIndex + 1));
    if (start !== null && end !== null && end > start && text) {
      cues.push({ start, end, text });
    }
  });

  return cues.sort((a, b) => a.start - b.start);
};

const sentences = (text = '') => (
  String(text).replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || []
).map((sentence) => sentence.trim()).filter(Boolean);

export const buildApproximateCues = (text, chapters = [], duration = 0) => {
  const parts = sentences(text);
  if (!parts.length || !duration) return [];
  const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1;
  let cursor = 0;

  return parts.map((part, index) => {
    const start = cursor;
    const share = part.length / totalChars;
    cursor = index === parts.length - 1 ? duration : cursor + duration * share;
    return {
      start,
      end: cursor,
      text: part,
      chapter: chapters.reduce(
        (found, chapter, chapterIndex) => (chapter.start <= start ? chapterIndex : found),
        0,
      ),
      approximate: true,
    };
  });
};

export const activeTranscriptCue = (cues = [], time = 0) => {
  const exact = cues.findIndex((cue) => time >= cue.start && time < cue.end);
  if (exact >= 0) return exact;
  return cues.reduce((found, cue, index) => (cue.start <= time ? index : found), 0);
};
