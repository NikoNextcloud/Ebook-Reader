// Таймер за сън — спира след избрания брой минути или в края на главата.
const options = [0, 15, 30, 45, 60];

export default function SleepTimer({ minutes, onChange, remaining, chapterMode, onChapterMode, hasChapters }) {
  return (
    <section className="control-section sleep-timer">
      <div className="inline-title">
        <div>
          <span className="eyebrow">05 · ТАЙМЕР ЗА СЪН</span>
          <h3>Спри след време</h3>
        </div>
        {minutes > 0 && remaining != null && (
          <strong className="speed-value">{Math.ceil(remaining / 60)} мин.</strong>
        )}
      </div>
      <div className="sleep-options">
        {options.map((value) => (
          <button
            key={value}
            className={minutes === value && !chapterMode ? 'active' : ''}
            onClick={() => { onChapterMode(false); onChange(value); }}
          >
            {value === 0 ? 'Изкл.' : `${value} мин.`}
          </button>
        ))}
        {hasChapters && (
          <button className={chapterMode ? 'active' : ''} onClick={() => { onChange(0); onChapterMode(!chapterMode); }}>
            Край на главата
          </button>
        )}
      </div>
    </section>
  );
}
