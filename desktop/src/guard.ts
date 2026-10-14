// The main process's rules about what may load, open and be read, as plain functions (no electron
// here), so they can be tested without an app. main.ts wires them to the window, the kiwi-app://
// handler and the secrets store.

import path from "node:path";

export const APP_SCHEME = "kiwi-app";
export const APP_HOST = "app";

/** Whether `url` is the app's own page (kiwi-app://app/…): the only thing the window may show. */
export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST;
  } catch {
    return false;
  }
}

/** `url`, if it may go to the system browser: http(s) only (never file:, javascript:, a custom scheme). */
export function externalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** A relay the app may talk to: https anywhere, http only on this computer. Its origin, or null. */
export function normalizeRelay(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol === "https:") return u.origin;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")) return u.origin;
    return null;
  } catch {
    return null;
  }
}

/**
 * The file under `root` that a kiwi-app:// path names, or null when it doesn't name one inside it
 * (a `..` that climbs out, a sibling folder that merely starts with root's name, a bad %-escape).
 * Paths without an extension are the single-page app's routes: index.html.
 */
export function fileFor(root: string, pathname: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (p.includes("\0")) return null;
  if (p === "/" || !path.extname(p)) p = "/index.html";
  const base = path.resolve(root);
  const file = path.resolve(base, `.${path.posix.normalize(`/${p}`)}`);
  const rel = path.relative(base, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? file : null;
}

/** WorkOS, which the renderer reaches for sign-in (as the hosted web's CSP allows, web/public/_headers). */
const WORKOS = ["https://api.workos.com", "https://possible-pleasure-97.authkit.app"];

/**
 * The Content-Security-Policy for every kiwi-app:// response: the hosted web's (web/public/_headers),
 * plus the relay this app talks to, over HTTP and its WebSocket. No eval, no inline script, nothing
 * framed, no form posts: script that got in some other way still can't phone anywhere else.
 */
export function csp(relay: string): string {
  const origin = normalizeRelay(relay);
  const socket = origin ? origin.replace(/^http/, "ws") : null;
  const connect = ["'self'", ...(origin ? [origin, socket!] : []), ...WORKOS].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** What reading the store found: nothing yet (a first run), the saved JSON, or a file it couldn't read. */
export type StoreRead = { kind: "none" } | { kind: "ok"; json: unknown; encrypted: boolean } | { kind: "unreadable"; why: string };

/**
 * Read the store's bytes: decrypted when encryption works (and they were encrypted), else as the plain
 * JSON a run without a keychain writes. Anything else is unreadable, never an empty store: an empty
 * store saved over it would wipe every key.
 */
export function readStore(raw: Buffer | null, decrypt: ((b: Buffer) => string) | null): StoreRead {
  if (raw === null) return { kind: "none" };
  const parse = (s: string): unknown => {
    const v = JSON.parse(s) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a store");
    return v;
  };
  let why = "";
  if (decrypt) {
    try {
      return { kind: "ok", json: parse(decrypt(raw)), encrypted: true };
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
  }
  try {
    return { kind: "ok", json: parse(raw.toString("utf8")), encrypted: false };
  } catch (e) {
    return { kind: "unreadable", why: why || (e instanceof Error ? e.message : String(e)) };
  }
}
