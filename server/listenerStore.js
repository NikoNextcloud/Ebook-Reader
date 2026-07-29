import { createHmac } from 'node:crypto';

export const ACTIVE_WINDOW_MS = 45 * 1000;
export const DEVICE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_HISTORY = 500;

const PREFIX = 'voxora:listeners:v1';
export const KEYS = {
  devices: `${PREFIX}:devices`,
  seen: `${PREFIX}:seen`,
  blocked: `${PREFIX}:blocked`,
  history: `${PREFIX}:history`,
};

const redisConfig = () => ({
  url: String(
    process.env.KV_REST_API_URL
    || process.env.UPSTASH_REDIS_REST_URL
    || '',
  ).replace(/\/+$/, ''),
  token: String(
    process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
    || '',
  ),
});

export const listenerStoreConfigured = () => {
  const { url, token } = redisConfig();
  return !!url && !!token;
};

export const redisPipeline = async (commands) => {
  const { url, token } = redisConfig();
  if (!url || !token) throw new Error('LISTENER_STORE_NOT_CONFIGURED');
  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`LISTENER_STORE_HTTP_${response.status}`);
  const results = await response.json();
  const failed = results.find((entry) => entry?.error);
  if (failed) throw new Error(`LISTENER_STORE_REDIS_${failed.error}`);
  return results.map((entry) => entry?.result);
};

export const redisCommand = async (...command) => (
  (await redisPipeline([command]))[0]
);

const limited = (value, max = 120) => String(value || '').trim().slice(0, max);
const finite = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
};

export const validDeviceId = (value) => /^[A-Za-z0-9_-]{20,80}$/.test(value || '');

export const clientIp = (request) => (
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || request.headers.get('x-real-ip')
  || 'unknown'
);

export const networkIdFor = (request) => {
  const secret = process.env.VOXORA_ADMIN_SECRET || process.env.VOXORA_ADMIN_PASSWORD || 'voxora';
  return createHmac('sha256', secret).update(clientIp(request)).digest('hex').slice(0, 12);
};

export const locationFor = (request) => {
  const city = limited(request.headers.get('x-vercel-ip-city'), 60);
  const country = limited(request.headers.get('x-vercel-ip-country'), 8);
  return [city, country].filter(Boolean).join(', ');
};

export const sanitizeHeartbeat = (body, request, now = Date.now()) => {
  const state = ['playing', 'paused', 'idle', 'stopped'].includes(body.state)
    ? body.state
    : 'idle';
  const book = body.book && typeof body.book === 'object' ? {
    id: limited(body.book.id, 100),
    title: limited(body.book.title, 160) || 'Без заглавие',
    type: body.book.type === 'audio' ? 'audio' : 'text',
  } : null;

  return {
    id: limited(body.deviceId, 80),
    sessionId: limited(body.sessionId, 80),
    label: limited(body.device?.label, 80) || 'Непознато устройство',
    os: limited(body.device?.os, 40),
    browser: limited(body.device?.browser, 40),
    state,
    book,
    position: finite(body.position, 0, 365 * 24 * 60 * 60),
    duration: finite(body.duration, 0, 365 * 24 * 60 * 60),
    firstSeen: now,
    lastSeen: now,
    lastActiveAt: state === 'playing' ? now : 0,
    location: locationFor(request),
    networkId: networkIdFor(request),
  };
};

export const parseDevice = (value) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const eventLabel = (state) => ({
  playing: 'Започна слушане',
  paused: 'Пауза',
  stopped: 'Спря слушането',
  idle: 'Отвори приложението',
}[state] || 'Активност');

export const createHistoryEvent = (device, at = Date.now(), action = '') => ({
  id: `${at}-${device.id}-${Math.random().toString(36).slice(2, 8)}`,
  at,
  deviceId: device.id,
  deviceLabel: device.label,
  state: action || device.state,
  label: action || eventLabel(device.state),
  book: device.book,
  position: device.position,
  duration: device.duration,
  location: device.location,
});

export const parseHashResult = (values) => {
  const devices = [];
  for (let index = 0; index < (values || []).length; index += 2) {
    const device = parseDevice(values[index + 1]);
    if (device) devices.push(device);
  }
  return devices;
};

export const parseHistory = (values) => (
  (values || []).map(parseDevice).filter(Boolean)
);

export const isSameActivity = (previous, next) => (
  previous
  && previous.state === next.state
  && previous.book?.id === next.book?.id
);

export const mergeDevice = (previous, next) => ({
  ...previous,
  ...next,
  firstSeen: previous?.firstSeen || next.firstSeen,
  lastActiveAt: next.state === 'playing'
    ? next.lastSeen
    : previous?.lastActiveAt || next.lastActiveAt,
  blocked: !!previous?.blocked,
});
