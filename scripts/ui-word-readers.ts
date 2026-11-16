import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";

const ROOT = join(import.meta.dir, "..");
const EVENTS = "events.";
const LANG_DIRS = /^ui\/src\/i18n\/(?:en|ja|ko|pt-BR|zh-CN)(?:\/|\.ts$)/;
const NOT_PRODUCTION = /(?:\.test\.tsx?|\.d\.ts)$|^packages\/core\/src\/event-words\.ts$/;
const TYPE_ONLY = new Set(["TSTypeAnnotation", "TSTypeAliasDeclaration", "TSInterfaceDeclaration", "TSLiteralType", "TSTypeParameterInstantiation", "ImportDeclaration", "ExportAllDeclaration"]);

type Node = { type?: string; [k: string]: unknown };
export type Source = { file: string; code: string };
export type Readers = { literals: Set<string>; prefixes: Set<string> };

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null;

export function readersIn(sources: readonly Source[]): Readers {
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (!isNode(n) || TYPE_ONLY.has(String(n.type))) return;
    if ((n.type === "ExportNamedDeclaration" && n.source) || n.type === "ImportExpression") return;
    if (n.type === "Literal" && typeof n.value === "string") {
      literals.add(n.value);
      if (n.value.endsWith(".")) prefixes.add(n.value);
      return;
    }
    if (n.type === "TemplateLiteral") {
      const quasis = n.quasis as { value: { cooked: string | null } }[];
      const head = quasis[0]?.value.cooked ?? "";
      if ((n.expressions as unknown[]).length === 0) literals.add(head);
      else if (head.includes(".")) prefixes.add(head);
    }
    for (const [k, v] of Object.entries(n)) if (k !== "parent") walk(v);
  };
  for (const s of sources) {
    const parsed = parseSync(s.file, s.code);
    if (parsed.errors.length) throw new Error(`${s.file} doesn't parse, so its lookups can't be read: ${parsed.errors[0]?.message}`);
    walk(parsed.program);
  }
  prefixes.delete(EVENTS);
  return { literals, prefixes };
}

const covered = (name: string, r: Readers): boolean => r.literals.has(name) || [...r.prefixes].some((p) => name.startsWith(p));

export function unread(keys: readonly string[], r: Readers): string[] {
  return keys.filter((k) => !(covered(k, r) || (k.startsWith(EVENTS) && covered(k.slice(EVENTS.length), r))));
}

export function keysIn(file: string, code: string): string[] {
  const keys: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (!isNode(n)) return;
    if (n.type === "ObjectExpression") {
      for (const p of n.properties as Node[]) {
        const key = p.key as Node | undefined;
        if (p.type === "Property" && key?.type === "Literal" && typeof key.value === "string") keys.push(key.value);
        else if (p.type === "Property" && key?.type === "Identifier" && !p.computed && isNode(p.value) && (p.value as Node).type !== "ObjectExpression") keys.push(String(key.name));
      }
      return;
    }
    for (const [k, v] of Object.entries(n)) if (k !== "parent") walk(v);
  };
  walk(parseSync(file, code).program);
  return keys;
}

function filesUnder(globs: readonly string[]): string[] {
  return globs.flatMap((g) => [...new Glob(g).scanSync({ cwd: ROOT })]).sort();
}

export function catalogKeys(): string[] {
  const en = filesUnder(["ui/src/i18n/en.ts", "ui/src/i18n/en/*.ts"]).filter((f) => !/\/(?:all|events)\.ts$/.test(f));
  const ui = en.flatMap((f) => keysIn(f, readFileSync(join(ROOT, f), "utf8")).filter((k) => k.includes(".")));
  const events = keysIn("event-words.ts", readFileSync(join(ROOT, "packages/core/src/event-words.ts"), "utf8")).map((k) => `${EVENTS}${k}`);
  return [...new Set([...ui, ...events])];
}

export const isProduction = (path: string): boolean => !LANG_DIRS.test(path) && !NOT_PRODUCTION.test(path);

export function productionSources(): Source[] {
  return filesUnder(["ui/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts", "src/**/*.ts"])
    .filter(isProduction)
    .map((f) => ({ file: f, code: readFileSync(join(ROOT, f), "utf8") }));
}

if (import.meta.main) {
  const keys = catalogKeys();
  const left = unread(keys, readersIn(productionSources()));
  if (left.length) {
    console.error(
      `${left.length} UI word key${left.length === 1 ? " has" : "s have"} no reader in production code (a catalog or a test doesn't count). Remove each from all five catalogs, or look it up:`,
    );
    for (const k of left) console.error(`  ${k}`);
    process.exit(1);
  }
  console.log(`ui words: all ${keys.length} keys have a production reader (${relative(ROOT, join(ROOT, "ui/src/i18n"))})`);
}
