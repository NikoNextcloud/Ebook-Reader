const TOKEN_KEY = 'voxora_admin_token';

const parseResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'Администраторската заявка не успя.');
    error.status = response.status;
    throw error;
  }
  return data;
};

export const getAdminToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const clearAdminToken = () => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Сесийното хранилище може да е забранено в частен режим.
  }
};

export const loginAdmin = async (password) => {
  const response = await fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await parseResponse(response);
  try {
    sessionStorage.setItem(TOKEN_KEY, data.token);
  } catch {
    // Панелът остава достъпен до затваряне, дори при забранено sessionStorage.
  }
  return data.token;
};

const authorizedFetch = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${getAdminToken()}`,
    },
  });
  if (response.status === 401) clearAdminToken();
  return parseResponse(response);
};

export const loadAdminListeners = () => authorizedFetch('/api/admin-listeners');

export const updateListenerAccess = (deviceId, action) => authorizedFetch(
  '/api/admin-listeners',
  {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, action }),
  },
);

export const forgetListenerDevice = (deviceId) => authorizedFetch(
  `/api/admin-listeners?deviceId=${encodeURIComponent(deviceId)}`,
  { method: 'DELETE' },
);

