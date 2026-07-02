import { listVoicesForGender } from '../services/speechService';

export default function VoiceSelector({ voices, selected, onSelect, gender, onGender, simulated }) {
  const list = listVoicesForGender(voices, gender);
  return (
    <section className="control-section">
      <span className="eyebrow">02 · AI ГЛАС</span>
      <h3>Избери разказвач</h3>
      <div className="gender-picker" role="group" aria-label="Пол на гласа">
        <button className={gender === 'female' ? 'active' : ''} onClick={() => onGender('female')}>
          <span>Ж</span><b>Женски глас</b><small>Мек и ясен</small>
        </button>
        <button className={gender === 'male' ? 'active' : ''} onClick={() => onGender('male')}>
          <span>М</span><b>Мъжки глас</b><small>Плътен и спокоен</small>
        </button>
      </div>
      {list.length > 1 && (
        <label className="voice-variant">Вариант на гласа
          <select value={selected?.voiceURI || ''} onChange={e => onSelect(voices.find(v => v.voiceURI === e.target.value))}>
            {list.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
          </select>
        </label>
      )}
      <p className="voice-quality">
        {simulated
          ? '✦ На това устройство няма отделен глас за този пол — Voxora прилага тонова корекция. За най-добър женски глас отвори приложението в Microsoft Edge (глас „Kalina“).'
          : '✦ Естествени паузи и жив тембър'}
      </p>
    </section>
  );
}
