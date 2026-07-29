const DEVICE_KEY = 'voxora_listener_device_id';
const SESSION_KEY = 'voxora_listener_session_id';
export const ACCESS_BLOCKED_EVENT = 'voxora:access-blocked';

const randomId = (prefix) => {
  const value = window.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${value.replace(/[^A-Za-z0-9_-]/g, '')}`;
};

const storedId = (storage, key, prefix) => {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = randomId(prefix);
    storage.setItem(key, created);
    return created;
  } catch {
    return randomId(prefix);
  }
};

export const listenerDeviceId = () => storedId(
  localStorage,
  DEVICE_KEY,
  'device',
);

export const listenerSessionId = () => storedId(
  sessionStorage,
  SESSION_KEY,
  'session',
);

const browserName = (agent) => {
  if (/Edg\//.test(agent)) return 'Edge';
  if (/OPR\//.test(agent)) return 'Opera';
  if (/CriOS\//.test(agent)) return 'Chrome iOS';
  if (/Chrome\//.test(agent)) return 'Chrome';
  if (/FxiOS\//.test(agent)) return 'Firefox iOS';
  if (/Firefox\//.test(agent)) return 'Firefox';
  if (/Safari\//.test(agent)) return 'Safari';
  return 'Браузър';
};

const osName = (agent) => {
  if (/iPhone|iPad|iPod/.test(agent)) return 'iOS';
  if (/Android/.test(agent)) return 'Android';
  if (/Windows/.test(agent)) return 'Windows';
  if (/Mac OS/.test(agent)) return 'macOS';
  if (/Linux/.test(agent)) return 'Linux';
  return navigator.platform || 'Устройство';
};

export const listenerDeviceProfile = () => {
  const agent = navigator.userAgent || '';
  const os = osName(agent);
  const browser = browserName(agent);
  return {
    os,
    browser,
    label: `${os} · ${browser}`,
  };
};

const safeNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const reportListenerActivity = async ({
  state = 'idle',
  book = null,
  position = 0,
  duration = 0,
} = {}) => {
  try {
    const response = await fetch('/api/listener-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: state !== 'playing',
      body: JSON.stringify({
        deviceId: listenerDeviceId(),
        sessionId: listenerSessionId(),
        device: listenerDeviceProfile(),
        state,
        book: book ? {
          id: String(book.id || ''),
          title: String(book.title || 'Без заглавие'),
          type: book.type === 'audio' ? 'audio' : 'text',
        } : null,
        position: safeNumber(position),
        duration: safeNumber(duration),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 403 && data.blocked) {
      window.dispatchEvent(new CustomEvent(ACCESS_BLOCKED_EVENT, {
        detail: { message: data.message },
      }));
      return { blocked: true };
    }
    return data;
  } catch {
    return { tracking: false };
  }
};

