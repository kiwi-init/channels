import { copiesIn } from "@kiwi/core/node/mod-folder.ts";
import fs from "node:fs";
import path from "node:path";

import type { ModView } from "./bridge.ts";
import { errorText, writePrivate } from "./guard.ts";
import { installPinned, sourceOf, type Pinned, type PinnedOptions } from "./mods-pinned.ts";

export const DEFAULT_MODS: readonly Pinned[] = [
  {
    name: "github",
    repo: "kiwi-init/mods",
    path: "github",
    commit: "fef9c2d6fc23f8cce1d0986541362457e3f7e7d7",
    hash: "124adf9c7a7f821bbd5a9b353bd897d16f5763b822fc72cfb305474526c7f19a",
    files: ["github.css", "groups.ts", "health.ts", "index.tsx", "mod.json", "panel.tsx", "parts.tsx", "types.ts", "view.tsx"],
  },
  {
    name: "afk",
    repo: "kiwi-init/mods",
    path: "afk",
    commit: "87658ac6279173a5eb6ffc517ac67cd3cf61a03e",
    hash: "bbbf0751276dde74924832f59d1e1d2215a68491a1af6750b2e8edf699d12333",
    files: ["afk.css", "afk.tsx", "icon.svg", "index.tsx", "mod.json", "settle.tsx"],
  },
];

const RENAMED: Readonly<Record<string, string>> = { calm: "afk" };

export interface DefaultsOptions extends PinnedOptions {
  record: string;
  pins?: readonly Pinned[];
}

function readRecord(file: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    const done = raw && typeof raw === "object" ? (raw as { installed?: unknown }).installed : null;
    return done && typeof done === "object" ? Object.fromEntries(Object.entries(done).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
  } catch {
    // Nothing installed by default yet.
    return {};
  }
}

function readJson(file: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    // No file yet: nothing to carry.
    return {};
  }
}

const table = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function retireRenamed(o: DefaultsOptions, pins: readonly Pinned[]): Map<string, unknown> {
  const carried = new Map<string, unknown>();
  const record = readRecord(o.record);
  for (const [was, now] of Object.entries(RENAMED)) {
    if (!record[was] || record[was] === "theirs" || !pins.some((p) => p.name === now)) continue;
    const approvals = readJson(o.approvals);
    const values = table(approvals["values"]);
    const set = table(values[was])["set"];
    if (set) carried.set(now, set);
    for (const key of ["approved", "off", "values"]) delete table(approvals[key])[was];
    if (Object.keys(approvals).length) writePrivate(o.approvals, Buffer.from(`${JSON.stringify(approvals, null, 2)}\n`));
    fs.rmSync(path.join(o.folder, was), { recursive: true, force: true });
    const kept = readRecord(o.record);
    delete kept[was];
    writePrivate(o.record, Buffer.from(`${JSON.stringify({ installed: kept }, null, 2)}\n`));
  }
  return carried;
}

function carrySettings(o: DefaultsOptions, pin: Pinned, set: unknown): void {
  const approvals = readJson(o.approvals);
  const values = table(approvals["values"]);
  values[pin.name] = { source: sourceOf(pin), set, rev: 1 };
  writePrivate(o.approvals, Buffer.from(`${JSON.stringify({ ...approvals, values }, null, 2)}\n`));
}

async function installOne(pin: Pinned, o: DefaultsOptions): Promise<void> {
  await installPinned(pin, o, "the copy this app was built with", (manifest) => manifest.needs);
}

/** Installs the mods that come with the app, once each, already approved; returns the ones that failed, as mods that are off and say why. */
export async function installDefaults(o: DefaultsOptions): Promise<ModView[]> {
  const failed: ModView[] = [];
  const pins = o.pins ?? DEFAULT_MODS;
  const carried = retireRenamed(o, pins);
  for (const pin of pins) {
    const record = readRecord(o.record);
    if (record[pin.name]) continue;
    const there = fs.lstatSync(path.join(o.folder, pin.name), { throwIfNoEntry: false }) !== undefined || copiesIn(o.folder)[pin.name] !== undefined;
    try {
      if (!there) await installOne(pin, o);
      if (!there && carried.has(pin.name)) carrySettings(o, pin, carried.get(pin.name));
      writePrivate(o.record, Buffer.from(`${JSON.stringify({ installed: { ...readRecord(o.record), [pin.name]: there ? "theirs" : pin.commit } }, null, 2)}\n`));
    } catch (e) {
      failed.push({
        name: pin.name,
        version: null,
        source: sourceOf(pin),
        needs: [],
        approved: [],
        state: "off",
        why: `it couldn't be installed: ${errorText(e)}. The app tries again when it starts`,
      });
    }
  }
  return failed;
}
