// The main process's rules about what may load, open and be read, as plain functions (no electron
// here), so they can be tested without an app. main.ts wires them to the window, the kiwi-app://
// handler and the secrets store.

import fs from "node:fs";
import path from "node:path";

import { decodeJoinCode } from "../../src/crypto.ts";
import type { Identity } from "../../src/identity.ts";
import { provePerson, type PersonClaim } from "../../src/person.ts";
import type { ChannelIdentityView, ComputerView, PendingItem, PersonView, PhoneView, PublicPerson, StoreSnapshot } from "./bridge.ts";
import { publicChannel } from "./seats.ts";

export { acceptSeat, mergeChannels, mergePublicChannels, migrateEntries, withAccess } from "./seats.ts";

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
    if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.?$|^\[[0-9a-f:.]+\]$/.test(u.hostname)) return null;
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

/**
 * The Content-Security-Policy for every kiwi-app:// response: the hosted web's (web/public/_headers),
 * with the relay this app talks to, over HTTP and its WebSocket, as the only place to connect. Not
 * WorkOS: in the app, sign-in runs in main (the device flow), never in the page. No eval, no inline
 * script, nothing framed, no form posts: script that got in some other way can't phone anywhere else.
 */
export function csp(relay: string): string {
  const origin = normalizeRelay(relay);
  const socket = origin ? origin.replace(/^http/, "ws") : null;
  const connect = ["'self'", ...(origin ? [origin, socket!] : [])].join(" ");
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

export function publicPerson(p: PersonView | null): PublicPerson | null {
  return p ? { name: p.name, pk: p.pk, xpk: p.xpk } : null;
}

export interface StoredKeys {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
  computers: ComputerView[];
  phones?: PhoneView[];
  pending: PendingItem[];
}

export function snapshotOf(s: StoredKeys): StoreSnapshot {
  return { relayUrl: s.relayUrl, person: publicPerson(s.person), channels: s.channels.map(publicChannel), computers: s.computers, phones: (s.phones ?? []).map((p) => ({ label: p.label, at: p.at })), pending: s.pending };
}

export function publicComputer(c: ComputerView): ComputerView {
  return { label: c.label, os: c.os, machinePk: c.machinePk, machineXpk: c.machineXpk, personPk: c.personPk, at: c.at, ...(c.own ? { own: true } : {}) };
}

export function writePrivate(file: string, raw: Buffer, platform: NodeJS.Platform = process.platform): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform !== "win32") fs.chmodSync(dir, 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, raw, { mode: 0o600 });
    if (platform !== "win32") fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function claimFor(person: Identity, code: unknown, memberPk: unknown): Promise<PersonClaim> {
  if (typeof code !== "string" || typeof memberPk !== "string") throw new Error("bad person claim request");
  return provePerson(person, decodeJoinCode(code).roomId, memberPk);
}
