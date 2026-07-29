import { describe, expect, it } from 'vitest';
import {
  dailyRecommendationKey,
  selectFeaturedLibrary,
  selectFeaturedStorytel,
} from './StorytelShelf';

describe('selectFeaturedStorytel', () => {
  const items = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `fiction-${index}`,
      kind: 'audio',
      name: `Роман ${index}.m4b`,
      category: 'Романи',
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `bio-${index}`,
      kind: 'audio',
      name: `Биография ${index}.mp3`,
      category: 'Биографии',
    })),
    { id: 'document', kind: 'document', name: 'Книга.epub', category: 'Романи' },
  ];

  it('returns up to ten audio books across categories', () => {
    const selected = selectFeaturedStorytel(items, 10, '2026-07-29');

    expect(selected).toHaveLength(10);
    expect(selected.every((item) => item.kind === 'audio')).toBe(true);
    expect(new Set(selected.map((item) => item.category))).toEqual(new Set(['Биографии', 'Романи']));
  });

  it('keeps the selection stable for the day and changes it on another day', () => {
    const today = selectFeaturedStorytel(items, 10, '2026-07-29').map((item) => item.id);
    const todayAgain = selectFeaturedStorytel(items, 10, '2026-07-29').map((item) => item.id);
    const tomorrow = selectFeaturedStorytel(items, 10, '2026-07-30').map((item) => item.id);

    expect(todayAgain).toEqual(today);
    expect(tomorrow).not.toEqual(today);
  });

  it('selects electronic books and creates a local calendar key', () => {
    const library = Array.from({ length: 14 }, (_, index) => ({
      id: `page-${index}`,
      kind: 'page',
      name: `Книга ${index}`,
    }));

    expect(selectFeaturedLibrary(library, 10, '2026-07-29')).toHaveLength(10);
    expect(dailyRecommendationKey(new Date(2026, 6, 29))).toBe('2026-7-29');
  });
});
