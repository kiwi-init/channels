import type { Page, Request } from "playwright-core";

export type Settle = {
  inFlight(): string[];
  settled(ms?: number): Promise<void>;
};

export function settleRequests(page: Page, matches: (url: URL) => boolean): Settle {
  const open = new Map<Request, string>();
  const waiters = new Set<() => void>();
  const close = (request: Request) => {
    if (!open.delete(request) || open.size) return;
    for (const wake of [...waiters]) wake();
  };
  page.on("request", (request) => {
    if (matches(new URL(request.url()))) open.set(request, request.url());
  });
  page.on("requestfinished", close);
  page.on("requestfailed", close);
  return {
    inFlight: () => [...open.values()],
    settled: (ms = 10_000) =>
      open.size
        ? new Promise<void>((done, fail) => {
            const wake = () => {
              clearTimeout(timer);
              waiters.delete(wake);
              done();
            };
            const timer = setTimeout(() => {
              waiters.delete(wake);
              fail(new Error(`still in flight after ${ms} ms: ${[...open.values()].join(", ")}`));
            }, ms);
            waiters.add(wake);
          })
        : Promise.resolve(),
  };
}

export const reactionsOn =
  (base: string) =>
  (url: URL): boolean =>
    url.origin === new URL(base).origin && url.pathname.startsWith("/reactions/");
