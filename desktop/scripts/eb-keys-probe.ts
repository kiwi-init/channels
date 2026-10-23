import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { launcherChannel, launcherKey, parseAnswer, type LineChannel } from "../src/launcher-key.ts";

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

async function probe(): Promise<ProbeReport> {
  const ch = launcherChannel();
  if (!ch) return { channel: { error: "no key channel" } };
  const key = launcherKey(ch);
  const report: ProbeReport = { first: await step(() => key.get()) };
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
  ch.close();
  return report;
}

if (import.meta.main) {
  fs.writeSync(1, `${PROBE_PREFIX}${JSON.stringify(await probe())}\n`);
  process.exit(0);
}
