export const CATALOG_REPO = "kiwi-init/mods";

export interface CatalogEntry {
  name: string;
  does: string;
  needs: string[];
  commit: string;
  hash: string;
  files: string[];
  icon?: string;
  author?: string;
}

export interface Catalog {
  entries: CatalogEntry[];
  skipped: { name: string; why: string }[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const ICON = /\.(?:svg|png)$/i;
const DOES_CHARS = 200;
const MAX_FILES = 200;
const MAX_ENTRIES = 500;

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneLine = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null);
const plainPath = (p: unknown): p is string => typeof p === "string" && p.length <= 200 && p.split("/").every((part) => !!part && part !== "." && part !== "..") && !p.includes("\\");

function entryOf(raw: unknown): { ok: true; entry: CatalogEntry } | { ok: false; name: string; why: string } {
  const m = record(raw);
  const name = typeof m["name"] === "string" ? m["name"] : "";
  const fail = (why: string) => ({ ok: false as const, name: name || "?", why });
  if (!NAME.test(name)) return fail("its name isn't a mod name");
  const does = oneLine(m["does"], DOES_CHARS);
  if (!does) return fail(`it needs a "does" line of up to ${DOES_CHARS} characters`);
  const needs = m["needs"];
  if (!Array.isArray(needs) || !needs.every((n) => typeof n === "string" && n.length > 0 && n.length <= 200)) return fail("its needs aren't a list of names");
  const commit = m["commit"];
  const hash = m["hash"];
  if (typeof commit !== "string" || !COMMIT.test(commit) || typeof hash !== "string" || !HASH.test(hash)) return fail("it isn't pinned to a commit and a folder hash yet");
  const files = m["files"];
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES || !files.every(plainPath) || new Set(files).size !== files.length)
    return fail(`its files aren't a list of up to ${MAX_FILES} paths in its folder`);
  if (!files.includes("mod.json")) return fail("its files don't include mod.json");
  const icon = m["icon"];
  if (icon !== undefined && (typeof icon !== "string" || !ICON.test(icon) || !files.includes(icon))) return fail("its icon isn't one of its .svg or .png files");
  const author = m["author"] === undefined ? undefined : oneLine(m["author"], 100);
  if (author === null) return fail("its author isn't a name on one line");
  return { ok: true, entry: { name, does, needs: [...needs], commit, hash, files: [...files], ...(icon ? { icon } : {}), ...(author ? { author } : {}) } };
}

export function readCatalog(raw: unknown): Catalog {
  const list = Array.isArray(record(raw)["mods"]) ? (record(raw)["mods"] as unknown[]).slice(0, MAX_ENTRIES) : [];
  const out: Catalog = { entries: [], skipped: [] };
  for (const item of list) {
    const r = entryOf(item);
    if (!r.ok) out.skipped.push({ name: r.name, why: r.why });
    else if (out.entries.some((e) => e.name === r.entry.name)) out.skipped.push({ name: r.entry.name, why: "the catalog lists it twice" });
    else out.entries.push(r.entry);
  }
  return out;
}
