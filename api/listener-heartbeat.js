import {
  KEYS,
  MAX_HISTORY,
  createHistoryEvent,
  isSameActivity,
  listenerStoreConfigured,
  mergeDevice,
  parseDevice,
  redisPipeline,
  sanitizeHeartbeat,
  validDeviceId,
} from '../server/listenerStore.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

const sameOrigin = (request) => {
  const origin = request.headers.get('origin');
  return !origin || new URL(origin).host === new URL(request.url).host;
};

export async function POST(request) {
  if (!sameOrigin(request)) return json({ message: 'Непозволен източник.' }, 403);
  if (!listenerStoreConfigured()) return json({ tracking: false });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Невалидна заявка.' }, 400);
  }
  if (!validDeviceId(body.deviceId)) {
    return json({ message: 'Невалиден идентификатор на устройство.' }, 400);
  }

  try {
    const [stored, blocked] = await redisPipeline([
      ['HGET', KEYS.devices, body.deviceId],
      ['SISMEMBER', KEYS.blocked, body.deviceId],
    ]);
    const previous = parseDevice(stored);
    const now = Date.now();
    const next = mergeDevice(previous, sanitizeHeartbeat(body, request, now));
    next.blocked = Number(blocked) === 1;

    if (next.blocked) {
      await redisPipeline([
        ['HSET', KEYS.devices, next.id, JSON.stringify(next)],
        ['ZADD', KEYS.seen, now, next.id],
      ]);
      return json({
        blocked: true,
        message: 'Достъпът на това устройство е спрян от администратор.',
      }, 403);
    }

    const commands = [
      ['HSET', KEYS.devices, next.id, JSON.stringify(next)],
      ['ZADD', KEYS.seen, now, next.id],
    ];
    if (!isSameActivity(previous, next)) {
      commands.push(
        ['LPUSH', KEYS.history, JSON.stringify(createHistoryEvent(next, now))],
        ['LTRIM', KEYS.history, 0, MAX_HISTORY - 1],
      );
    }
    await redisPipeline(commands);
    return json({ tracking: true, blocked: false });
  } catch {
    // Статистиката не трябва да прекъсва слушането при временен проблем с Redis.
    return json({ tracking: false });
  }
}
