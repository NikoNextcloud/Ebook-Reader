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

  try {
    const upstream = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false', {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      const status = upstream.status === 401 ? 401 : 502;
      return json({
        configured: true,
        message: status === 401
          ? 'ElevenLabs ключът във Vercel е невалиден.'
          : 'ElevenLabs временно не връща списъка с гласове.',
        voices: [],
      }, status);
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
