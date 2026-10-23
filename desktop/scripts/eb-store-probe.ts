import { launcherKeys } from "../src/launcher-channel-eb.ts";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ebDataDir, openEbStore, unmarkedNote } from "../src/store-eb.ts";

export type StoreProbe =
  | { kind: "open"; sealed: boolean; imported: string | null; unmarked: string | null; note: string | null; json: Record<string, unknown> | null }
  | { kind: "unreadable"; why: string };

export const STORE_PROBE_PREFIX = "kiwi-store-probe:";

export function storePlaces(id: string, channel: string, home: string = os.homedir()): { data: string; legacyHome: string } {
  const data = ebDataDir(id, channel, "darwin", home);
  return { data, legacyHome: path.join(data, "legacy-home") };
}

async function probe(): Promise<StoreProbe> {
  const plist = path.join(path.dirname(process.execPath), "..", "Info.plist");
  const id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", plist], { encoding: "utf8" }).trim();
  const version = JSON.parse(fs.readFileSync(path.join(path.dirname(process.execPath), "..", "Resources", "version.json"), "utf8")) as { channel?: unknown };
  const { data, legacyHome } = storePlaces(id, typeof version.channel === "string" ? version.channel : "");
  const opened = await openEbStore({ dir: data, keys: launcherKeys, home: legacyHome });
  if (opened.kind === "unreadable") return { kind: "unreadable", why: opened.why };
  const runs = opened.json?.["probeRuns"];
  opened.save(JSON.stringify({ ...opened.json, probeRuns: typeof runs === "number" ? runs + 1 : 1 }));
  return { kind: "open", sealed: opened.sealed, imported: opened.imported, unmarked: opened.unmarked, note: unmarkedNote(opened), json: opened.json };
}

if (import.meta.main) {
  fs.writeSync(1, `${STORE_PROBE_PREFIX}${JSON.stringify(await probe())}\n`);
  process.exit(0);
}
