// Запазва предпочитанията на четеца (глас, скорост, музика…) на устройството.
const KEY = 'voxora_settings';

const defaults = {
  ttsEngine: 'gemini',
  browserVoice: '',
  voice: 'Kore',
  gender: 'female',
  rate: 1,
  music: true,
  genre: 'chillhop',
  volume: 0.32,
  theme: 'auto',
};

export const loadSettings = () => {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...defaults };
  }
};

export const saveSettings = (settings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* localStorage недостъпен */
  }
};
