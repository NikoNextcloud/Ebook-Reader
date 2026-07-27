import { splitTextForSpeech } from './geminiTtsService';

const MAX_UTTERANCE_LENGTH = 220;

const splitForBrowser = (text) => {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+["“”']?|[^.!?…]+$/g) || [clean];
  const parts = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = `${current} ${sentence}`.trim();
    if (candidate.length <= MAX_UTTERANCE_LENGTH) {
      current = candidate;
      continue;
    }
    if (current) parts.push(current);
    current = '';
    for (const word of sentence.trim().split(/\s+/)) {
      const next = `${current} ${word}`.trim();
      if (next.length > MAX_UTTERANCE_LENGTH && current) {
        parts.push(current);
        current = word;
      } else {
        current = next;
      }
    }
  }
  if (current) parts.push(current);
  return parts;
};

export const getBrowserVoices = () => {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  const all = window.speechSynthesis.getVoices();
  const bulgarian = all.filter((voice) => /^bg([-_]|$)/i.test(voice.lang));
  return bulgarian.length ? bulgarian : all;
};

const chooseVoice = (name, index, alternateVoices) => {
  const voices = getBrowserVoices();
  if (!voices.length) return null;
  const selectedIndex = Math.max(0, voices.findIndex((voice) => voice.name === name));
  if (!alternateVoices || voices.length < 2) return voices[selectedIndex];
  return voices[(selectedIndex + index) % voices.length];
};

export class BrowserTTS {
  constructor() {
    this.chunks = [];
    this.currentChunk = 0;
    this.currentPart = 0;
    this.options = null;
    this.cancelled = false;
    this.paused = false;
    this.utterance = null;
    this.spokenChars = 0;
    this.chunkParts = [];
  }

  async unlockAudio() {
    return !!window.speechSynthesis;
  }

  async generate(text, options) {
    this.stop();
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === 'undefined') {
      throw new Error('Този браузър не поддържа гласово четене от устройството.');
    }
    this.cancelled = false;
    this.paused = false;
    this.options = options;
    this.chunks = options.singleChunk ? [(text || '').trim()] : splitTextForSpeech(text);
    if (!this.chunks.length) {
      options.onEnd?.();
      return;
    }
    const start = Math.min(Math.max(0, options.startChunk || 0), this.chunks.length - 1);
    this.playFrom(start);
  }

  playFrom(index) {
    if (this.cancelled || !this.options || !this.chunks[index]) return;
    window.speechSynthesis.cancel();
    this.currentChunk = index;
    this.currentPart = 0;
    this.spokenChars = 0;
    this.chunkParts = splitForBrowser(this.chunks[index]);
    this.options.onChunk?.(index, this.chunks.length);
    this.speakPart();
  }

  speakPart() {
    if (this.cancelled || !this.options) return;
    const text = this.chunkParts[this.currentPart];
    if (!text) {
      if (this.currentChunk + 1 < this.chunks.length) {
        this.playFrom(this.currentChunk + 1);
      } else {
        this.options.onProgress?.(100);
        this.options.onEnergy?.(0);
        this.options.onEnd?.();
      }
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.options.language === 'bg' ? 'bg-BG' : this.options.language || 'bg-BG';
    utterance.rate = Math.max(0.65, Math.min(1.55, this.options.rate || 1));
    utterance.pitch = 1;
    utterance.voice = chooseVoice(
      this.options.browserVoiceName,
      this.currentChunk,
      this.options.alternateVoices,
    );
    utterance.onstart = () => this.options?.onEnergy?.(0.34);
    utterance.onboundary = (event) => {
      const localChars = Math.max(0, event.charIndex || 0);
      const chunkChars = Math.max(1, this.chunks[this.currentChunk].length);
      const partFraction = Math.min(1, (this.spokenChars + localChars) / chunkChars);
      this.reportPosition(partFraction);
      this.options?.onEnergy?.(0.24 + Math.random() * 0.24);
    };
    utterance.onerror = (event) => {
      if (this.cancelled || event.error === 'canceled' || event.error === 'interrupted') return;
      this.options?.onEnergy?.(0);
      this.options?.onError?.(new Error('Гласът на устройството спря. Опитай с друг глас.'));
    };
    utterance.onend = () => {
      if (this.cancelled) return;
      this.spokenChars += text.length;
      this.currentPart += 1;
      this.reportPosition(Math.min(1, this.spokenChars / Math.max(1, this.chunks[this.currentChunk].length)));
      this.speakPart();
    };
    this.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  reportPosition(partFraction) {
    const total = Math.max(1, this.chunks.length);
    const duration = Math.max(1, this.chunks[this.currentChunk].split(/\s+/).length / 2.75);
    const chunkTime = duration * partFraction;
    this.options?.onProgress?.(Math.min(99.5, ((this.currentChunk + partFraction) / total) * 100));
    this.options?.onPosition?.({
      chunk: this.currentChunk,
      total,
      chunkTime,
      chunkDuration: duration,
    });
  }

  pause() {
    if (!window.speechSynthesis?.speaking) return;
    window.speechSynthesis.pause();
    this.paused = true;
    this.options?.onEnergy?.(0);
  }

  async resume() {
    if (!window.speechSynthesis) return false;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    else if (!window.speechSynthesis.speaking && this.utterance) window.speechSynthesis.speak(this.utterance);
    this.paused = false;
    this.options?.onEnergy?.(0.34);
    return true;
  }

  stop() {
    this.cancelled = true;
    this.paused = false;
    this.options?.onEnergy?.(0);
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    this.utterance = null;
  }

  jumpToChunk(index) {
    if (index < 0 || index >= this.chunks.length) return;
    this.cancelled = false;
    this.paused = false;
    this.playFrom(index);
  }

  next() { this.jumpToChunk(this.currentChunk + 1); }
  prev() { this.jumpToChunk(Math.max(0, this.currentChunk - 1)); }

  skip(seconds) {
    const direction = seconds < 0 ? -1 : 1;
    this.jumpToChunk(Math.max(0, Math.min(this.chunks.length - 1, this.currentChunk + direction)));
  }

  seekFraction(fraction) {
    const index = Math.min(
      this.chunks.length - 1,
      Math.max(0, Math.floor(Math.max(0, Math.min(1, fraction)) * this.chunks.length)),
    );
    this.jumpToChunk(index);
  }

  setPlaybackRate(rate) {
    if (!this.options) return;
    this.options.rate = rate;
    if (!this.paused && this.chunks.length) this.playFrom(this.currentChunk);
  }
}
