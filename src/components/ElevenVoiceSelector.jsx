import { useEffect, useMemo, useState } from 'react';
import { fetchElevenVoices } from '../services/elevenLabsTtsService';

const optionLabel = (voice) => [
  voice.name,
  voice.bulgarian ? 'български' : '',
  voice.accent,
].filter(Boolean).join(' · ');

export default function ElevenVoiceSelector({
  primary,
  secondary,
  onPrimary,
  onSecondary,
  onPreview,
  previewing,
}) {
  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetchElevenVoices()
      .then(({ voices: items, warning }) => {
        if (!active) return;
        setVoices(items);
        setNotice(warning);
        setError(items.length ? '' : 'Няма налични гласове в ElevenLabs профила.');
      })
      .catch((reason) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const femaleVoices = useMemo(
    () => voices.filter((voice) => ['female', 'woman', 'жена'].includes(voice.gender.toLowerCase())),
    [voices],
  );
  const maleVoices = useMemo(
    () => voices.filter((voice) => ['male', 'man', 'мъж'].includes(voice.gender.toLowerCase())),
    [voices],
  );
  const primaryOptions = femaleVoices.length ? femaleVoices : voices;
  const secondaryOptions = maleVoices.length ? maleVoices : voices;

  useEffect(() => {
    if (primaryOptions[0] && !primaryOptions.some((voice) => voice.id === primary)) {
      onPrimary(primaryOptions[0].id);
    }
    if (secondaryOptions[0] && !secondaryOptions.some((voice) => voice.id === secondary)) {
      onSecondary(secondaryOptions[0].id);
    }
  }, [onPrimary, onSecondary, primary, primaryOptions, secondary, secondaryOptions]);

  const voiceById = (id) => voices.find((voice) => voice.id === id);

  return (
    <section className="control-section eleven-voice-section">
      <span className="eyebrow">02 · ELEVENLABS ГЛАСОВЕ</span>
      <h3>Два разказвача с естествена интонация</h3>
      {loading && <p className="eleven-state">Зареждам гласовете от ElevenLabs…</p>}
      {error && <p className="eleven-state error">{error}</p>}
      {notice && <p className="eleven-state notice">{notice}</p>}
      {!loading && voices.length > 0 && (
        <div className="eleven-selectors">
          <label>
            <span><i>Ж</i> Първи глас</span>
            <div>
              <select value={primary} onChange={(event) => onPrimary(event.target.value)}>
                {primaryOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>{optionLabel(voice)}</option>
                ))}
              </select>
              <button
                onClick={() => primary && onPreview(primary)}
                disabled={!primary || !!previewing}
                aria-label="Чуй първия ElevenLabs глас"
              >
                {previewing === primary ? '…' : '▶'}
              </button>
            </div>
          </label>
          <label>
            <span><i>М</i> Втори глас</span>
            <div>
              <select value={secondary} onChange={(event) => onSecondary(event.target.value)}>
                {secondaryOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>{optionLabel(voice)}</option>
                ))}
              </select>
              <button
                onClick={() => secondary && onPreview(secondary)}
                disabled={!secondary || !!previewing}
                aria-label="Чуй втория ElevenLabs глас"
              >
                {previewing === secondary ? '…' : '▶'}
              </button>
            </div>
          </label>
          <p>
            Гласовете се редуват между частите. За най-добър акцент избери глас,
            означен като „български“.
          </p>
          {voiceById(primary)?.bulgarian || voiceById(secondary)?.bulgarian
            ? <strong className="bulgarian-ready">✓ Избран е проверен български глас</strong>
            : <strong className="accent-warning">Избраните гласове може да имат чужд акцент.</strong>}
        </div>
      )}
    </section>
  );
}
