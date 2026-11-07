import { CATALOG_REPO, readCatalog, type Catalog, type CatalogEntry } from "@kiwi/core/node/mod-catalog.ts";
import { iconFromBytes } from "@kiwi/core/node/mod-icon.ts";
import fs from "node:fs";
import path from "node:path";

import type { CatalogMod, ModCatalog, ModIcon } from "./bridge.ts";
import { errorText } from "./guard.ts";
import { get, installPinned, RAW, rawUrl, type PinnedOptions } from "./mods-pinned.ts";

const BRANCH = "main";
const FRESH_MS = 10 * 60_000;
const INDEX_BYTES = 1_000_000;

const same = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join("\n") === [...b].sort().join("\n");

export function modsCatalog(o: PinnedOptions) {
  const request = o.request ?? fetch;
  const base = o.raw ?? RAW;
  let kept: (Catalog & { at: number }) | null = null;
  const icons = new Map<string, ModIcon | null>();

  async function load(fresh: boolean): Promise<Catalog> {
    if (!fresh && kept && Date.now() - kept.at < FRESH_MS) return kept;
    const text = await (await get(request, rawUrl(base, CATALOG_REPO, BRANCH, "mods.json"))).text();
    if (text.length > INDEX_BYTES) throw new Error("its index is over 1 MB");
    kept = { ...readCatalog(JSON.parse(text)), at: Date.now() };
    return kept;
  }

  async function iconOf(e: CatalogEntry): Promise<ModIcon | null> {
    if (!e.icon) return null;
    const key = `${e.name}@${e.commit}`;
    if (icons.has(key)) return icons.get(key) ?? null;
    let icon: ModIcon | null = null;
    try {
      const bytes = new Uint8Array(await (await get(request, rawUrl(base, CATALOG_REPO, e.commit, `${e.name}/${e.icon}`))).arrayBuffer());
      const read = iconFromBytes(e.icon, bytes);
      icon = read.ok ? { type: read.type, data: Buffer.from(read.bytes).toString("base64") } : null;
    } catch {
      // No icon this time: the catalog shows the mod's letter tile, and the next look tries again.
      return null;
    }
    icons.set(key, icon);
    return icon;
  }

  const have = (name: string): boolean => fs.lstatSync(path.join(o.folder, name), { throwIfNoEntry: false }) !== undefined;

  return {
    async list(fresh = false): Promise<ModCatalog> {
      let c: Catalog;
      try {
        c = await load(fresh);
      } catch (e) {
        return { mods: [], why: `Channels couldn't read the catalog: ${errorText(e)}` };
      }
      const mods = await Promise.all(
        c.entries.map(async (e): Promise<CatalogMod> => {
          const icon = await iconOf(e);
          return {
            name: e.name,
            does: e.does,
            needs: e.needs,
            commit: e.commit,
            source: `github.com/${CATALOG_REPO}/${e.name}`,
            installed: have(e.name),
            ...(e.author ? { author: e.author } : {}),
            ...(icon ? { icon } : {}),
          };
        }),
      );
      return { mods, why: null };
    },
    async install(name: string, needs: readonly string[]): Promise<void> {
      const e = (await load(false)).entries.find((x) => x.name === name);
      if (!e) throw new Error(`the catalog has no mod named ${name}`);
      if (!Array.isArray(needs) || !same(needs, e.needs)) throw new Error(`approve exactly what ${name} asks for`);
      if (have(name)) throw new Error(`you already have a mod named ${name}`);
      const placed = await installPinned({ name, repo: CATALOG_REPO, path: name, commit: e.commit, hash: e.hash, files: e.files }, o, "the copy the catalog vouches for", (m) => {
        if (!same(m.needs, e.needs)) throw new Error(`its mod.json asks for ${m.needs.join(", ") || "nothing"}, not what the catalog lists`);
        return m.needs;
      });
      if (placed === "there") throw new Error(`you already have a mod named ${name}`);
    },
  };
}

export type ModsCatalog = ReturnType<typeof modsCatalog>;
