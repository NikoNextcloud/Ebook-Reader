import { GoogleGenAI, Modality } from '@google/genai';

const previewCache = new Map();
const MAX_CHUNK_LENGTH = 2600;

const pcmToWav = (base64, sampleRate = 24000) => {
  const raw = atob(base64);
  const pcm = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    pcm[i] = raw.charCodeAt(i);
  }

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

const splitTextForSpeech = (text) => {
  const cleanText = text.replace(/\s+/g, ' ').trim();

  if (cleanText.length <= MAX_CHUNK_LENGTH) {
    return [cleanText];
  }

  const sentences = cleanText.match(/[^.!?…]+[.!?…]+["“”']?|[^.!?…]+$/g) || [cleanText];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const next = `${current} ${sentence}`.trim();

    if (next.length <= MAX_CHUNK_LENGTH) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (sentence.length <= MAX_CHUNK_LENGTH) {
      current = sentence.trim();
      continue;
    }

    const words = sentence.trim().split(' ');
    let wordChunk = '';

    for (const word of words) {
      const candidate = `${wordChunk} ${word}`.trim();

      if (candidate.length > MAX_CHUNK_LENGTH && wordChunk) {
        chunks.push(wordChunk);
        wordChunk = word;
      } else {
        wordChunk = candidate;
      }
    }

    if (wordChunk) {
      current = wordChunk;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const paceInstruction = (rate) => {
  if (rate < 0.85) {
    return 'бавно, ясно и изразително';
  }

  if (rate > 1.2) {
    return 'по-бързо, но ясно и приятно за слушане';
  }

  return 'естествено, спокойно и с добра дикция';
};

const buildPrompt = (text, rate) => `Прочети следния български текст ${paceInstruction(rate)}, като професионален разказвач на аудиокнига. Не добавяй думи, не пропускай думи и не обяснявай задачата. Чети само текста:

${text}`;

export class GeminiTTS {
  constructor() {
    this.audio = null;
    this.url = null;
    this.cancelled = false;
    this.chunks = [];
    this.currentChunk = 0;
    this.options = null;
  }

  async request(ai, model, prompt, voiceName) {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData?.data;

    if (!data) {
      throw new Error('NO_AUDIO');
    }

    return pcmToWav(data);
  }

  async requestWithFallback(ai, prompt, voiceName) {
    try {
      return await this.request(ai, 'gemini-3.1-flash-tts-preview', prompt, voiceName);
    } catch (firstError) {
      if (!isQuotaError(firstError)) {
        throw friendlyError(firstError);
      }

      try {
        return await this.request(ai, 'gemini-2.5-flash-preview-tts', prompt, voiceName);
      } catch (secondError) {
        throw friendlyError(secondError);
      }
    }
  }

  async generate(text, options) {
    this.stop();
    this.cancelled = false;
    this.options = options;

    const { apiKey, voiceName, rate = 1, onProgress, onEnd, cacheKey } = options;
    let blob = cacheKey ? previewCache.get(cacheKey) : null;

    if (blob) {
      await this.playBlob(blob, rate, onProgress, onEnd);
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    this.chunks = cacheKey ? [text.trim()] : splitTextForSpeech(text);
    this.currentChunk = 0;

    await this.playCurrentChunk(ai, voiceName, rate, cacheKey);
  }

  async playCurrentChunk(ai, voiceName, rate, cacheKey) {
    if (this.cancelled || !this.options) {
      return;
    }

    const { onProgress, onEnd, onError } = this.options;
    const chunkText = this.chunks[this.currentChunk];
    const prompt = buildPrompt(chunkText, rate);
    const blob = await this.requestWithFallback(ai, prompt, voiceName);

    if (cacheKey) {
      previewCache.set(cacheKey, blob);
    }

    if (this.cancelled) {
      return;
    }

    await this.playBlob(blob, rate, (partProgress) => {
      const total = this.chunks.length || 1;
      const combined = ((this.currentChunk + partProgress / 100) / total) * 100;
      onProgress?.(Math.min(99, combined));
    }, async () => {
      if (this.cancelled) {
        return;
      }

      this.currentChunk += 1;

      if (this.currentChunk >= this.chunks.length) {
        onProgress?.(100);
        onEnd?.();
        return;
      }

      try {
        await this.playCurrentChunk(ai, voiceName, rate, cacheKey);
      } catch (error) {
        this.stop();
        onError?.(error);
      }
    });
  }

  async playBlob(blob, rate, onProgress, onEnd) {
    this.clearAudio();
    this.url = URL.createObjectURL(blob);
    this.audio = new Audio(this.url);
    this.audio.playbackRate = rate;
    this.audio.ontimeupdate = () => onProgress?.(this.audio.duration ? (this.audio.currentTime / this.audio.duration) * 100 : 0);
    this.audio.onended = () => onEnd?.();

    await this.audio.play();
  }

  pause() {
    this.audio?.pause();
  }

  resume() {
    return this.audio?.play();
  }

  clearAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }

    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }

  stop() {
    this.cancelled = true;
    this.clearAudio();
  }
}
