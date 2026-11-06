import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function folderHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel)).sort()) {
      const path = rel ? `${rel}/${entry}` : entry;
      const st = lstatSync(join(dir, path));
      if (st.isDirectory()) walk(path);
      else hash.update(`${path}\0${st.isSymbolicLink() ? `-> ${readlinkSync(join(dir, path))}` : readFileSync(join(dir, path)).toString("base64")}\0`);
    }
  };
  walk("");
  return hash.digest("hex");
}

export interface ModCopy {
  source: string;
  url: string;
  path: string;
  ref: string | null;
  commit: string;
  hash: string;
  added?: string;
}

const COPIES = ".sources.json";

export function copiesIn(modsDir: string): Record<string, ModCopy> {
  try {
    const raw = JSON.parse(readFileSync(join(modsDir, COPIES), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, ModCopy>) : {};
  } catch {
    // No copied mods yet, or a file that isn't ours: every folder reads as local.
    return {};
  }
}

export function keepCopyIn(modsDir: string, name: string, copy: ModCopy | null): void {
  const all = copiesIn(modsDir);
  if (copy) all[name] = copy;
  else delete all[name];
  writeFileSync(join(modsDir, COPIES), `${JSON.stringify(all, null, 2)}\n`);
}
