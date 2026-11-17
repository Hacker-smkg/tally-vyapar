import { useCallback, useEffect, useState } from 'react';

async function request(method: string, path: string, body?: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error('Cannot reach the app. Check that the office PC is on and you are on the same Wi-Fi.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('app:logout'));
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: unknown) => request('POST', path, body),
  put: (path: string, body?: unknown) => request('PUT', path, body),
  del: (path: string) => request('DELETE', path),
};

/** {a: 1, b: ''} → "?a=1" (empty values are left out). */
export function qs(o: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Loads a GET path and reloads when the path changes. Pass null to wait. */
export function useData<T = any>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error: string; path: string | null }>({ error: '', path: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api.get(path).then(
      (data) => live && setState({ data, error: '', path }),
      (e) => live && setState((s) => ({ ...s, error: e.message, path })),
    );
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: !!path && state.path !== path && !state.error, reload };
}
