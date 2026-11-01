// The main process's rules about what may load, open and be read, as plain functions, so they can
// be tested without an app.

import { cleanPersonalities } from "@kiwi/core/personalities.ts";
import type { Personality } from "@kiwi/core/personality.ts";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ChannelIdentityView, ComputerView, PendingItem, PersonView, PhoneView, PublicPerson, StoreSnapshot } from "./bridge.ts";
import { publicChannel } from "./seats.ts";

export { acceptSeat, mergeChannels, mergePublicChannels, migrateEntries, movedRelay, withAccess } from "./seats.ts";

/** `url`, if it may go to the system browser: http(s) only (never file:, javascript:, a custom scheme). */
export type ExternalUrl = string & { readonly checked: "http(s)" };

export function externalUrl(url: string): ExternalUrl | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? (u.href as ExternalUrl) : null;
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
 * The Content-Security-Policy for the app's page: the hosted app's (ui/public/_headers),
 * with the relay this app talks to, over HTTP and its WebSocket, as the only place to connect. Not
 * WorkOS: in the app, sign-in runs in main (the device flow), never in the page. No eval (only
 * WebAssembly compiles: the message renderer's parser is wasm), no inline script, nothing framed, no
 * form posts: script that got in some other way can't phone anywhere else.
 */
export function csp(relay: string): string {
  const origin = normalizeRelay(relay);
  const socket = origin ? origin.replace(/^http/, "ws") : null;
  const connect = ["'self'", ...(origin ? [origin, socket!] : [])].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "worker-src 'self'",
  ].join("; ");
}

export function publicPerson(p: PersonView): PublicPerson;
export function publicPerson(p: PersonView | null): PublicPerson | null;
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
  personalities?: Personality[];
  enrolled?: PublicPerson;
}

export function snapshotOf(s: StoredKeys): StoreSnapshot {
  return {
    relayUrl: s.relayUrl,
    person: publicPerson(s.person) ?? s.enrolled ?? null,
    channels: s.channels.map(publicChannel),
    computers: s.computers,
    phones: (s.phones ?? []).map((p) => ({ label: p.label, at: p.at, ...(p.channels ? { channels: p.channels } : {}) })),
    pending: s.pending,
    personalities: cleanPersonalities(s.personalities),
  };
}

export function publicComputer(c: ComputerView): ComputerView {
  return { label: c.label, os: c.os, machinePk: c.machinePk, machineXpk: c.machineXpk, personPk: c.personPk, at: c.at, ...(c.own ? { own: true } : {}) };
}

export function writePrivate(file: string, raw: Buffer, platform: NodeJS.Platform = process.platform): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform !== "win32") fs.chmodSync(dir, 0o700);
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      fs.writeFileSync(fd, raw);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (platform !== "win32") fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  if (platform === "win32") return;
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // The file itself is synced; a directory that can't be synced only risks the rename, not the data.
  }
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || "an error with no message";
