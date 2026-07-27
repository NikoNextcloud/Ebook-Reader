import { describe, it, expect, beforeEach } from 'vitest';
import { addListening, flushListening, getStats } from './stats';

const localDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

beforeEach(() => {
  localStorage.clear();
  flushListening();
  localStorage.clear();
});

describe('stats', () => {
  it('отчита слушането по местен ден, не по UTC', () => {
    addListening(20);
    flushListening();
    const saved = JSON.parse(localStorage.getItem('voxora_stats'));
    expect(Object.keys(saved.byDay)).toEqual([localDay()]);
  });

  it('не пише в localStorage на всяка секунда', () => {
    addListening(1);
    addListening(1);
    expect(localStorage.getItem('voxora_stats')).toBeNull();
    // но статистиката вече отчита натрупаното
    expect(getStats().total).toBe(2);
  });

  it('записва след натрупване и сумира правилно', () => {
    for (let i = 0; i < 15; i += 1) addListening(1);
    expect(localStorage.getItem('voxora_stats')).not.toBeNull();
    expect(getStats().total).toBe(15);
    expect(getStats().week).toBe(15);
  });

  it('брои streak за последователни дни', () => {
    localStorage.setItem('voxora_stats', JSON.stringify({
      total: 300,
      byDay: { [localDay(0)]: 100, [localDay(1)]: 100, [localDay(2)]: 100 },
    }));
    expect(getStats().streak).toBe(3);
  });

  it('прекъсва streak при пропуснат ден', () => {
    localStorage.setItem('voxora_stats', JSON.stringify({
      total: 200,
      byDay: { [localDay(0)]: 100, [localDay(2)]: 100 },
    }));
    expect(getStats().streak).toBe(1);
  });
});
