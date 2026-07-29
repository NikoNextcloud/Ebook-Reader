import {
  createAdminToken,
  passwordConfigured,
  passwordMatches,
} from '../server/adminAuth.js';
import {
  clientIp,
  listenerStoreConfigured,
  redisPipeline,
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
  if (!passwordConfigured()) {
    return json({
      message: 'Добави VOXORA_ADMIN_PASSWORD във Vercel Environment Variables.',
    }, 503);
  }
  if (!listenerStoreConfigured()) {
    return json({
      message: 'Свържи Upstash Redis към проекта във Vercel Marketplace.',
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Невалидна заявка.' }, 400);
  }

  const rateKey = `voxora:admin-login:${clientIp(request)}`;
  try {
    const [attempts] = await redisPipeline([
      ['INCR', rateKey],
      ['EXPIRE', rateKey, 600],
    ]);
    if (Number(attempts) > 8) {
      return json({ message: 'Твърде много опити. Изчакай 10 минути.' }, 429);
    }
  } catch {
    return json({ message: 'Администраторската услуга временно не отговаря.' }, 503);
  }

  if (!passwordMatches(body.password)) {
    return json({ message: 'Грешна парола.' }, 401);
  }

  return json({ token: createAdminToken(), expiresIn: 12 * 60 * 60 });
}
