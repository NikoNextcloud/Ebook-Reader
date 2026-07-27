// Статистика на слушането: общо време, тази седмица и streak (дни поред).
const KEY = 'voxora_stats';

// Денят се брои по МЕСТНО време. С toISOString денонощието свършваше в 02:00–03:00
// местно време и вечерното слушане се приписваше на предишния ден.
const dayKey = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const today = () => dayKey();

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { total: 0, byDay: {} };
  } catch {
    return { total: 0, byDay: {} };
  }
};

const write = (data) => {
  try {
    // пази само последните ~120 дни
    const days = Object.keys(data.byDay).sort().slice(-120);
    data.byDay = Object.fromEntries(days.map((d) => [d, data.byDay[d]]));
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* игнорирай */
  }
};

// Слушането се отчита всяка секунда, но запис в localStorage на всяка секунда
// излишно натоварва телефона — затова трупаме и записваме на интервали.
const FLUSH_AFTER_SECONDS = 15;
let pending = 0;

const flush = () => {
  if (!pending) return;
  const data = read();
  const day = today();
  data.total += pending;
  data.byDay[day] = (data.byDay[day] || 0) + pending;
  pending = 0;
  write(data);
};

export const addListening = (seconds) => {
  if (!seconds) return;
  pending += seconds;
  if (pending >= FLUSH_AFTER_SECONDS) flush();
};

// Записва натрупаното веднага (при пауза, спиране или напускане на страницата).
export const flushListening = () => flush();

if (typeof window !== 'undefined') {
  // Ако разделът се скрие или затвори, не губим последните секунди.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export const getStats = () => {
  const data = read();
  const day = today();
  // Включваме и още незаписаните секунди, за да е числото винаги актуално.
  const live = pending;

  // тази седмица (последните 7 дни)
  let week = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    week += data.byDay[dayKey(d)] || 0;
  }

  // streak: последователни дни със слушане, завършващи днес/вчера
  const byDay = { ...data.byDay };
  if (live) byDay[day] = (byDay[day] || 0) + live;

  let streak = 0;
  const cursor = new Date();
  if (!byDay[day]) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const key = dayKey(cursor);
    if (byDay[key]) { streak += 1; cursor.setDate(cursor.getDate() - 1); } else break;
  }

  return { total: data.total + live, week: week + live, streak };
};
