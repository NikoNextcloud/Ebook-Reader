import { describe, expect, it } from 'vitest';
import { selectFeaturedStorytel } from './StorytelShelf';

describe('selectFeaturedStorytel', () => {
  it('returns up to ten audio books across categories', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `fiction-${index}`,
        kind: 'audio',
        name: `Роман ${index}.m4b`,
        category: 'Романи',
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `bio-${index}`,
        kind: 'audio',
        name: `Биография ${index}.mp3`,
        category: 'Биографии',
      })),
      { id: 'document', kind: 'document', name: 'Книга.epub', category: 'Романи' },
    ];

    const selected = selectFeaturedStorytel(items);

    expect(selected).toHaveLength(10);
    expect(selected.every((item) => item.kind === 'audio')).toBe(true);
    expect(selected.slice(0, 2).map((item) => item.category)).toEqual(['Биографии', 'Романи']);
  });
});
