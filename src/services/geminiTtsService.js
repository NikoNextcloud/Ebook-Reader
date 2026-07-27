import { GoogleGenAI, Modality } from '@google/genai';
import { idbGet, idbSet } from './idbCache';
import { langName } from './lang';

// Кеш в паметта за бърз достъп; IndexedDB пази звука между сесиите (офлайн).
const audioCache = new Map();
const MAX_CHUNK_LENGTH = 2600;
// Първото парче е нарочно малко → звукът тръгва бързо, а останалото се
// дозарежда (prefetch), докато слушаш.
const FIRST_CHUNK_LENGTH = 520;
const SAMPLE_RATE = 24000;

const wavFromPcmBytes = (pcm, sampleRate = SAMPLE_RATE) => {
  const out = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(out);
  const writeWord = (offset, word) => {
    [...word].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  };

  writeWord(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeWord(8, 'WAVE');
  writeWord(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWord(36, 'data');
  view.setUint32(40, pcm.length, true);
  new Uint8Array(out, 44).set(pcm);

  return new Blob([out], { type: 'audio/wav' });
};

const pcmToWav = (base64) => {
  const raw = atob(base64);
  const pcm = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    pcm[i] = raw.charCodeAt(i);
  }
  return wavFromPcmBytes(pcm);
};

// Обединява WAV парчетата в един файл (еднакъв формат: 24 kHz, моно, 16 bit).
export const concatWavBlobs = async (blobs) => {
  const bodies = await Promise.all(
    blobs.map(async (blob) => new Uint8Array(await blob.arrayBuffer()).subarray(44)),
  );
  const total = bodies.reduce((sum, body) => sum + body.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const body of bodies) {
    merged.set(body, offset);
    offset += body.length;
  }
  return wavFromPcmBytes(merged);
};

const isQuotaError = (error) => /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(String(error?.message || error));

const friendlyError = (error) => {
  if (isQuotaError(error)) {
    return new Error('Безплатният дневен лимит за AI гласове е изчерпан. Опитай отново след нулирането на лимита или активирай Billing в Google AI Studio.');
  }
  if (/API_KEY|API key|401|403/i.test(String(error?.message || error))) {
    return new Error('Gemini API ключът е невалиден или няма достъп до TTS модела.');
  }
  return new Error('AI гласът временно не може да бъде генериран. Опитай отново след малко.');
};

// Плавно нарастване на дължината: 1-во парче малко (бърз старт), 2-ро средно,
// след това пълния лимит — така prefetch-ът винаги успява да изпревари слушането.
const SECOND_CHUNK_LENGTH = 1200;

// Пакетира изреченията в парчета според capFor(index).
const packSentences = (sentences, capFor) => {
  const chunks = [];
  let current = '';
  const cap = () => capFor(chunks.length);

  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();

    if (next.length <= cap()) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (sentence.trim().length <= cap()) {
      current = sentence.trim();
      continue;
    }

    // изречение по-дълго от лимита → разбий по думи
    const words = sentence.trim().split(' ');
    let wordChunk = '';
    for (const word of words) {
      const candidate = `${wordChunk} ${word}`.trim();
      if (candidate.length > cap() && wordChunk) {
        chunks.push(wordChunk);
        wordChunk = word;
      } else {
        wordChunk = candidate;
      }
    }
    if (wordChunk) current = wordChunk;
  }

  if (current) chunks.push(current);
  return chunks;
};

