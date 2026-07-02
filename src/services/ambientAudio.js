// Voxora ambient engine — 6 различни генеративни мелодии.
// Всяка тема има собствено темпо, гама, акорди, тембър и мелодичен рисунък.

const F = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

const themes = {
  relax: { // бавна пентатонична приспивна мелодия
    bpm: 54, wave: 'sine', cutoff: 1600, delay: 0.42, fb: 0.32,
    chords: [[57, 64, 69], [55, 62, 67], [53, 60, 65], [55, 62, 67]],
    melody: [81, 84, 88, 86, 84, 81, 79, 76, 79, 81, 84, 81, 79, 76, 74, 76],
    melLevel: 0.06, padLevel: 0.045, noteLen: 1.6, stepDiv: 1,
  },
  focus: { // равномерен минималистичен пулс — не разсейва
    bpm: 84, wave: 'triangle', cutoff: 1100, delay: 0.28, fb: 0.22,
    chords: [[45, 52, 57], [45, 52, 57], [43, 50, 55], [43, 50, 55]],
    melody: [69, 0, 72, 69, 0, 74, 72, 0, 69, 0, 72, 76, 74, 0, 72, 0],
    melLevel: 0.05, padLevel: 0.035, noteLen: 0.5, stepDiv: 2,
  },
  classical: { // арпежи по класическа хармония I–vi–IV–V
    bpm: 96, wave: 'triangle', cutoff: 2400, delay: 0.24, fb: 0.18,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
    melody: null, arpeggio: true,
    melLevel: 0.065, padLevel: 0.02, noteLen: 0.55, stepDiv: 2,
  },
  ambient: { // носещи се разстроени пад акорди, без ритъм
    bpm: 30, wave: 'sine', cutoff: 900, delay: 0.55, fb: 0.45,
    chords: [[48, 55, 62, 67], [46, 53, 60, 65], [50, 57, 64, 69], [48, 55, 62, 67]],
    melody: null, drift: 8,
    melLevel: 0, padLevel: 0.05, noteLen: 8, stepDiv: 1,
  },
  meditative: { // нисък дрон + редки камбанни тонове
    bpm: 40, wave: 'sine', cutoff: 1300, delay: 0.6, fb: 0.5,
    chords: [[45, 52], [45, 52], [45, 52], [45, 52]],
    melody: [69, 0, 0, 0, 76, 0, 0, 0, 72, 0, 0, 0, 81, 0, 0, 0],
    bell: true, melLevel: 0.07, padLevel: 0.04, noteLen: 3.5, stepDiv: 0.5,
  },
  cinematic: { // минорни пад акорди + дълбок бавен пулс
    bpm: 60, wave: 'sawtooth', cutoff: 700, delay: 0.38, fb: 0.35,
    chords: [[41, 48, 56], [44, 51, 56], [39, 46, 55], [43, 50, 58]],
    melody: [65, 0, 0, 68, 0, 0, 72, 0, 70, 0, 0, 68, 0, 0, 65, 0],
    melLevel: 0.045, padLevel: 0.04, noteLen: 1.2, stepDiv: 1, pulse: 29,
  },
};

export class AmbientAudio {
  constructor() {
    this.ctx = null; this.master = null; this.timer = null;
    this.genre = 'relax'; this.volume = 0.24; this.padNodes = [];
  }

  _build() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = themes[this.genre];
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = t.cutoff; filter.Q.value = 0.4;
    // Пространство: delay с feedback
    const delay = this.ctx.createDelay(1); delay.delayTime.value = t.delay;
    const fb = this.ctx.createGain(); fb.gain.value = t.fb;
    const wet = this.ctx.createGain(); wet.gain.value = 0.35;
    this.bus = this.ctx.createGain();
    this.bus.connect(filter);
    filter.connect(this.master);
    filter.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  _note(midi, time, dur, wave, level, detune = 0) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = wave; o.frequency.value = F(midi); o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(level, time + Math.min(0.08, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(this.bus);
    o.start(time); o.stop(time + dur + 0.05);
  }

  _bell(midi, time, level) { // камбанен тембър: основен тон + затихващи хармоници
    [1, 2.76, 5.4].forEach((h, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = F(midi) * h;
      const lv = level / (i * 2 + 1);
      g.gain.setValueAtTime(lv, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 3.5 - i);
      o.connect(g).connect(this.bus);
      o.start(time); o.stop(time + 4);
    });
  }

  _pad(chord, time, dur, t) {
    chord.forEach(m => {
      [-(t.drift || 5), (t.drift || 5)].forEach(d => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = t.wave === 'sawtooth' ? 'sawtooth' : 'sine';
        o.frequency.value = F(m); o.detune.value = d;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(t.padLevel / chord.length, time + dur * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur * 1.05);
        o.connect(g).connect(this.bus);
        o.start(time); o.stop(time + dur * 1.1);
      });
    });
  }

  start(genre = this.genre) {
    this.stop();
    this.genre = themes[genre] ? genre : 'relax';
    this._build();
    const t = themes[this.genre];
    const beat = 60 / t.bpm;
    const step = beat / t.stepDiv;
    const barLen = 16 * step;
    let nextStep = this.ctx.currentTime + 0.1;
    let stepIdx = 0;

    const schedule = () => {
      if (!this.ctx) return;
      while (nextStep < this.ctx.currentTime + 0.6) {
        const bar = Math.floor(stepIdx / 16) % t.chords.length;
        const pos = stepIdx % 16;
        if (pos === 0) this._pad(t.chords[bar], nextStep, barLen, t);
        if (pos === 0 && t.pulse) this._note(t.pulse, nextStep, beat * 1.6, 'sine', 0.09);
        let m = null;
        if (t.arpeggio) m = t.chords[bar][pos % t.chords[bar].length] + (pos % 8 < 4 ? 12 : 24);
        else if (t.melody) m = t.melody[pos];
        if (m) {
          if (t.bell) this._bell(m, nextStep, t.melLevel);
          else this._note(m, nextStep, t.noteLen, t.wave, t.melLevel);
        }
        nextStep += step; stepIdx++;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 200);
    this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
  }
  pause() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.ctx?.close(); this.ctx = null; this.master = null; this.bus = null;
  }
}
