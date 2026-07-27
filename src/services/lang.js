// Леко разпознаване на езика, за да адаптираме инструкцията към разказвача.
const LANGS = {
  bg: { name: 'български', label: 'Български' },
  ru: { name: 'руски', label: 'Руски' },
  en: { name: 'английски', label: 'English' },
  de: { name: 'немски', label: 'Deutsch' },
  fr: { name: 'френски', label: 'Français' },
  es: { name: 'испански', label: 'Español' },
};

// Български срещу руски: типични български букви/думи, които липсват в руския.
const BG_HINTS = /\b(ще|съм|няма|това|който|защото|който|си|нали)\b|ъ|щ/i;

export const detectLanguage = (text = '') => {
  const sample = text.slice(0, 2000);
  const cyrillic = (sample.match(/[Ѐ-ӿ]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;

  if (cyrillic > latin) {
    return BG_HINTS.test(sample) ? 'bg' : 'ru';
  }
  if (/[äöüß]/i.test(sample)) return 'de';
  if (/[àâçéèêëîïôûù]/i.test(sample)) return 'fr';
  if (/[ñáíóú¿¡]/i.test(sample)) return 'es';
  return 'en';
};

export const langName = (code) => LANGS[code]?.name || 'този';
export const langLabel = (code) => LANGS[code]?.label || code;
