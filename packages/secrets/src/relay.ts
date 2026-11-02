// The relay URL, in one place. In the desktop app it is the shell's bridge
// (window.kiwi.relayUrl), and only that: the page's own URL is never trusted
// there, since the sign-in token goes wherever the relay is. In a browser it
// is a `?relay=` param, but only in a development build (where the dev server
// proxies /v1 to the relay); a production page never lets its URL steer the
// relay. Nothing else in the renderer may use location.origin for relay
// traffic: call relayUrl() here instead.

import { DEFAULT_RELAY } from "@kiwi/core/relay-url.ts";

export function relayOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    const web = u.protocol === "https:" || u.protocol === "http:";
    return web && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.?$|^\[[0-9a-f:.]+\]$/.test(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

function fromBridge(): string | null {
  try {
    return relayOrigin((window as unknown as { kiwi?: { relayUrl?: unknown } }).kiwi?.relayUrl);
  } catch {
    return null;
  }
}

function fromEntry(): string | null {
  try {
    return relayOrigin(new URLSearchParams(window.location.search).get("relay"));
  } catch {
    return null;
  }
}

/** Whether this renderer is a development build (Vite's import.meta.env.DEV; false outside a bundler). */
export function devBuild(): boolean {
  try {
    const dev = (import.meta.env as { DEV?: unknown } | undefined)?.DEV;
    return dev === true || dev === "true";
  } catch {
    return false;
  }
}

/** The relay this renderer talks to. */
export function relayUrl(): string {
  if (hasBridge()) return fromBridge() ?? DEFAULT_RELAY;
  return (devBuild() ? fromEntry() : null) ?? window.location.origin;
}

/** Whether the renderer runs inside the desktop shell (a bridge is present). */
export function hasBridge(): boolean {
  try {
    return !!(window as unknown as { kiwi?: unknown }).kiwi;
  } catch {
    return false;
  }
}
