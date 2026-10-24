import fs from "node:fs";

import { dlopen, FFIType, ptr } from "bun:ffi";

import { legacyPassword } from "./legacy-keys.ts";
import type { LegacyPassword } from "./legacy-store.ts";
import { keychainKey, readyMark, type StoreKey } from "./store-v2.ts";

export const KEY_FD_ENV = "KIWI_KEY_FD";

const MAX_LINE = 4096;

const O_CLOEXEC = process.platform === "darwin" ? 0x01000000 : 0o2000000;

const LIBC = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";

function unsetenv(name: string): void {
  const libc = dlopen(LIBC, { unsetenv: { args: [FFIType.ptr], returns: FFIType.i32 } });
  try {
    libc.symbols.unsetenv(ptr(Buffer.from(`${name}\0`, "utf8")));
  } finally {
    libc.close();
  }
}

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

function fdChannel(inherited: number): LineChannel {
  const fd = fs.openSync(`/dev/fd/${inherited}`, fs.constants.O_RDWR | O_CLOEXEC);
  fs.closeSync(inherited);
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
  const ok = (line: string, otherwise: string): void => {
    if (parseAnswer(ch.request(line)).kind !== "ok") throw new Error(otherwise);
  };
  return {
    get: async () => keyOrNone(ch.request("get")),
    set: async (value) => ok(`set ${toWire(value)}`, "the launcher didn't save the store key"),
    drop: async () => ok("drop", "the launcher didn't take back the store key"),
    finished: async () => {
      const a = parseAnswer(ch.request("finished"));
      if (a.kind === "key") throw new Error("the launcher gave a key where it should say whether the store key is marked ready");
      return a.kind === "ok";
    },
    finish: async (key) => ok(`finish ${readyMark(key)}`, "the launcher didn't mark the store key ready"),
  };
}

export const launcherLegacyPassword =
  (ch: LineChannel): LegacyPassword =>
  async (name) => {
    const key = keyOrNone(ch.request(`legacy ${name}`));
    return key === null ? [] : [key];
  };

export function keyFd(env: NodeJS.ProcessEnv): number | null {
  const raw = env[KEY_FD_ENV];
  if (raw === undefined) return null;
  if (!/^(?:[3-9]|[1-9]\d{1,3})$/.test(raw)) throw new Error(`${KEY_FD_ENV} isn't a file descriptor: ${JSON.stringify(raw)}`);
  return Number(raw);
}

export function launcherChannel(env: NodeJS.ProcessEnv = process.env): LineChannel | null {
  const fd = keyFd(env);
  Reflect.deleteProperty(env, KEY_FD_ENV);
  if (env === process.env) unsetenv(KEY_FD_ENV);
  return fd === null ? null : fdChannel(fd);
}

export function endSession(ch: LineChannel): void {
  try {
    parseAnswer(ch.request("done"));
  } finally {
    ch.close();
  }
}

export function keySources(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): KeySources {
  if (platform !== "darwin") return { key: keychainKey(), legacy: legacyPassword(platform), done: () => {} };
  const ch = launcherChannel(env);
  if (!ch) throw new Error("on a Mac, Channels gets its store key only from its signed launcher, and it wasn't started by it");
  return { key: launcherKey(ch), legacy: launcherLegacyPassword(ch), done: () => endSession(ch) };
}
