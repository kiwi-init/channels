import { CATALOG_REPO, readCatalog, type Catalog, type CatalogEntry } from "@kiwi/core/node/mod-catalog.ts";
import { iconFromBytes } from "@kiwi/core/node/mod-icon.ts";
import fs from "node:fs";
import path from "node:path";

import type { CatalogMod, ModCatalog, ModIcon, ModShot, ModStorePage } from "./bridge.ts";
import { errorText } from "./guard.ts";
import { get, installPinned, RAW, rawUrl, type PinnedOptions } from "./mods-pinned.ts";

const BRANCH = "main";
const FRESH_MS = 10 * 60_000;
const INDEX_BYTES = 1_000_000;

const SHOTS = 6;
const SHOT_BYTES = 1_000_000;
const README_BYTES = 64_000;
const MANIFEST_BYTES = 64_000;
const README = /^readme(\.md|\.markdown)?$/i;
const SHOT_TYPES: Record<string, ModShot["type"]> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function shotType(bytes: Uint8Array): ModShot["type"] | null {
  const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

function versionOf(manifest: Uint8Array | null): string | null {
  if (!manifest) return null;
  try {
    const v = (JSON.parse(new TextDecoder().decode(manifest)) as { version?: unknown } | null)?.version;
    return typeof v === "string" && v.length <= 40 ? v : null;
  } catch {
    // A mod.json that isn't JSON wouldn't install either: the page just leaves its version out.
    return null;
  }
}

const same = (a: readonly string[], b: readonly string[]): boolean => [...a].sort().join("\n") === [...b].sort().join("\n");

export function modsCatalog(o: PinnedOptions) {
  const request = o.request ?? fetch;
  const base = o.raw ?? RAW;
  let kept: (Catalog & { at: number }) | null = null;
  const icons = new Map<string, ModIcon | null>();
  const pages = new Map<string, ModStorePage>();
  const fetched = async (e: CatalogEntry, rel: string): Promise<Uint8Array> => new Uint8Array(await (await get(request, rawUrl(base, CATALOG_REPO, e.commit, `${e.name}/${rel}`))).arrayBuffer());

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
    let icon: ModIcon | null;
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
            ...(e.category ? { category: e.category } : {}),
            ...(icon ? { icon } : {}),
          };
        }),
      );
      return { mods, why: null };
    },
    async page(name: string): Promise<ModStorePage> {
      const e = (await load(false)).entries.find((x) => x.name === name);
      if (!e) throw new Error(`the catalog has no mod named ${name}`);
      const key = `${e.name}@${e.commit}`;
      const had = pages.get(key);
      if (had) return had;
      const skipped: { name: string; why: string }[] = [];
      let missed = false;
      const read = async (rel: string, cap: number): Promise<Uint8Array | null> => {
        try {
          const bytes = await fetched(e, rel);
          if (bytes.byteLength <= cap) return bytes;
          skipped.push({ name: rel, why: `it's over ${cap >= 1_000_000 ? `${cap / 1_000_000} MB` : `${cap / 1000} KB`}` });
        } catch (err) {
          // A file the pin lists but raw.githubusercontent doesn't give back: the page shows without it, and the next look tries again.
          missed = true;
          skipped.push({ name: rel, why: `Channels couldn't fetch it: ${errorText(err)}` });
        }
        return null;
      };
      const readmeFile = e.files.find((f) => README.test(f));
      const media = e.files.filter((f) => /^media\/[^/]+$/.test(f) && !!SHOT_TYPES[f.slice(f.lastIndexOf(".") + 1).toLowerCase()]).sort();
      for (const f of media.slice(SHOTS)) skipped.push({ name: f, why: `a page shows its first ${SHOTS} screenshots` });
      const [manifest, readme, ...pictures] = await Promise.all([
        read("mod.json", MANIFEST_BYTES),
        readmeFile ? read(readmeFile, README_BYTES) : null,
        ...media.slice(0, SHOTS).map((f) => read(f, SHOT_BYTES)),
      ]);
      const version = versionOf(manifest);
      const shots: ModShot[] = [];
      pictures.forEach((bytes, i) => {
        const rel = media[i]!;
        if (!bytes) return;
        const said = SHOT_TYPES[rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()];
        const type = shotType(bytes);
        if (!type || type !== said) skipped.push({ name: rel, why: `it isn't the ${said?.slice(6).toUpperCase() ?? "picture"} its name says` });
        else shots.push({ name: rel, type, data: Buffer.from(bytes).toString("base64") });
      });
      skipped.sort((a, b) => a.name.localeCompare(b.name));
      const page: ModStorePage = { name, version, readme: readme ? new TextDecoder().decode(readme) : null, shots, skipped };
      if (!missed) pages.set(key, page);
      return page;
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
