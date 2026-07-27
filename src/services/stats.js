// Статистика на слушането: общо време, тази седмица и streak (дни поред).
const KEY = 'voxora_stats';
const today = () => new Date().toISOString().slice(0, 10);

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

export const addListening = (seconds) => {
  if (!seconds) return;
  const data = read();
  const day = today();
  data.total += seconds;
  data.byDay[day] = (data.byDay[day] || 0) + seconds;
  write(data);
};

export const getStats = () => {
  const data = read();
  const day = today();

  // тази седмица (последните 7 дни)
  let week = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    week += data.byDay[d.toISOString().slice(0, 10)] || 0;
  }

  // streak: последователни дни със слушане, завършващи днес/вчера
  let streak = 0;
  const cursor = new Date();
  if (!data.byDay[day]) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (data.byDay[key]) { streak += 1; cursor.setDate(cursor.getDate() - 1); } else break;
  }

  return { total: data.total, week, streak };
};
