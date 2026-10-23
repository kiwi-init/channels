import fs from "node:fs";

import { legacyPassword } from "./legacy-keys.ts";
import type { LegacyPassword } from "./legacy-store.ts";
import { keychainKey, type StoreKey } from "./store-v2.ts";

export const KEY_FD_ENV = "KIWI_KEY_FD";

const MAX_LINE = 4096;

export interface LineChannel {
  request(line: string): string;
  close(): void;
}

export interface KeySources {
  key: StoreKey;
  legacy: LegacyPassword;
  done(): void;
}

type Answer = { kind: "key"; value: string } | { kind: "none" } | { kind: "ok" };

function fdChannel(fd: number): LineChannel {
  let pending = "";
  let open = true;
  const chunk = Buffer.alloc(MAX_LINE);
  return {
    request(line) {
      if (!open) throw new Error("the launcher's key channel is closed");
      fs.writeSync(fd, `${line}\n`);
      while (!pending.includes("\n")) {
        if (pending.length > MAX_LINE) throw new Error("the launcher's answer is too long");
        const n = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (n === 0) throw new Error("the launcher closed its key channel");
        pending += chunk.toString("latin1", 0, n);
      }
      const at = pending.indexOf("\n");
      const answer = pending.slice(0, at);
      pending = pending.slice(at + 1);
      return answer;
    },
    close() {
      if (!open) return;
      open = false;
      fs.closeSync(fd);
    },
  };
}

const toWire = (value: string): string => Buffer.from(value, "utf8").toString("base64");

function fromWire(b64: string): string {
  const raw = Buffer.from(b64, "base64");
  if (raw.toString("base64") !== b64) throw new Error("the launcher's answer isn't base64");
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
}

export function parseAnswer(line: string): Answer {
  if (line === "none") return { kind: "none" };
  if (line === "ok") return { kind: "ok" };
  if (line.startsWith("key ")) return { kind: "key", value: fromWire(line.slice(4)) };
  if (line.startsWith("fail ")) throw new Error(line.slice(5));
  throw new Error(`the launcher gave an answer Channels doesn't know: ${JSON.stringify(line.slice(0, 40))}`);
}

function keyOrNone(line: string): string | null {
  const a = parseAnswer(line);
  if (a.kind === "ok") throw new Error("the launcher said ok where it should give a key");
  return a.kind === "key" ? a.value : null;
}

export function launcherKey(ch: LineChannel): StoreKey {
  return {
    get: async () => keyOrNone(ch.request("get")),
    set: async (value) => {
      if (parseAnswer(ch.request(`set ${toWire(value)}`)).kind !== "ok") throw new Error("the launcher didn't save the store key");
    },
  };
}

export const launcherLegacyPassword =
  (ch: LineChannel): LegacyPassword =>
  async (name) =>
    keyOrNone(ch.request(`legacy ${name}`));

export function launcherChannel(env: NodeJS.ProcessEnv = process.env): LineChannel | null {
  const raw = env[KEY_FD_ENV];
  if (raw === undefined) return null;
  if (!/^(?:[3-9]|[1-9]\d{1,3})$/.test(raw)) throw new Error(`${KEY_FD_ENV} isn't a file descriptor: ${JSON.stringify(raw)}`);
  return fdChannel(Number(raw));
}

export function keySources(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): KeySources {
  if (platform !== "darwin") return { key: keychainKey(), legacy: legacyPassword(platform), done: () => {} };
  const ch = launcherChannel(env);
  if (!ch) throw new Error("on a Mac, Channels gets its store key only from its signed launcher, and it wasn't started by it");
  return { key: launcherKey(ch), legacy: launcherLegacyPassword(ch), done: () => ch.close() };
}
