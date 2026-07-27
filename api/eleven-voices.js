/* global AbortSignal, Response, fetch, process */

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json({
      configured: false,
      message: 'Добави ELEVENLABS_API_KEY във Vercel Environment Variables.',
      voices: [],
    }, 503);
  }

  // Някои ключове нямат достъп до v2 (или до `voices_read`), затова при
  // отказ пробваме и класическия v1 адрес, преди да кажем, че ключът е грешен.
  const endpoints = [
    'https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false',
    'https://api.elevenlabs.io/v1/voices',
  ];

  try {
    let upstream = null;
    let lastDetail = '';

    for (const endpoint of endpoints) {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(endpoint, {
        headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) { upstream = response; break; }
      // eslint-disable-next-line no-await-in-loop
      const text = await response.text().catch(() => '');
      lastDetail = `HTTP ${response.status}${text ? ` · ${text.slice(0, 300)}` : ''}`;
    }

    if (!upstream) {
      const unauthorized = /HTTP 401|HTTP 403/.test(lastDetail);
      return json({
        configured: true,
        // Показваме и точния отговор на ElevenLabs, за да се вижда дали ключът е
        // грешен, изтекъл, без права, или профилът е блокиран.
        message: unauthorized
          ? `ElevenLabs отказа ключа (${lastDetail}). Провери дали ELEVENLABS_API_KEY във Vercel е активен, има права "Text to Speech" и "Voices" и дали проектът е преразгърнат след добавянето му.`
          : `ElevenLabs не върна списъка с гласове (${lastDetail || 'няма отговор'}).`,
        detail: lastDetail,
        voices: [],
      }, unauthorized ? 401 : 502);
    }

    const data = await upstream.json();
    const voices = (data.voices || []).map((voice) => {
      const verified = voice.verified_languages || [];
      const bulgarian = verified.find((item) => item.language === 'bg' || item.locale === 'bg-BG');
      return {
        id: voice.voice_id,
        name: voice.name,
        category: voice.category || '',
        gender: voice.labels?.gender || '',
        accent: bulgarian?.accent || voice.labels?.accent || '',
        bulgarian: !!bulgarian,
        previewUrl: bulgarian?.preview_url || voice.preview_url || '',
      };
    }).sort((a, b) => Number(b.bulgarian) - Number(a.bulgarian) || a.name.localeCompare(b.name));

    return json({ configured: true, voices });
  } catch {
    return json({
      configured: true,
      message: 'Неуспешна връзка с ElevenLabs.',
      voices: [],
    }, 502);
  }
}
