import type { ApiErrorBody } from '@irm/shared';

/** Error thrown for any non-2xx API response. Carries field errors for forms. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

/** The CSRF token is held in memory only. It is refreshed from /auth/me on load. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

const BASE = '/api/v1';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    cache: 'no-store',
  });

  // A 401 from a sign-in step means wrong credentials or code, not an expired session:
  // the caller shows the error instead of being sent to the staff sign-in page.
  const signInStep = ['/auth/login', '/auth/mfa/verify', '/participant/otp/'].some((p) => path.startsWith(p));
  if (res.status === 401 && typeof window !== 'undefined' && !signInStep) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    // A full page load is intended here: it drops all cached query data from the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${next}&expired=1`);
    throw new ApiError(401, 'Session expired');
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.message ?? 'Something went wrong. Please try again.', err.errors ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /** Multipart upload. The browser sets the boundary header. */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};
