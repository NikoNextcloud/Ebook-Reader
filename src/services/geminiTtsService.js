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
export const AUDIO_GESTURE_REQUIRED = 'AUDIO_GESTURE_REQUIRED';

const isAppleMobile = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

const isPlaybackBlocked = (error) => (
  error?.name === 'NotAllowedError'
  || /not allowed|user agent|permission|gesture/i.test(String(error?.message || error))
);

const playbackBlockedError = () => {
  const error = new Error('Гласът е готов. Докосни Play още веднъж, за да разрешиш звука на телефона.');
  error.code = AUDIO_GESTURE_REQUIRED;
  return error;
};

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

// При продължаване от средата на книга началното парче е с пълен размер и
// генерирането му отнема секунди. Затова го режем на кратко начало + остатък:
// звукът тръгва почти веднага, а остатъкът се дозарежда, докато слушаш.
export const splitLeadIn = (chunkText) => {
  const text = (chunkText || '').trim();
  if (text.length <= FIRST_CHUNK_LENGTH * 1.5) return null;

  const sentences = text.match(/[^.!?…]+[.!?…]+["“”']?|[^.!?…]+$/g) || [text];
  let head = '';
  let taken = 0;

  while (taken < sentences.length && (head + sentences[taken]).trim().length <= FIRST_CHUNK_LENGTH) {
    head += sentences[taken];
    taken += 1;
  }

  // Изречението е по-дълго от лимита → режем по думи, за да не чакаме цялото.
  if (!taken) {
    const words = text.split(' ');
    while (taken < words.length && (`${head} ${words[taken]}`).trim().length <= FIRST_CHUNK_LENGTH) {
      head = `${head} ${words[taken]}`.trim();
      taken += 1;
    }
    const rest = words.slice(taken).join(' ').trim();
    return head && rest ? [head, rest] : null;
  }

  const rest = sentences.slice(taken).join('').trim();
  return head.trim() && rest ? [head.trim(), rest] : null;
};

// Строи парчетата и — при продължаване от средата — реже началното парче,
// така че първият звук да е готов за около секунда.
export const buildChunksForPlayback = (text, { singleChunk = false, startChunk = 0 } = {}) => {
  const chunks = singleChunk ? [(text || '').trim()].filter(Boolean) : splitTextForSpeech(text);
  const origin = chunks.map((_, index) => index);
  if (!chunks.length) return { chunks, origin, start: 0 };

  const start = Math.min(Math.max(0, startChunk || 0), chunks.length - 1);
  if (start > 0) {
    const lead = splitLeadIn(chunks[start]);
    if (lead) {
      chunks.splice(start, 1, lead[0], lead[1]);
      // И двете части сочат към оригиналния индекс, за да остане позицията стабилна.
      origin.splice(start, 1, start, start);
    }
  }
  return { chunks, origin, start };
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
    this.origin = [];
    this.currentChunk = 0;
    this.options = null;
    this.ai = null;
    this.inflight = new Map();
    this.unlocked = false;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.energyFrame = null;
    this.primerUrl = null;
    this.priming = false;
    this.awaitingGesture = false;
  }

  ensureAudio() {
    if (this.audio) return this.audio;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.playsInline = true;
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    return this.audio;
  }

  async unlockAudio() {
    const audio = this.ensureAudio();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    try {
      if (AudioCtx && !isAppleMobile()) {
        this.audioContext = this.audioContext || new AudioCtx();
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      }

      this.stopEnergyMeter();
      audio.pause();
      audio.ontimeupdate = null;
      audio.onended = null;
      audio.loop = true;
      audio.volume = 0.001;
      audio.playbackRate = 1;

      if (!this.primerUrl) {
        // Една секунда тишина остава да се върти, докато Gemini подготвя гласа.
        // Това запазва разрешението от докосването в iOS и in-app браузъри.
        this.primerUrl = URL.createObjectURL(
          wavFromPcmBytes(new Uint8Array(SAMPLE_RATE * 2)),
        );
      }
      audio.src = this.primerUrl;
      audio.load();
      await audio.play();
      this.priming = true;
      this.unlocked = true;
      this.awaitingGesture = false;
      return true;
    } catch {
      this.priming = false;
      this.unlocked = false;
      return false;
    }
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
    const voiceName = alternatingVoiceForChunk(this.options, this.originOf(index));
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
    this.origin = this.chunks.map((_, index) => index);
  }

  // Оригиналният (стабилен) индекс на парче — по него се пази позицията в книгата.
  originOf(index) {
    return this.origin?.[index] ?? index;
  }

  // Вътрешният индекс за даден оригинален индекс (обратното на originOf).
  internalOf(originIndex) {
    const found = this.origin?.indexOf(originIndex);
    return found === undefined || found < 0 ? originIndex : found;
  }

  async generate(text, options) {
    this.stop({ keepUnlocked: true });
    this.cancelled = false;
    this.options = options;
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });

    const built = buildChunksForPlayback(text, options);
    this.chunks = built.chunks;
    this.origin = built.origin;

    if (!this.chunks.length) {
      options.onEnd?.();
      return;
    }

    await this.playFrom(built.start);
  }

  async playFrom(index) {
    if (this.cancelled || !this.options) return;

    this.currentChunk = this.originOf(index);
    this.options.onChunk?.(this.currentChunk, this.chunks.length);

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
    this.stopEnergyMeter();
    const audio = this.ensureAudio();
    audio.pause();
    audio.ontimeupdate = null;
    audio.onended = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    audio.loop = false;
    audio.volume = 1;
    audio.src = this.url;
    audio.playbackRate = rate;
    audio.load();
    this.priming = false;
    if (this.primerUrl) {
      URL.revokeObjectURL(this.primerUrl);
      this.primerUrl = null;
    }

    const total = this.chunks.length || 1;
    audio.ontimeupdate = () => {
      const duration = audio.duration || 0;
      const part = duration ? audio.currentTime / duration : 0;
      this.options?.onProgress?.(Math.min(99.5, ((index + part) / total) * 100));
      this.options?.onPosition?.({
        chunk: this.originOf(index),
        total,
        chunkTime: audio.currentTime || 0,
        chunkDuration: duration,
      });
    };
    audio.onended = () => onEnd?.();

    try {
      await audio.play();
      this.unlocked = true;
      this.awaitingGesture = false;
      this.startEnergyMeter();
    } catch (error) {
      if (isPlaybackBlocked(error)) {
        this.awaitingGesture = true;
        throw playbackBlockedError();
      }
      throw error;
    }
  }

  startEnergyMeter() {
    this.stopEnergyMeter();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.audio) return;

    const syntheticMeter = () => {
      const tick = () => {
        if (!this.audio || this.audio.paused || this.cancelled) {
          this.options?.onEnergy?.(0);
          return;
        }
        const t = this.audio.currentTime || performance.now() / 1000;
        const energy = 0.22 + Math.abs(Math.sin(t * 2.8)) * 0.16 + Math.abs(Math.sin(t * 5.1)) * 0.08;
        this.options?.onEnergy?.(energy);
        this.energyFrame = window.requestAnimationFrame(tick);
      };
      tick();
    };

    try {
      // В iOS MediaElementSource може да направи иначе свирещия <audio> беззвучен.
      // Там използваме лек визуален ритъм и оставяме аудиото по директния път.
      if (!AudioCtx || isAppleMobile()) {
        syntheticMeter();
        return;
      }
      this.audioContext = this.audioContext || new AudioCtx();
      if (this.audioContext.state !== 'running') {
        syntheticMeter();
        return;
      }
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
        this.energyFrame = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      syntheticMeter();
    }
  }

  stopEnergyMeter() {
    if (this.energyFrame) {
      window.cancelAnimationFrame(this.energyFrame);
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

  // Приема оригинален индекс (както го вижда интерфейсът).
  jumpToChunk(originIndex) {
    if (!this.options) return;
    const index = this.internalOf(originIndex);
    if (index < 0 || index >= this.chunks.length) return;
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

  async resume() {
    if (!this.audio) return false;
    try {
      await this.audio.play();
      this.awaitingGesture = false;
      this.unlocked = true;
      this.startEnergyMeter();
      return true;
    } catch (error) {
      if (isPlaybackBlocked(error)) throw playbackBlockedError();
      throw error;
    }
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
    if (this.primerUrl) {
      URL.revokeObjectURL(this.primerUrl);
      this.primerUrl = null;
    }
    this.priming = false;
  }

  stop({ keepUnlocked = false } = {}) {
    this.cancelled = true;
    this.stopEnergyMeter();
    this.options?.onEnergy?.(0);
    if (keepUnlocked && this.unlocked && this.audio) {
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      if (!this.priming) this.audio.pause();
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
