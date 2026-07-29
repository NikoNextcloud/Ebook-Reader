import { describe, expect, it } from 'vitest';
import {
  activeTranscriptCue,
  buildApproximateCues,
  parseTimedText,
  parseTimecode,
} from './transcript';

describe('transcript helpers', () => {
  it('parses SRT and VTT timecodes', () => {
    expect(parseTimecode('01:02:03,500')).toBe(3723.5);
    expect(parseTimecode('02:03.250')).toBe(123.25);
    expect(parseTimedText(`WEBVTT

00:00:01.000 --> 00:00:03.000
Първо изречение.

2
00:00:03,000 --> 00:00:05,500
Второ изречение.`)).toEqual([
      { start: 1, end: 3, text: 'Първо изречение.' },
      { start: 3, end: 5.5, text: 'Второ изречение.' },
    ]);
  });

  it('builds approximate cues and finds the active sentence', () => {
    const cues = buildApproximateCues('Първо. Второто е по-дълго.', [], 30);
    expect(cues).toHaveLength(2);
    expect(cues.at(-1).end).toBe(30);
    expect(activeTranscriptCue(cues, 29)).toBe(1);
  });
});
