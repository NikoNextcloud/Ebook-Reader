export const musicTracks = {
  chillhop: '/music/calm-reading-chill-hop.mp3',
  softpiano: '/music/reading-soft-piano.mp3',
  azure: '/music/azure-piano-ocean.mp3',
  bioluminescent: '/music/bioluminescent-night.mp3',
  warmmemory: '/music/warm-memory.mp3',
  readingbooks: '/music/reading-books.mp3',
  refrigerator: '/music/red-refrigerator.mp3',
};

const clamp = (value) => Math.max(0, Math.min(1, value));

export class AmbientAudio {
  constructor() {
    this.audio = null;
    this.genre = 'chillhop';
    this.volume = 0.32;
    this.fadeTimer = null;
  }

  // Плавно променя силата до target за duration мс.
  fadeTo(target, duration = 900, onDone) {
    if (!this.audio) return;
    clearInterval(this.fadeTimer);
    const from = this.audio.volume;
    const to = clamp(target);
    const start = performance.now();
    this.fadeTimer = setInterval(() => {
      if (!this.audio) { clearInterval(this.fadeTimer); return; }
      const progress = Math.min(1, (performance.now() - start) / duration);
      this.audio.volume = from + (to - from) * progress;
      if (progress >= 1) { clearInterval(this.fadeTimer); onDone?.(); }
    }, 40);
  }

  start(genre = this.genre) {
    const source = musicTracks[genre] || musicTracks.chillhop;
    if (this.audio && this.genre === genre) {
      this.audio.play().catch(() => {});
      this.fadeTo(this.volume);
      return;
    }
    this.stop();
    this.genre = genre;
    this.audio = new Audio(source);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = 0; // старт от тишина → плавно нарастване
    this.audio.play().catch((error) => console.warn('Music playback waiting for interaction:', error));
    this.fadeTo(this.volume);
  }

  setVolume(value) {
    this.volume = clamp(value);
    clearInterval(this.fadeTimer);
    if (this.audio) this.audio.volume = this.volume;
  }

  pause() {
    this.fadeTo(0, 600, () => this.audio?.pause());
  }

  resume() {
    if (!this.audio) return;
    this.audio.play().catch(() => {});
    this.fadeTo(this.volume);
  }

  stop() {
    clearInterval(this.fadeTimer);
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.src = '';
      this.audio = null;
    }
  }
}
