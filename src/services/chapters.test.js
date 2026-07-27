import { describe, it, expect } from 'vitest';
import { splitIntoChapters } from './chapters';

describe('splitIntoChapters', () => {
  it('разделя по заглавни редове „Глава“', () => {
    const text = 'Глава 1\nПърви абзац.\n\nГлава 2\nВтори абзац.';
    const chapters = splitIntoChapters(text);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Глава 1');
    expect(chapters[1].text).toContain('Втори абзац');
  });

  it('връща null при по-малко от две глави', () => {
    expect(splitIntoChapters('Просто един абзац без глави.')).toBeNull();
  });
});
