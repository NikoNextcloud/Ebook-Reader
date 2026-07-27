import { describe, it, expect } from 'vitest';
import { splitTextForSpeech } from './geminiTtsService';

describe('splitTextForSpeech (бърз старт)', () => {
  it('прави първото парче малко, а следващите по-големи', () => {
    const long = Array.from({ length: 200 }, (_, i) => `Изречение номер ${i + 1} от дълъг текст.`).join(' ');
    const chunks = splitTextForSpeech(long);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0].length).toBeLessThanOrEqual(520);
    expect(chunks[1].length).toBeLessThanOrEqual(1200);
    // рампа: първо < второ < трето (пълен размер)
    expect(chunks[1].length).toBeGreaterThan(chunks[0].length);
    expect(chunks[2].length).toBeGreaterThan(chunks[1].length);
  });

  it('връща един елемент за кратък текст', () => {
    expect(splitTextForSpeech('Кратко изречение.')).toEqual(['Кратко изречение.']);
  });

  it('връща празен масив за празен вход', () => {
    expect(splitTextForSpeech('   ')).toEqual([]);
  });
});
