import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';

describe('Hobby plan serverless function budget', () => {
  it('keeps deployment entrypoints below the Vercel limit of 12', () => {
    const paths = readdirSync('api');
    expect(paths).not.toContain('nextcloud-lib.js');
    expect(paths.filter((path) => path.endsWith('.test.js'))).toEqual([]);
    expect(paths.filter((path) => path.endsWith('.js'))).toHaveLength(9);
  });
});
