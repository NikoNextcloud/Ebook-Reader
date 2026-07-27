const MAX_BYTES = 40 * 1024 * 1024;

const allowedInitialUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && /(^|\.)disk\.yandex\.(ru|com|net)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
};

const allowedFetchUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && (
        /(^|\.)disk\.yandex\.(ru|com|net)$/i.test(parsed.hostname)
        || /(^|\.)storage\.yandex\.net$/i.test(parsed.hostname)
      );
  } catch {
    return false;
  }
};

const fetchYandex = async (initialUrl, signal) => {
  let target = initialUrl;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    if (!allowedFetchUrl(target)) throw new Error('BLOCKED_HOST');
    const response = await fetch(target, { redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    target = new URL(location, target).toString();
  }
  throw new Error('TOO_MANY_REDIRECTS');
};

export async function GET(request) {
  const source = new URL(request.url).searchParams.get('url') || '';
  if (!allowedInitialUrl(source)) return new Response('Неподдържан източник.', { status: 400 });

  try {
    const upstream = await fetchYandex(source, request.signal);
    if (!upstream.ok || !upstream.body) {
      return new Response('Файлът не може да се изтегли.', { status: upstream.status || 502 });
    }

    const length = Number(upstream.headers.get('content-length') || 0);
    if (length > MAX_BYTES) return new Response('Файлът е по-голям от 40 MB.', { status: 413 });

    let received = 0;
    const reader = upstream.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > MAX_BYTES) {
          await reader.cancel();
          controller.error(new Error('FILE_TOO_LARGE'));
          return;
        }
        controller.enqueue(value);
      },
      cancel() {
        reader.cancel();
      },
    });

    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (length) headers.set('Content-Length', String(length));

    return new Response(body, {
      status: 200,
      headers,
    });
  } catch {
    return new Response('Временна грешка при изтеглянето.', { status: 502 });
  }
}
