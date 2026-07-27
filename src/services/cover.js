// Генерира красива корица от заглавието, когато няма истинска (EPUB) корица.
const PALETTES = [
  ['#2b4d47', '#ec705a'],
  ['#1f3a5f', '#e0a458'],
  ['#3a2b4d', '#c96a8a'],
  ['#154734', '#77b28c'],
  ['#4d2b2b', '#e08a5a'],
  ['#233d4d', '#5aa0c9'],
  ['#3d3a2b', '#d4b45a'],
];

const hash = (value) => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const coverStyle = (title = '') => {
  const [from, to] = PALETTES[hash(title) % PALETTES.length];
  const angle = 120 + (hash(title) % 90);
  return { background: `linear-gradient(${angle}deg, ${from}, ${to})` };
};

export const initials = (title = '?') => {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

export const formatDuration = (seconds) => {
  if (!seconds) return '0 мин.';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} ч. ${m} мин.` : `${m} мин.`;
};
