import { describe, expect, it } from 'vitest';
import {
  normalizeAudioChapters,
  parseNeroChapterBox,
} from './m4bChapters';

describe('M4B chapters', () => {
  it('normalizes sidecar chapters and fills their end times', () => {
    expect(normalizeAudioChapters([
      { title: 'Начало', start: 0 },
      { name: 'Глава 2', start_ms: 90000 },
    ], 180)).toEqual([
      { title: 'Начало', start: 0, end: 90 },
      { title: 'Глава 2', start: 90, end: 180 },
    ]);
  });

  it('parses a Nero chpl box produced by an M4B container', () => {
    const encoder = new globalThis.TextEncoder();
    const first = encoder.encode('Начало');
    const second = encoder.encode('Глава 2');
    const data = new Uint8Array(9 + 8 + 1 + first.length + 8 + 1 + second.length);
    const view = new DataView(data.buffer);
    data[0] = 1;
    data[8] = 2;
    let offset = 9;
    view.setUint32(offset, 0);
    view.setUint32(offset + 4, 0);
    offset += 8;
    data[offset] = first.length;
    data.set(first, offset + 1);
    offset += 1 + first.length;
    view.setUint32(offset, 0);
    view.setUint32(offset + 4, 300000000);
    offset += 8;
    data[offset] = second.length;
    data.set(second, offset + 1);

    expect(parseNeroChapterBox(data, 60)).toEqual([
      { title: 'Начало', start: 0, end: 30 },
      { title: 'Глава 2', start: 30, end: 60 },
    ]);
  });
});
