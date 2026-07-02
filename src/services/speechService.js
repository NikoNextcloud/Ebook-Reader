// Voxora speech engine — естествено четене чрез разделяне на изречения,
// леки човешки вариации в темпо/тон и умен избор на глас по пол.

export const getVoices = () => window.speechSynthesis?.getVoices() || [];

const FEMALE_HINT = /kalina|daria|gabriela|elena|maria|anna|eva|ivet|zira|aria|jenny|emma|sonia|natasha|female|woman|жена|женски/i;
const MALE_HINT = /ivan|borislav|georgi|stefan|kiril|nikolay|daniel|guy|ryan|david|george|male|man|мъж|мъжки/i;
const NATURAL_HINT = /natural|neural|online|premium|enhanced|wavenet/i;
const PITCH_DEAF = /natural|neural|online/i; // тези енджини игнорират pitch

const bgPool = voices => {
  const bg = voices.filter(v => v.lang?.toLowerCase().startsWith('bg'));
  return bg.length ? bg : voices;
};

// Връща { voice, pitchShift, simulated } — ако няма истински глас от искания пол,
// избира глас, който уважава pitch, и симулира пола с тонова корекция.
export const pickVoiceForGender = (voices, gender) => {
  const pool = bgPool(voices);
  if (!pool.length) return { voice: null, pitchShift: 1, simulated: false };
  const byQuality = (a, b) => (NATURAL_HINT.test(b.name) ? 1 : 0) - (NATURAL_HINT.test(a.name) ? 1 : 0);
  const hint = gender === 'female' ? FEMALE_HINT : MALE_HINT;
  const other = gender === 'female' ? MALE_HINT : FEMALE_HINT;

  // 1) Глас с явно име от искания пол
  const direct = pool.filter(v => hint.test(v.name)).sort(byQuality);
  if (direct.length) return { voice: direct[0], pitchShift: 1, simulated: false };

  // 2) Google българският глас звучи женски — ползвай го за "женски", ако няма друг
  if (gender === 'female') {
    const g = pool.filter(v => /google/i.test(v.name) && !other.test(v.name));
    if (g.length) return { voice: g[0], pitchShift: 1, simulated: false };
  }

  // 3) Симулация: предпочети глас, който НЕ игнорира pitch (локален)
  const pitchable = pool.filter(v => !PITCH_DEAF.test(v.name)).sort(byQuality);
  const v = pitchable[0] || pool.sort(byQuality)[0];
  return { voice: v, pitchShift: gender === 'female' ? 1.45 : 0.75, simulated: true };
};

export const listVoicesForGender = (voices, gender) => {
  const pool = bgPool(voices);
  const hint = gender === 'female' ? FEMALE_HINT : MALE_HINT;
  const match = pool.filter(v => hint.test(v.name));
  return match.length ? match : pool;
};

// --- Разделяне на текста на естествени фрази --------------------------------
const splitSentences = text => {
  const parts = [];
  const re = /[^.!?…\n]+[.!?…]*\s*|\n+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const chunk = m[0];
    if (chunk.trim()) parts.push({ text: chunk, offset: m.index });
  }
  return parts.length ? parts : [{ text, offset: 0 }];
};

const pauseAfter = chunk => {
  const t = chunk.trimEnd();
  if (/\n\s*$/.test(chunk)) return 620;          // нов абзац — по-дълга пауза
  if (/[!?…]$/.test(t)) return 420;              // емоция/въпрос
  if (/[.]$/.test(t)) return 300;                // край на изречение
  if (/[:;]$/.test(t)) return 240;
  return 140;
};

const jitter = (base, spread) => base * (1 - spread / 2 + Math.random() * spread);

// --- Двигател с опашка от изречения ------------------------------------------
export class SpeechEngine {
  constructor() {
    this.chunks = []; this.idx = 0; this.timer = null;
    this.active = false; this.pausedBetween = false;
    this.opts = {}; this.textLength = 1;
  }

  speak(text, opts) {
    this.stop();
    this.opts = opts;
    this.textLength = Math.max(1, text.length);
    const startAt = opts.startAt || 0;
    const all = splitSentences(text);
    this.chunks = all.filter(c => c.offset + c.text.length > startAt);
    if (this.chunks.length && startAt > this.chunks[0].offset) {
      const first = this.chunks[0];
      const cut = startAt - first.offset;
      this.chunks[0] = { text: first.text.slice(cut), offset: startAt };
    }
    this.idx = 0; this.active = true; this.pausedBetween = false;
    this._next();
  }

  _next() {
    if (!this.active) return;
    if (this.idx >= this.chunks.length) {
      this.active = false;
      this.opts.onEnd?.();
      return;
    }
    const chunk = this.chunks[this.idx];
    const { voice, rate = 1, pitchShift = 1 } = this.opts;
    const u = new SpeechSynthesisUtterance(chunk.text);
    u.voice = voice || null;
    u.lang = voice?.lang || 'bg-BG';
    // Леки човешки вариации: никое изречение не звучи механично еднакво
    u.rate = Math.max(0.6, Math.min(1.8, jitter(rate, 0.05)));
    u.pitch = Math.max(0.4, Math.min(2, jitter(pitchShift, 0.05)));
    u.volume = 1;
    u.onboundary = e => {
      if (typeof e.charIndex === 'number')
        this.opts.onProgress?.(chunk.offset + e.charIndex, this.textLength);
    };
    u.onend = () => {
      if (!this.active) return;
      this.opts.onProgress?.(chunk.offset + chunk.text.length, this.textLength);
      this.idx++;
      this.timer = setTimeout(() => { this.timer = null; this._next(); }, pauseAfter(chunk.text));
    };
    u.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') this.opts.onError?.(e); };
    speechSynthesis.speak(u);
  }

  pause() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; this.pausedBetween = true; }
    else speechSynthesis.pause();
  }

  resume() {
    if (this.pausedBetween) { this.pausedBetween = false; this._next(); }
    else speechSynthesis.resume();
  }

  stop() {
    this.active = false; this.pausedBetween = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    speechSynthesis.cancel();
  }
}

export const ttsProviders = {
  browser: { id: 'browser', label: 'Глас от устройството', requiresKey: false },
  openai: { id: 'openai', label: 'OpenAI TTS', requiresKey: true },
  elevenlabs: { id: 'elevenlabs', label: 'ElevenLabs', requiresKey: true },
};
