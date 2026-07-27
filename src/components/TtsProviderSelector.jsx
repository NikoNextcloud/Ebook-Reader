export default function TtsProviderSelector({ value, onChange }) {
  return (
    <section className="control-section provider-section">
      <span className="eyebrow">AI ДВИГАТЕЛ</span>
      <h3>Избери качество на разказвача</h3>
      <div className="provider-picker" role="group" aria-label="AI двигател за четене">
        <button className={value === 'gemini' ? 'active' : ''} onClick={() => onChange('gemini')}>
          <b>Gemini</b>
          <small>Сегашните AI гласове</small>
        </button>
        <button className={value === 'elevenlabs' ? 'active eleven' : ''} onClick={() => onChange('elevenlabs')}>
          <b>ElevenLabs</b>
          <small>Multilingual v2 · аудиокниги</small>
        </button>
      </div>
    </section>
  );
}
