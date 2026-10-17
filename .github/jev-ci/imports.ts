import { dirname, join, normalize } from "node:path";
import { matches } from "./config.ts";
import { showMany, type Tree } from "./git.ts";

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const PACKAGE = /^packages\/[^/]+\/package\.json$/;
const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };

type Workspace = { name: string; dir: string; exports: [string, string][] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function workspaces(repo: string, rev: string, tree: Tree): Workspace[] {
  const out: Workspace[] = [];
  for (const [path, text] of showMany(
    repo,
    rev,
    [...tree.keys()].filter((p) => PACKAGE.test(p)),
  )) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isRecord(pkg) || typeof pkg["name"] !== "string") continue;
    const raw = pkg["exports"];
    const exports: [string, string][] = isRecord(raw)
      ? Object.entries(raw).flatMap(([k, v]): [string, string][] => (typeof v === "string" ? [[k, v]] : []))
      : typeof raw === "string"
        ? [[".", raw]]
        : [];
    out.push({ name: pkg["name"], dir: dirname(path), exports });
  }
  return out;
}

function fromWorkspace(spec: string, list: Workspace[]): string | undefined {
  for (const w of list) {
    if (spec !== w.name && !spec.startsWith(`${w.name}/`)) continue;
    const sub = `.${spec.slice(w.name.length)}`;
    for (const [key, target] of w.exports) {
      const star = key.indexOf("*");
      if (star < 0) {
        if (key === sub) return normalize(join(w.dir, target));
        continue;
      }
      const head = key.slice(0, star);
      const tail = key.slice(star + 1);
      if (sub.length >= head.length + tail.length && sub.startsWith(head) && sub.endsWith(tail)) return normalize(join(w.dir, target.replace("*", sub.slice(head.length, sub.length - tail.length))));
    }
    return undefined;
  }
  return undefined;
}

function resolve(from: string, spec: string, tree: Tree, list: Workspace[]): string | undefined {
  let base: string | undefined;
  if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else if (spec.startsWith("@/") && from.startsWith("web/")) base = `web/src/${spec.slice(2)}`;
  else base = fromWorkspace(spec, list);
  if (base === undefined) return undefined;
  const stems = base.endsWith(".js") ? [base, base.slice(0, -3)] : [base];
  for (const stem of stems) for (const s of SUFFIXES) if (tree.has(stem + s)) return stem + s;
  return undefined;
}

function specifiers(path: string, text: string): string[] {
  const t = path.endsWith(".tsx") || path.endsWith(".jsx") ? transpilers.tsx : transpilers.ts;
  try {
    return t.scanImports(text).map((i) => i.path);
  } catch {
    return [];
  }
}

export function importClosure(repo: string, rev: string, tree: Tree, entries: string[]): Set<string> {
  const list = workspaces(repo, rev, tree);
  const seen = new Set<string>();
  let layer = [...tree.keys()].filter((p) => matches(entries, p));
  while (layer.length) {
    for (const p of layer) seen.add(p);
    const texts = showMany(
      repo,
      rev,
      layer.filter((p) => SOURCE.test(p)),
    );
    const next = new Set<string>();
    for (const [path, text] of texts)
      for (const spec of specifiers(path, text)) {
        const target = resolve(path, spec, tree, list);
        if (target && !seen.has(target)) next.add(target);
      }
    layer = [...next];
  }
  return seen;
}
