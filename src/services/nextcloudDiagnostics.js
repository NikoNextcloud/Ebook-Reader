const messages = {
  NEXTCLOUD_INVALID_PATH: 'Невалиден път към аудиокнига. Избери книгата от каталога отново.',
  NEXTCLOUD_INVALID_RANGE: 'Невалиден диапазон за аудиото.',
  NEXTCLOUD_NOT_CONFIGURED: 'Източникът Nextcloud не е настроен.',
  NEXTCLOUD_INVALID_CONFIG: 'Настройката на източника Nextcloud е невалидна.',
  NEXTCLOUD_CONNECTION_FAILED: 'Не може да се установи връзка с Nextcloud. Опитай отново по-късно.',
  NEXTCLOUD_REDIRECT_BLOCKED: 'Nextcloud върна пренасочване. Провери настройката на публичното споделяне.',
  NEXTCLOUD_REQUEST_ABORTED: 'Заявката за аудио е прекратена.',
};

// Run only after a playback failure. HEAD obtains diagnostics without
// downloading audio or slowing down catalog indexing and successful playback.
export const describeNextcloudProblem = async (url) => {
  if (typeof url !== 'string' || !url.startsWith('/api/nextcloud-stream?')) return null;
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) return null;
    const error = response.headers.get('x-nextcloud-error');
    if (Object.hasOwn(messages, error)) return messages[error];
    if (error === 'NEXTCLOUD_UPSTREAM_HTTP_ERROR') {
      const status = response.headers.get('x-nextcloud-upstream-status');
      if (status === '404') return 'Аудиокнигата не е намерена в Nextcloud. Обнови каталога.';
      if (/^[45]\d{2}$/.test(status || '')) return `Nextcloud отказа аудиото (HTTP ${status}).`;
    }
    // A hosting proxy can replace the response. Do not display its raw body.
    return `Аудиото от Nextcloud е недостъпно (HTTP ${response.status}).`;
  } catch {
    return 'Не може да се провери връзката с Nextcloud. Опитай отново по-късно.';
  }
};
