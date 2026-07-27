import { useEffect, useMemo, useState } from 'react';
import { getBrowserVoices } from '../services/browserTtsService';

export default function SpeechEngineSelector({
  engine, onEngine, browserVoice, onBrowserVoice, onPreview, previewing,
}) {
  const [voices, setVoices] = useState(() => getBrowserVoices());

  useEffect(() => {
    const refresh = () => setVoices(getBrowserVoices());
    refresh();
    window.speechSynthesis?.addEventListener?.('voiceschanged', refresh);
    const timer = window.setTimeout(refresh, 500);
    return () => {
      window.clearTimeout(timer);
      window.speechSynthesis?.removeEventListener?.('voiceschanged', refresh);
    };
  }, []);

  const selected = useMemo(
    () => voices.find((voice) => voice.name === browserVoice) || voices[0],
    [browserVoice, voices],
  );

  useEffect(() => {
    if (!browserVoice && selected?.name) onBrowserVoice(selected.name);
  }, [browserVoice, onBrowserVoice, selected]);

  return (
    <section className="control-section speech-engine-section">
      <span className="eyebrow">02 · НАЧИН НА ЧЕТЕНЕ</span>
      <h3>Избери откъде да идва гласът</h3>
      <div className="speech-engine-picker" role="group" aria-label="Начин на гласово четене">
        <button className={engine === 'gemini' ? 'active' : ''} onClick={() => onEngine('gemini')}>
          <b>AI гласове</b>
          <small>Gemini · по-естествени</small>
        </button>
        <button className={engine === 'browser' ? 'active' : ''} onClick={() => onEngine('browser')}>
          <b>Edge / устройство</b>
          <small>Без ключ · тръгва веднага</small>
        </button>
      </div>

      {engine === 'browser' && (
        <div className="browser-voice-panel">
          <label>
            <span>Глас от телефона или браузъра</span>
            <select
              value={selected?.name || ''}
              onChange={(event) => onBrowserVoice(event.target.value)}
              disabled={!voices.length}
            >
              {!voices.length && <option value="">Няма намерени системни гласове</option>}
              {voices.map((voice) => (
                <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                  {voice.name} · {voice.lang}
                </option>
              ))}
            </select>
          </label>
          <button
            className="browser-preview"
            onClick={() => selected && onPreview(selected.name)}
            disabled={!selected || !!previewing}
          >
            {previewing ? '…' : '▶'} Чуй проба
          </button>
          <p>Гласовете зависят от Edge, телефона и инсталираните системни езици.</p>
        </div>
      )}
    </section>
  );
}
