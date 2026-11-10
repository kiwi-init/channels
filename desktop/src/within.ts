export const FETCH_MS = 15_000;

export function within(init: RequestInit = {}, ms: number = FETCH_MS): RequestInit {
  return { ...init, signal: AbortSignal.timeout(ms) };
}

export const timedFetch: typeof fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, within(init)), { preconnect: fetch.preconnect });
