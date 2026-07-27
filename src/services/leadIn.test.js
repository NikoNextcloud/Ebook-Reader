import { describe, it, expect } from 'vitest';
import { splitLeadIn, buildChunksForPlayback, splitTextForSpeech } from './geminiTtsService';

const longText = Array.from({ length: 400 }, (_, i) => `Изречение номер ${i + 1} от много дълга книга за тестване.`).join(' ');

describe('splitLeadIn', () => {
  it('реже дълго парче на кратко начало и остатък', () => {
    const chunk = 'А'.repeat(0) + Array.from({ length: 60 }, (_, i) => `Изречение ${i + 1} тук.`).join(' ');
    const lead = splitLeadIn(chunk);
    expect(lead).not.toBeNull();
    expect(lead[0].length).toBeLessThanOrEqual(520);
    expect(`${lead[0]} ${lead[1]}`.replace(/\s+/g, ' ')).toBe(chunk.replace(/\s+/g, ' '));
  });

  it('не реже вече кратко парче', () => {
    expect(splitLeadIn('Кратко изречение.')).toBeNull();
  });

  it('реже по думи, ако едно изречение е прекалено дълго', () => {
    const lead = splitLeadIn(`${'дума '.repeat(400)}край.`);
    expect(lead).not.toBeNull();
    expect(lead[0].length).toBeLessThanOrEqual(520);
  });
});

describe('buildChunksForPlayback', () => {
  it('при старт от 0 не променя парчетата', () => {
    const base = splitTextForSpeech(longText);
    const built = buildChunksForPlayback(longText, { startChunk: 0 });
    expect(built.chunks).toEqual(base);
    expect(built.start).toBe(0);
  });

  it('при продължаване от средата прави началното парче кратко', () => {
    const base = splitTextForSpeech(longText);
    const resumeAt = 3;
    expect(base[resumeAt].length).toBeGreaterThan(1000); // пълноразмерно парче

    const built = buildChunksForPlayback(longText, { startChunk: resumeAt });
    expect(built.start).toBe(resumeAt);
    expect(built.chunks[resumeAt].length).toBeLessThanOrEqual(520);
    expect(built.chunks.length).toBe(base.length + 1);
  });

  it('запазва оригиналните индекси, за да не се измества позицията', () => {
    const resumeAt = 3;
    const built = buildChunksForPlayback(longText, { startChunk: resumeAt });
    // двете части на срязаното парче сочат към същия оригинален индекс
    expect(built.origin[resumeAt]).toBe(resumeAt);
    expect(built.origin[resumeAt + 1]).toBe(resumeAt);
    // следващото парче пази оригиналната си номерация
    expect(built.origin[resumeAt + 2]).toBe(resumeAt + 1);
    expect(built.origin[built.origin.length - 1]).toBe(splitTextForSpeech(longText).length - 1);
  });

  it('не губи текст при рязането', () => {
    const resumeAt = 2;
    const base = splitTextForSpeech(longText);
    const built = buildChunksForPlayback(longText, { startChunk: resumeAt });
    const rejoined = `${built.chunks[resumeAt]} ${built.chunks[resumeAt + 1]}`.replace(/\s+/g, ' ').trim();
    expect(rejoined).toBe(base[resumeAt].replace(/\s+/g, ' ').trim());
  });
});
