import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dlopen, FFIType, ptr } from "bun:ffi";

import { endSession, KEY_FD_ENV, launcherChannel, launcherKey, parseAnswer, type LineChannel } from "../src/launcher-key.ts";

export type ProbeStep = { ok: string | null } | { error: string };

export type ProbeReport = Record<string, ProbeStep>;

export const PROBE_PREFIX = "kiwi-keys-probe:";

async function step(fn: () => Promise<string | null>): Promise<ProbeStep> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function answer(ch: LineChannel, line: string): Promise<string | null> {
  const a = parseAnswer(ch.request(line));
  return Promise.resolve(a.kind === "key" ? a.value : a.kind);
}

function legacyName(): string {
  const plist = path.join(path.dirname(process.execPath), "..", "Info.plist");
  const names: unknown = JSON.parse(execFileSync("plutil", ["-extract", "KiwiLegacyNames", "json", "-o", "-", plist], { encoding: "utf8" }));
  return Array.isArray(names) && typeof names[0] === "string" ? names[0] : "";
}

function inherited(fd: number): string | null {
  try {
    fs.fstatSync(fd);
    return "open";
  } catch {
    // EBADF: the descriptor didn't come through, which is what the launcher should do.
    return null;
  }
}

function afterDone(other: number): string {
  try {
    fs.writeSync(other, "get\n");
    const buf = Buffer.alloc(256);
    const n = fs.readSync(other, buf, 0, buf.length, null);
    return n === 0 ? "nothing" : `answered: ${buf.toString("latin1", 0, n).trim()}`;
  } catch {
    // EPIPE or ECONNRESET: the launcher shut the socket, so nothing answers on any copy of it.
    return "nothing";
  }
}

const CHILD = `const fs = require("node:fs"); const open = []; for (let f = 3; f < 256; f++) { try { if (fs.fstatSync(f).isSocket()) open.push(f); } catch { /* not open, so not passed on */ } } console.log(JSON.stringify({ sockets: open, env: process.env.${KEY_FD_ENV} ?? null }));`;

const O_CLOEXEC = 0x01000000;
const F_GETFD = 1;
const FD_CLOEXEC = 1;

const libc = () =>
  dlopen("/usr/lib/libSystem.B.dylib", {
    fcntl: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    system: { args: [FFIType.ptr], returns: FFIType.i32 },
  });

function sockets(except: number): number[] {
  const found: number[] = [];
  for (let f = 3; f < 256; f++) {
    if (f === except) continue;
    try {
      if (fs.fstatSync(f).isSocket()) found.push(f);
    } catch {
      // Not open: nothing there to check.
    }
  }
  return found;
}

function channelCloexec(other: number): string {
  const c = libc();
  try {
    const open = sockets(other).map((fd) => ({ fd, flags: c.symbols.fcntl(fd, F_GETFD) }));
    const leaky = open.filter((o) => (o.flags & FD_CLOEXEC) === 0);
    return open.length === 0 ? "no socket" : leaky.length ? `missing on fd ${leaky.map((o) => o.fd).join(", ")}` : "set";
  } finally {
    c.close();
  }
}

function nativeChild(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-probe-"));
  const script = path.join(dir, "child.js");
  const out = path.join(dir, "out");
  fs.writeFileSync(script, CHILD);
  const c = libc();
  try {
    c.symbols.system(ptr(Buffer.from(`'${process.execPath}' '${script}' > '${out}' 2>&1\0`, "utf8")));
    return fs.readFileSync(out, "utf8").trim();
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function probe(): Promise<ProbeReport> {
  const passedOn = inherited(5);
  const other = fs.openSync("/dev/fd/3", fs.constants.O_RDWR | O_CLOEXEC);
  const ch = launcherChannel();
  if (!ch) return { channel: { error: "no key channel" } };
  const key = launcherKey(ch);
  const report: ProbeReport = {
    inherited: { ok: passedOn },
    fd3: { ok: inherited(3) },
    env: { ok: process.env[KEY_FD_ENV] ?? null },
    first: await step(() => key.get()),
  };
  const first = report["first"];
  if (first && "ok" in first && first.ok === null) {
    const made = randomBytes(32).toString("base64");
    report["set"] = await step(() => key.set(made).then(() => made));
  }
  report["get"] = await step(() => key.get());
  report["replace"] = await step(() => key.set(randomBytes(32).toString("base64")).then(() => "replaced"));
  report["legacy"] = await step(() => answer(ch, `legacy ${legacyName()}`));
  report["unlisted"] = await step(() => answer(ch, "legacy kiwi-desktop"));
  report["unknown"] = await step(() => answer(ch, "dump"));
  report["cloexec"] = { ok: channelCloexec(other) };
  report["native"] = { ok: nativeChild() };
  report["done"] = await step(async () => {
    endSession(ch);
    return "ended";
  });
  report["after"] = { ok: afterDone(other) };
  fs.closeSync(other);
  const child = spawnSync(process.execPath, ["-e", CHILD], { encoding: "utf8" });
  report["child"] = { ok: child.stdout.trim() || child.stderr.trim() };
  return report;
}

if (import.meta.main) {
  fs.writeSync(1, `${PROBE_PREFIX}${JSON.stringify(await probe())}\n`);
  process.exit(0);
}
