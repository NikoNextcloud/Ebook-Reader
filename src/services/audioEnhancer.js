export const AUDIO_PROFILES = {
  natural: {
    label: 'Естествен',
    highpass: 20,
    bass: 0,
    presence: 0,
    treble: 0,
    threshold: -8,
    ratio: 1,
    gain: 1,
  },
  clear: {
    label: 'Ясен глас',
    highpass: 70,
    bass: -1,
    presence: 3.5,
    treble: 1,
    threshold: -18,
    ratio: 2,
    gain: 1.04,
  },
  night: {
    label: 'Нощен',
    highpass: 55,
    bass: 0,
    presence: 2,
    treble: -1,
    threshold: -34,
    ratio: 8,
    gain: 0.92,
  },
  warm: {
    label: 'Топъл',
    highpass: 35,
    bass: 2.5,
    presence: 0.8,
    treble: -1.5,
    threshold: -16,
    ratio: 1.5,
    gain: 1,
  },
};

export const resolveAudioProfile = ({
  profile = 'natural',
  bass = 0,
  clarity = 0,
  normalize = false,
} = {}) => {
  const base = AUDIO_PROFILES[profile] || AUDIO_PROFILES.natural;
  return {
    ...base,
    bass: base.bass + Number(bass || 0),
    presence: base.presence + Number(clarity || 0),
    threshold: normalize ? Math.min(base.threshold, -24) : base.threshold,
    ratio: normalize ? Math.max(base.ratio, 4) : base.ratio,
  };
};

export class AudioEnhancer {
  constructor(audio) {
    this.audio = audio;
    this.context = null;
    this.nodes = null;
  }

  async ensureGraph() {
    if (this.nodes) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Аудио подобренията не се поддържат от този браузър.');
    this.context = new AudioContextClass();
    const source = this.context.createMediaElementSource(this.audio);
    const highpass = this.context.createBiquadFilter();
    const bass = this.context.createBiquadFilter();
    const presence = this.context.createBiquadFilter();
    const treble = this.context.createBiquadFilter();
    const compressor = this.context.createDynamicsCompressor();
    const gain = this.context.createGain();

    highpass.type = 'highpass';
    bass.type = 'lowshelf';
    bass.frequency.value = 180;
    presence.type = 'peaking';
    presence.frequency.value = 2800;
    presence.Q.value = 0.9;
    treble.type = 'highshelf';
    treble.frequency.value = 6500;
    source.connect(highpass).connect(bass).connect(presence).connect(treble)
      .connect(compressor).connect(gain).connect(this.context.destination);
    this.nodes = {
      source, highpass, bass, presence, treble, compressor, gain,
    };
  }

  async apply(settings) {
    await this.ensureGraph();
    const profile = resolveAudioProfile(settings);
    const now = this.context.currentTime;
    this.nodes.highpass.frequency.setTargetAtTime(profile.highpass, now, 0.02);
    this.nodes.bass.gain.setTargetAtTime(profile.bass, now, 0.02);
    this.nodes.presence.gain.setTargetAtTime(profile.presence, now, 0.02);
    this.nodes.treble.gain.setTargetAtTime(profile.treble, now, 0.02);
    this.nodes.compressor.threshold.setTargetAtTime(profile.threshold, now, 0.02);
    this.nodes.compressor.ratio.setTargetAtTime(profile.ratio, now, 0.02);
    this.nodes.compressor.attack.setTargetAtTime(0.01, now, 0.02);
    this.nodes.compressor.release.setTargetAtTime(0.25, now, 0.02);
    this.nodes.gain.gain.setTargetAtTime(profile.gain, now, 0.02);
  }

  close() {
    this.context?.close?.().catch(() => {});
    this.context = null;
    this.nodes = null;
  }
}
