const KEY_STORAGE = 'task-manager-access-key';

export function getAccessKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

export function setAccessKey(value) {
  if (value) localStorage.setItem(KEY_STORAGE, value);
  else localStorage.removeItem(KEY_STORAGE);
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const key = getAccessKey();
  if (key) headers['x-task-manager-key'] = key;
  if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Request failed.');
    error.status = response.status;
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    throw error;
  }
  return payload;
}

export const json = value => JSON.stringify(value);
