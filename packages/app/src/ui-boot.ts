import { bridge } from "@kiwi/secrets/secrets.ts";

let booted = false;

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error));

export function uiBooted(): void {
  if (booted) return;
  booted = true;
  void bridge()
    ?.uiReady()
    .catch(() => {});
}

export function uiFailed(error: unknown): void {
  void bridge()
    ?.uiError(describe(error))
    .catch(() => {});
}

export function watchUiBoot(): void {
  window.addEventListener("error", (e) => {
    if (!booted) uiFailed(e.error ?? e.message);
  });
}
