import { idbGet, idbSet } from './idbCache';
import { buildChunksForPlayback, splitTextForSpeech } from './geminiTtsService';

const audioCache = new Map();
const SAMPLE_RATE = 8000;
export const ELEVEN_AUDIO_GESTURE_REQUIRED = 'ELEVEN_AUDIO_GESTURE_REQUIRED';

const silentWav = () => {
  const pcm = new Uint8Array(SAMPLE_RATE * 2);
  const out = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(out);
  const word = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  word(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, pcm.length, true);
  new Uint8Array(out, 44).set(pcm);
  return new Blob([out], { type: 'audio/wav' });
};

const blockedError = () => {
  const error = new Error('Гласът е готов. Натисни Play още веднъж, за да разрешиш звука на телефона.');
  error.code = ELEVEN_AUDIO_GESTURE_REQUIRED;
  return error;
};

const hash = (value) => {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }
  return (result >>> 0).toString(36);
};

const voiceFor = (options, index) => (
  options.alternateVoices && options.secondaryVoiceId && index % 2 === 1
    ? options.secondaryVoiceId
    : options.primaryVoiceId
);

export const fetchElevenVoices = async () => {
  const response = await fetch('/api/eleven-voices', { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Гласовете от ElevenLabs не могат да се заредят.');
  return {
    voices: data.voices || [],
    warning: data.limited ? data.message || '' : '',
  };
};

export class ElevenLabsTTS {
  constructor() {
    this.audio = null;
    this.url = null;
    this.primerUrl = null;
    this.priming = false;
    this.unlocked = false;
    this.cancelled = false;
    this.chunks = [];
    this.origin = [];
    this.currentChunk = 0;
    this.options = null;
    this.inflight = new Map();
    this.energyFrame = null;
  }

  ensureAudio() {
    if (this.audio) return this.audio;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.playsInline = true;
    this.audio.setAttribute('playsinline', '');
    return this.audio;
  }

  async unlockAudio() {
    const audio = this.ensureAudio();
    try {
      audio.pause();
      audio.loop = true;
      audio.volume = 0.001;
      if (!this.primerUrl) this.primerUrl = URL.createObjectURL(silentWav());
      audio.src = this.primerUrl;
      audio.load();
      await audio.play();
      this.priming = true;
      this.unlocked = true;
      return true;
    } catch {
      this.unlocked = false;
      return false;
    }
  }

  async request(index) {
    const voiceId = voiceFor(this.options, this.originOf(index));
    const response = await fetch('/api/eleven-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: this.chunks[index],
        voiceId,
        previousText: this.chunks[index - 1] || '',
        nextText: this.chunks[index + 1] || '',
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'ElevenLabs не успя да генерира гласа.');
    }
    return response.blob();
  }

  blobForChunk(index) {
    if (index < 0 || index >= this.chunks.length) return Promise.resolve(null);
    const voiceId = voiceFor(this.options, this.originOf(index));
    const key = `eleven-v2|${voiceId}|${hash(this.chunks[index])}`;
    if (audioCache.has(key)) return Promise.resolve(audioCache.get(key));
    if (this.inflight.has(key)) return this.inflight.get(key);

    const promise = idbGet(key)
      .then((stored) => {
        if (stored) {
          audioCache.set(key, stored);
          return stored;
        }
        return this.request(index).then((blob) => {
          audioCache.set(key, blob);
          idbSet(key, blob);
          return blob;
        });
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  prepare(text, options) {
    this.options = options;
    this.cancelled = false;
    this.chunks = options.singleChunk ? [(text || '').trim()] : splitTextForSpeech(text);
    this.origin = this.chunks.map((_, index) => index);
  }

  // Оригиналният (стабилен) индекс на парче — по него се пази позицията в книгата.
  originOf(index) {
    return this.origin?.[index] ?? index;
  }

  internalOf(originIndex) {
    const found = this.origin?.indexOf(originIndex);
    return found === undefined || found < 0 ? originIndex : found;
  }

  async generate(text, options) {
    this.stop({ keepUnlocked: true });
    this.options = options;
    this.cancelled = false;

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
    this.blobForChunk(index + 1).catch(() => {});
    await this.playBlob(blob, index, async () => {
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
        this.options?.onError?.(error);
      }
    });
  }

  async playBlob(blob, index, onEnd) {
    const audio = this.ensureAudio();
    this.stopEnergy();
    audio.pause();
    audio.ontimeupdate = null;
    audio.onended = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    audio.loop = false;
    audio.volume = 1;
    audio.src = this.url;
    audio.playbackRate = this.options.rate || 1;
    audio.load();
    this.priming = false;
    if (this.primerUrl) {
      URL.revokeObjectURL(this.primerUrl);
      this.primerUrl = null;
    }

    const total = this.chunks.length || 1;
    audio.ontimeupdate = () => {
      const duration = audio.duration || 0;
      const fraction = duration ? audio.currentTime / duration : 0;
      this.options?.onProgress?.(Math.min(99.5, ((index + fraction) / total) * 100));
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
      this.startEnergy();
    } catch (error) {
      if (error?.name === 'NotAllowedError' || /not allowed|gesture/i.test(String(error?.message || error))) {
        throw blockedError();
      }
      throw error;
    }
  }

  startEnergy() {
    this.stopEnergy();
    const tick = () => {
      if (!this.audio || this.audio.paused || this.cancelled) {
        this.options?.onEnergy?.(0);
        return;
      }
      const time = this.audio.currentTime || performance.now() / 1000;
      const energy = 0.2 + Math.abs(Math.sin(time * 3.2)) * 0.2 + Math.abs(Math.sin(time * 6.4)) * 0.08;
      this.options?.onEnergy?.(energy);
      this.energyFrame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  stopEnergy() {
    if (this.energyFrame) window.cancelAnimationFrame(this.energyFrame);
    this.energyFrame = null;
  }

  skip(seconds) {
    if (!this.audio?.duration) return;
    this.audio.currentTime = Math.max(0, Math.min(this.audio.duration - 0.1, this.audio.currentTime + seconds));
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
    this.audio?.pause();
    this.cancelled = false;
    this.playFrom(index).catch((error) => {
      this.stop();
      this.options?.onError?.(error);
    });
  }

  next() { this.jumpToChunk(this.currentChunk + 1); }

  prev() {
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    this.jumpToChunk(this.currentChunk - 1);
  }

  async cacheAll(onProgress) {
    for (let index = 0; index < this.chunks.length; index += 1) {
      onProgress?.(Math.round((index / this.chunks.length) * 100));
      await this.blobForChunk(index);
    }
    onProgress?.(100);
  }

  async downloadAll(onProgress) {
    const blobs = [];
    for (let index = 0; index < this.chunks.length; index += 1) {
      onProgress?.(Math.round((index / this.chunks.length) * 100));
      blobs.push(await this.blobForChunk(index));
    }
    onProgress?.(100);
    return new Blob(blobs, { type: 'audio/mpeg' });
  }

  setPlaybackRate(rate) {
    if (this.options) this.options.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
  }

  pause() {
    this.audio?.pause();
    this.stopEnergy();
    this.options?.onEnergy?.(0);
  }

  async resume() {
    if (!this.audio) return false;
    try {
      await this.audio.play();
      this.startEnergy();
      return true;
    } catch (error) {
      if (error?.name === 'NotAllowedError') throw blockedError();
      throw error;
    }
  }

  stop({ keepUnlocked = false } = {}) {
    this.cancelled = true;
    this.stopEnergy();
    this.options?.onEnergy?.(0);
    if (keepUnlocked && this.unlocked && this.audio) {
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      if (!this.priming) this.audio.pause();
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = null;
      return;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.src = '';
      this.audio.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.primerUrl) URL.revokeObjectURL(this.primerUrl);
    this.url = null;
    this.primerUrl = null;
    this.unlocked = false;
    this.priming = false;
  }
}
