/* global AbortSignal, Response, URL, fetch, process */

const MAX_TEXT_LENGTH = 9000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 40;
const requests = new Map();

const json = (data, status) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

const clientId = (request) => (
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || request.headers.get('x-real-ip')
  || 'unknown'
);

const MAX_TRACKED_CLIENTS = 5000;

const isRateLimited = (id) => {
  const now = Date.now();

  // Чистим изтеклите записи, за да не расте Map-ът неограничено при дълго
  // живееща функция (изтичане на памет).
  if (requests.size > MAX_TRACKED_CLIENTS) {
    for (const [key, value] of requests) {
      if (now - value.started > WINDOW_MS) requests.delete(key);
    }
    // Ако всичко е още активно, започваме начисто вместо да растем безкрайно.
    if (requests.size > MAX_TRACKED_CLIENTS) requests.clear();
  }

  const current = requests.get(id);
  if (!current || now - current.started > WINDOW_MS) {
    requests.set(id, { started: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
};

const validVoiceId = (value) => /^[A-Za-z0-9_-]{8,80}$/.test(value || '');

export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ message: 'Непозволен източник на заявката.' }, 403);
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ message: 'ElevenLabs не е настроен във Vercel.' }, 503);
  if (isRateLimited(clientId(request))) {
    return json({ message: 'Твърде много заявки. Изчакай няколко минути.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Невалидна заявка.' }, 400);
  }

  const text = String(body.text || '').trim();
  const voiceId = String(body.voiceId || '');
  if (!text || text.length > MAX_TEXT_LENGTH || !validVoiceId(voiceId)) {
    return json({ message: 'Текстът или избраният глас е невалиден.' }, 400);
  }

  const previousText = String(body.previousText || '').slice(-1000);
  const nextText = String(body.nextText || '').slice(0, 1000);

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          previous_text: previousText || undefined,
          next_text: nextText || undefined,
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.78,
            style: 0.18,
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(55000),
      },
    );

    if (!upstream.ok || !upstream.body) {
      // Показваме и обяснението на ElevenLabs — иначе „ключът е невалиден“
      // се появява и когато проблемът е права, кредити или изтекъл абонамент.
      const detail = await upstream.text().catch(() => '');
      const short = detail ? ` · ${detail.slice(0, 300)}` : '';
      if (upstream.status === 401 || upstream.status === 403) {
        return json({
          message: `ElevenLabs отказа ключа (HTTP ${upstream.status})${short}. Провери правата на ключа и дали проектът е преразгърнат след добавянето му.`,
        }, 401);
      }
      if (upstream.status === 429) return json({ message: `ElevenLabs лимитът е изчерпан${short}.` }, 429);
      return json({ message: `ElevenLabs не успя да генерира гласа (HTTP ${upstream.status})${short}.` }, 502);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return json({ message: 'ElevenLabs не отговори навреме.' }, 504);
  }
}
