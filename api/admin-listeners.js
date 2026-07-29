import { verifyAdminToken } from '../server/adminAuth.js';
import {
  ACTIVE_WINDOW_MS,
  DEVICE_RETENTION_MS,
  KEYS,
  createHistoryEvent,
  listenerStoreConfigured,
  parseDevice,
  parseHashResult,
  parseHistory,
  redisPipeline,
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

const authorize = (request) => {
  if (!listenerStoreConfigured()) {
    return json({ message: 'Upstash Redis не е свързан.' }, 503);
  }
  if (!verifyAdminToken(request)) {
    return json({ message: 'Администраторската сесия е изтекла.' }, 401);
  }
  return null;
};

export async function GET(request) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const now = Date.now();
    const cutoff = now - DEVICE_RETENTION_MS;
    const [hashValues, blockedIds, historyValues, staleIds] = await redisPipeline([
      ['HGETALL', KEYS.devices],
      ['SMEMBERS', KEYS.blocked],
      ['LRANGE', KEYS.history, 0, 199],
      ['ZRANGEBYSCORE', KEYS.seen, 0, cutoff],
    ]);
    const blocked = new Set(blockedIds || []);
    const stale = new Set(staleIds || []);
    const devices = parseHashResult(hashValues)
      .filter((device) => !stale.has(device.id))
      .map((device) => ({
        ...device,
        blocked: blocked.has(device.id),
        active: !blocked.has(device.id)
          && device.state === 'playing'
          && now - device.lastSeen <= ACTIVE_WINDOW_MS,
      }))
      .sort((a, b) => b.lastSeen - a.lastSeen);

    if (stale.size) {
      await redisPipeline([
        ['HDEL', KEYS.devices, ...stale],
        ['ZREM', KEYS.seen, ...stale],
        ['SREM', KEYS.blocked, ...stale],
      ]);
    }

    return json({
      generatedAt: now,
      activeWindowSeconds: ACTIVE_WINDOW_MS / 1000,
      summary: {
        active: devices.filter((device) => device.active).length,
        paused: devices.filter((device) => !device.blocked && device.state === 'paused').length,
        blocked: devices.filter((device) => device.blocked).length,
        total: devices.length,
      },
      devices,
      history: parseHistory(historyValues),
    });
  } catch {
    return json({ message: 'Данните за слушателите временно не са достъпни.' }, 503);
  }
}

export async function PATCH(request) {
  const denied = authorize(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Невалидна заявка.' }, 400);
  }
  const deviceId = String(body.deviceId || '');
  const action = String(body.action || '');
  if (!validDeviceId(deviceId) || !['block', 'unblock'].includes(action)) {
    return json({ message: 'Невалидно администраторско действие.' }, 400);
  }

  try {
    const [stored] = await redisPipeline([['HGET', KEYS.devices, deviceId]]);
    const device = parseDevice(stored);
    if (!device) return json({ message: 'Устройството не е намерено.' }, 404);
    const blocked = action === 'block';
    const now = Date.now();
    const next = {
      ...device,
      blocked,
      state: blocked ? 'stopped' : device.state,
      lastSeen: now,
    };
    await redisPipeline([
      [blocked ? 'SADD' : 'SREM', KEYS.blocked, deviceId],
      ['HSET', KEYS.devices, deviceId, JSON.stringify(next)],
      ['LPUSH', KEYS.history, JSON.stringify(createHistoryEvent(
        next,
        now,
        blocked ? 'Достъпът е спрян' : 'Достъпът е възстановен',
      ))],
      ['LTRIM', KEYS.history, 0, 499],
    ]);
    return json({ ok: true, blocked });
  } catch {
    return json({ message: 'Действието не можа да бъде изпълнено.' }, 503);
  }
}

export async function DELETE(request) {
  const denied = authorize(request);
  if (denied) return denied;
  const deviceId = new URL(request.url).searchParams.get('deviceId') || '';
  if (!validDeviceId(deviceId)) {
    return json({ message: 'Невалидно устройство.' }, 400);
  }

  try {
    const [historyValues] = await redisPipeline([
      ['LRANGE', KEYS.history, 0, 499],
    ]);
    const keptHistory = (historyValues || []).filter((value) => {
      const event = parseDevice(value);
      return event?.deviceId !== deviceId;
    });
    const commands = [
      ['HDEL', KEYS.devices, deviceId],
      ['ZREM', KEYS.seen, deviceId],
      ['SREM', KEYS.blocked, deviceId],
      ['DEL', KEYS.history],
    ];
    if (keptHistory.length) commands.push(['RPUSH', KEYS.history, ...keptHistory]);
    await redisPipeline(commands);
    return json({ ok: true });
  } catch {
    return json({ message: 'Историята не можа да бъде изтрита.' }, 503);
  }
}
