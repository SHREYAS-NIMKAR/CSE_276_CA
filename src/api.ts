let csrfTokenStore = '';
let sessionTokenStore = (() => {
  try {
    return typeof window !== 'undefined'
      ? window.sessionStorage.getItem('ai_gov_session_token') || ''
      : '';
  } catch {
    return '';
  }
})();
let onUnauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string) {
  csrfTokenStore = token;
}

export function setSessionToken(token: string) {
  sessionTokenStore = token;
  try {
    if (typeof window !== 'undefined') {
      if (token) {
        window.sessionStorage.setItem('ai_gov_session_token', token);
      } else {
        window.sessionStorage.removeItem('ai_gov_session_token');
      }
    }
  } catch {
    // Fallback to in-memory sessionTokenStore when storage is blocked in strict iframes
  }
}

export function setOnUnauthorized(handler: () => void) {
  onUnauthorizedHandler = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  if (sessionTokenStore && !headers.has('X-Session-Token')) {
    headers.set('X-Session-Token', sessionTokenStore);
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrfTokenStore) {
    headers.set('X-CSRF-Token', csrfTokenStore);
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
    setSessionToken('');
    if (onUnauthorizedHandler) onUnauthorizedHandler();
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    if (contentType.includes('application/json')) {
      const errBody = await res.json().catch(() => ({}));
      if (errBody?.error) message = errBody.error;
    }
    throw new ApiError(res.status, message);
  }

  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export async function downloadAuthedFile(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  if (sessionTokenStore) {
    headers.set('X-Session-Token', sessionTokenStore);
  }
  const res = await fetch(`/api${path}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  if (res.status === 401) {
    setSessionToken('');
    if (onUnauthorizedHandler) onUnauthorizedHandler();
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Download failed (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
