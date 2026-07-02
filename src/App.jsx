import { useEffect, useMemo, useRef, useState } from 'react';
import TextInput from './components/TextInput';
import VoiceSelector from './components/VoiceSelector';
import SpeedControl from './components/SpeedControl';
import MusicSelector from './components/MusicSelector';
import AudioPlayer from './components/AudioPlayer';
import { SpeechEngine, getVoices, pickVoiceForGender } from './services/speechService';
import { AmbientAudio } from './services/ambientAudio';

const sample = 'Понякога най-добрите истории не чакат да бъдат написани. Те вече са тук — в статиите, които пазим, в бележките, към които се връщаме, и в думите, за които рядко намираме време. Voxora превръща всеки текст в лично аудио изживяване.';

export default function App() {
  const [text, setText] = useState(sample);
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState(null);
  const [gender, setGender] = useState('female');
  const [pitchShift, setPitchShift] = useState(1);
  const [simulated, setSimulated] = useState(false);
  const [rate, setRate] = useState(1);
  const [music, setMusic] = useState(true);
  const [genre, setGenre] = useState('relax');
  const [volume, setVolume] = useState(0.24);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);

  const engine = useRef(new SpeechEngine());
  const ambient = useRef(new AmbientAudio());
  const char = useRef(0);

  const applyGender = (g, all) => {
    const pick = pickVoiceForGender(all, g);
    setVoice(pick.voice);
    setPitchShift(pick.pitchShift);
    setSimulated(pick.simulated);
  };

  useEffect(() => {
    const load = () => {
      const all = getVoices();
      setVoices(all);
      if (all.length) applyGender(gender, all);
    };
    load();
    speechSynthesis.onvoiceschanged = load;
    return () => { engine.current.stop(); ambient.current.stop(); };
  }, []);

  useEffect(() => ambient.current.setVolume(volume), [volume]);
  useEffect(() => {
    if (status === 'speaking' && music) {
      ambient.current.start(genre);
      ambient.current.setVolume(volume);
    }
  }, [genre]);
  useEffect(() => {
    if (status !== 'speaking') return;
    if (music) { ambient.current.start(genre); ambient.current.setVolume(volume); }
    else ambient.current.stop();
  }, [music]);

  const changeGender = g => { setGender(g); applyGender(g, voices); };

  const words = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);
  const mins = Math.max(1, Math.ceil(words / (165 * rate)));

  const speak = (fromStart = false) => {
    if (!text.trim()) return;
    if (status === 'paused' && !fromStart) {
      engine.current.resume();
      ambient.current.resume();
      setStatus('speaking');
      return;
    }
    if (fromStart) { char.current = 0; setProgress(0); }
    engine.current.speak(text, {
      voice, rate, pitchShift,
      startAt: fromStart ? 0 : char.current,
      onProgress: (pos, total) => { char.current = pos; setProgress(Math.min(100, pos / total * 100)); },
      onEnd: () => { setProgress(100); setStatus('finished'); ambient.current.stop(); },
      onError: () => setStatus('error'),
    });
    if (music) { ambient.current.start(genre); ambient.current.setVolume(volume); }
    setStatus('speaking');
  };

  const pause = () => { engine.current.pause(); ambient.current.pause(); setStatus('paused'); };
  const stop = () => { engine.current.stop(); ambient.current.stop(); setStatus('stopped'); };
  const restart = () => speak(true);

  return <>
    <header>
      <a className="brand"><span>V</span>VOXORA</a>
      <div className="header-right"><span className="status-dot">● Работи локално</span><button className="profile">В</button></div>
    </header>
    <main>
      <section className="hero">
        <div>
          <span className="eyebrow coral">ТВОИТЕ ДУМИ. ТВОЯТ РИТЪМ.</span>
          <h1>Превърни текста<br/>в <em>изживяване.</em></h1>
          <p>Слушай всичко, за което не ти остава време да прочетеш.</p>
        </div>
        <div className="orb" aria-hidden="true"><i/><i/><i/><span>▶</span></div>
      </section>
      <div className="workspace">
        <TextInput text={text} setText={setText}/>
        <aside className="card settings">
          <VoiceSelector voices={voices} selected={voice} onSelect={setVoice} gender={gender} onGender={changeGender} simulated={simulated}/>
          <SpeedControl value={rate} onChange={setRate}/>
          <MusicSelector enabled={music} setEnabled={setMusic} genre={genre} setGenre={setGenre} volume={volume} setVolume={setVolume}/>
          <button className="start" disabled={!text.trim()} onClick={() => speak(true)}>
            <span>▶</span><div><b>Започни четенето</b><small>{words} думи · около {mins} мин.</small></div>
          </button>
        </aside>
      </div>
    </main>
    <AudioPlayer status={status} progress={progress} onPlay={() => speak(false)} onPause={pause} onStop={stop} onRestart={restart} disabled={!text.trim()}/>
    <footer>VOXORA · Създадено за спокойно слушане</footer>
  </>;
}