export const splitTextForSpeech = (text, { fastStart = true } = {}) => {
  const cleanText = (text || '').replace(/\s+/g, ' ').trim();

  if (!cleanText) return [];

  const capFor = fastStart
    ? (index) => (index === 0 ? FIRST_CHUNK_LENGTH : index === 1 ? SECOND_CHUNK_LENGTH : MAX_CHUNK_LENGTH)
    : () => MAX_CHUNK_LENGTH;

  if (cleanText.length <= capFor(0)) return [cleanText];

  const sentences = cleanText.match(/[^.!?…]+[.!?…]+["“”']?|[^.!?…]+$/g) || [cleanText];
  return packSentences(sentences, capFor);
};

const rateBucket = (rate) => {
  if (rate < 0.85) return 'slow';
  if (rate > 1.2) return 'fast';
  return 'normal';
};

const paceInstruction = (rate) => {
  if (rate < 0.85) return 'бавно, ясно и изразително';
  if (rate > 1.2) return 'по-бързо, но ясно и приятно за слушане';
  return 'естествено, спокойно и с добра дикция';
};

const buildPrompt = (text, rate, language = 'bg') => `Прочети следния ${langName(language)} текст ${paceInstruction(rate)}, като професионален разказвач на аудиокнига. Не добавяй думи, не пропускай думи и не обяснявай задачата. Чети само текста:

${text}`;

const hash = (value) => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

const cacheKey = (voiceName, rate, language, chunkText) => `${voiceName}|${language}|${rateBucket(rate)}|${hash(chunkText)}`;
const fallbackVoiceByGender = { female: 'Kore', male: 'Puck' };

const alternatingVoiceForChunk = (options, index) => {
  const primary = options.voiceName;
  if (!options.alternateVoices) return primary;

  const primaryGender = options.gender === 'male' ? 'male' : 'female';
  const otherGender = primaryGender === 'male' ? 'female' : 'male';
  return index % 2 === 0 ? primary : fallbackVoiceByGender[otherGender];
};

export class GeminiTTS {
  constructor() {
    this.audio = null;
    this.url = null;
    this.cancelled = false;
    this.chunks = [];
    this.currentChunk = 0;
    this.options = null;
    this.ai = null;
    this.inflight = new Map();
    this.unlocked = false;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.energyFrame = null;
  }

  async unlockAudio() {
    if (this.unlocked) return;
    const silent = wavFromPcmBytes(new Uint8Array([0, 0]));
    const url = URL.createObjectURL(silent);
    const audio = this.audio || new Audio();
    const previousVolume = audio.volume;
    audio.src = url;
    audio.volume = 0;
    audio.playsInline = true;
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.volume = previousVolume;
    URL.revokeObjectURL(url);
    audio.removeAttribute('src');
    this.audio = audio;
    this.unlocked = true;
  }

  async request(model, prompt, voiceName) {
    const response = await this.ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData?.data;
    if (!data) throw new Error('NO_AUDIO');
    return pcmToWav(data);
  }

  async requestWithFallback(prompt, voiceName) {
    try {
      return await this.request('gemini-3.1-flash-tts-preview', prompt, voiceName);
    } catch (firstError) {
      if (!isQuotaError(firstError)) throw friendlyError(firstError);
      try {
        return await this.request('gemini-2.5-flash-preview-tts', prompt, voiceName);
      } catch (secondError) {
        throw friendlyError(secondError);
      }
    }
  }

  // Връща (или генерира) звука за парче — памет → IndexedDB → Gemini.
  blobForChunk(index) {
    if (index < 0 || index >= this.chunks.length) return Promise.resolve(null);

    const { rate = 1, language = 'bg' } = this.options;
    const voiceName = alternatingVoiceForChunk(this.options, index);
    const key = cacheKey(voiceName, rate, language, this.chunks[index]);

    if (audioCache.has(key)) return Promise.resolve(audioCache.get(key));
    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = idbGet(key)
      .then((stored) => {
        if (stored) {
          audioCache.set(key, stored);
          this.inflight.delete(key);
          return stored;
        }
        return this.requestWithFallback(buildPrompt(this.chunks[index], rate, language), voiceName)
          .then((blob) => {
            audioCache.set(key, blob);
            idbSet(key, blob);
            this.inflight.delete(key);
            return blob;
          });
      })
      .catch((error) => {
        this.inflight.delete(key);
        throw error;
      });

    this.inflight.set(key, promise);
    return promise;
  }

  // Подготвя контекста (модел + парчета) без възпроизвеждане — за сваляне.
  prepare(text, options) {
    this.cancelled = false;
    this.options = options;
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.chunks = options.singleChunk ? [(text || '').trim()] : splitTextForSpeech(text);
  }

  async generate(text, options) {
    this.stop({ keepUnlocked: true });
    this.cancelled = false;
    this.options = options;
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.chunks = options.singleChunk ? [(text || '').trim()] : splitTextForSpeech(text);

    if (!this.chunks.length) {
      options.onEnd?.();
      return;
    }

    const start = Math.min(Math.max(0, options.startChunk || 0), this.chunks.length - 1);
    await this.playFrom(start);
  }

  async playFrom(index) {
    if (this.cancelled || !this.options) return;

    this.currentChunk = index;
    this.options.onChunk?.(index, this.chunks.length);

    const blob = await this.blobForChunk(index);
    if (this.cancelled || !blob) return;

    // Prefetch на следващото парче, докато това свири → без пауза между частите.
    this.blobForChunk(index + 1).catch(() => {});

    await this.playBlob(blob, this.options.rate, index, async () => {
      if (this.cancelled) return;

      if (index + 1 >= this.chunks.length) {
        this.options.onProgress?.(100);
        this.options.onEnd?.();
        return;
      }

      try {
        await this.playFrom(index + 1);
      } catch (error) {
        this.stop();
        this.options.onError?.(error);
      }
    });
  }

  async playBlob(blob, rate, index, onEnd) {
    this.clearAudio();
    this.url = URL.createObjectURL(blob);
    this.audio = this.audio || new Audio();
    this.audio.src = this.url;
    this.audio.playsInline = true;
    this.audio.playbackRate = rate;

    const total = this.chunks.length || 1;
    this.audio.ontimeupdate = () => {
      const duration = this.audio?.duration || 0;
      const part = duration ? this.audio.currentTime / duration : 0;
      this.options?.onProgress?.(Math.min(99.5, ((index + part) / total) * 100));
      this.options?.onPosition?.({
        chunk: index,
        total,
        chunkTime: this.audio?.currentTime || 0,
        chunkDuration: duration,
      });
    };
    this.audio.onended = () => onEnd?.();
    this.startEnergyMeter();

    await this.audio.play();
  }

  startEnergyMeter() {
    this.stopEnergyMeter();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.audio || !AudioCtx) return;

    try {
      this.audioContext = this.audioContext || new AudioCtx();
      this.analyser = this.analyser || this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      if (!this.sourceNode) {
        this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
      }
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.audio || this.audio.paused || this.cancelled) {
          this.options?.onEnergy?.(0);
          return;
        }
        this.analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, value) => sum + value, 0) / (data.length * 255);
        this.options?.onEnergy?.(Math.min(1, avg * 2.8));
        this.energyFrame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      this.options?.onEnergy?.(0.35);
    }
  }

  stopEnergyMeter() {
    if (this.energyFrame) {
      cancelAnimationFrame(this.energyFrame);
      this.energyFrame = null;
    }
  }

  // ——— Контроли за навигация ———
  skip(seconds) {
    if (!this.audio) return;
    const duration = this.audio.duration || 0;
    this.audio.currentTime = Math.max(0, Math.min(duration - 0.15, this.audio.currentTime + seconds));
  }

  seekFraction(fraction) {
    if (!this.audio?.duration) return;
    this.audio.currentTime = Math.max(0, Math.min(1, fraction)) * this.audio.duration;
  }

  jumpToChunk(index) {
    if (!this.options || index < 0 || index >= this.chunks.length) return;
    this.cancelled = false;
    this.playFrom(index).catch((error) => {
      this.stop();
      this.options?.onError?.(error);
    });
  }

  next() { this.jumpToChunk(this.currentChunk + 1); }

  prev() {
    // Първо превърта в началото на текущото парче, ако вече е напреднало.
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    this.jumpToChunk(this.currentChunk - 1);
  }

  // Пре-генерира всички парчета в кеша (IndexedDB) за офлайн слушане.
  async cacheAll(onProgress) {
    for (let i = 0; i < this.chunks.length; i += 1) {
      onProgress?.(Math.round((i / this.chunks.length) * 100));
      await this.blobForChunk(i); // eslint-disable-line no-await-in-loop
    }
    onProgress?.(100);
  }

  // Сваля целия текст като един WAV — генерира липсващите парчета при нужда.
  async downloadAll(onProgress) {
    const blobs = [];
    for (let i = 0; i < this.chunks.length; i += 1) {
      onProgress?.(Math.round((i / this.chunks.length) * 100));
      // eslint-disable-next-line no-await-in-loop
      blobs.push(await this.blobForChunk(i));
    }
    onProgress?.(100);
    return concatWavBlobs(blobs);
  }

  setPlaybackRate(rate) {
    if (this.options) this.options.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
  }

  pause() { this.audio?.pause(); }

  resume() {
    const playing = this.audio?.play();
    this.startEnergyMeter();
    return playing;
  }

  clearAudio() {
    if (this.audio) {
      this.stopEnergyMeter();
      this.options?.onEnergy?.(0);
      this.audio.pause();
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.src = '';
      this.audio.load();
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }

  stop({ keepUnlocked = false } = {}) {
    this.cancelled = true;
    this.stopEnergyMeter();
    this.options?.onEnergy?.(0);
    if (keepUnlocked && this.unlocked && this.audio) {
      this.audio.pause();
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      if (this.url) {
        URL.revokeObjectURL(this.url);
        this.url = null;
      }
      return;
    }
    this.clearAudio();
    this.unlocked = false;
  }
}
