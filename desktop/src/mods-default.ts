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
];

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

async function installOne(pin: Pinned, o: DefaultsOptions): Promise<void> {
  await installPinned(pin, o, "the copy this app was built with", (manifest) => manifest.needs);
}

/** Installs the mods that come with the app, once each, already approved; returns the ones that failed, as mods that are off and say why. */
export async function installDefaults(o: DefaultsOptions): Promise<ModView[]> {
  const failed: ModView[] = [];
  for (const pin of o.pins ?? DEFAULT_MODS) {
    const record = readRecord(o.record);
    if (record[pin.name]) continue;
    const there = fs.lstatSync(path.join(o.folder, pin.name), { throwIfNoEntry: false }) !== undefined || copiesIn(o.folder)[pin.name] !== undefined;
    try {
      if (!there) await installOne(pin, o);
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
