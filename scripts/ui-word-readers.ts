import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";

const ROOT = join(import.meta.dir, "..");
const EVENTS = "events.";
const LANG_DIRS = /^ui\/src\/i18n\/(?:en|ja|ko|pt-BR|zh-CN)(?:\/|\.ts$)/;
const NOT_PRODUCTION = /(?:\.test\.tsx?|\.d\.ts)$|^packages\/core\/src\/event-words\.ts$/;
const TYPE_ONLY = new Set(["TSTypeAnnotation", "TSTypeAliasDeclaration", "TSInterfaceDeclaration", "TSLiteralType", "TSTypeParameterInstantiation", "ImportDeclaration", "ExportAllDeclaration"]);

const LOOKUPS = new Set(["t", "say"]);
const KEY_TYPES = new Set(["Key", "EventKey"]);
const NOT_A_READ = new Set(["ExpressionStatement", "NewExpression", "SwitchCase", "ThrowStatement", "TaggedTemplateExpression"]);
const WILD = Symbol("wild");

type Node = { type?: string; [k: string]: unknown };
type Part = string | typeof WILD;
type Place = "lookup" | "data" | "none";
export type Source = { file: string; code: string };
export type Readers = { literals: Set<string>; patterns: RegExp[] };

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null;
const isText = (n: Node): n is Node & { value: string } => n.type === "Literal" && typeof n.value === "string";
const isConcat = (n: Node): boolean => n.type === "BinaryExpression" && n.operator === "+";

function children(n: Node, visit: (child: unknown, field: string) => void): void {
  for (const [field, v] of Object.entries(n)) if (field !== "parent") visit(v, field);
}

function parsedAll(sources: readonly Source[]): { file: string; program: Node }[] {
  return sources.map((s) => {
    const parsed = parseSync(s.file, s.code);
    if (parsed.errors.length) throw new Error(`${s.file} doesn't parse, so its lookups can't be read: ${parsed.errors[0]?.message}`);
    return { file: s.file, program: parsed.program as unknown as Node };
  });
}

function takesKey(fn: Node): boolean {
  return ((fn.params ?? []) as Node[]).some((p) => {
    const annotation = ((p.type === "AssignmentPattern" ? (p.left as Node) : p)?.typeAnnotation as Node | undefined)?.typeAnnotation as Node | undefined;
    const name = ((annotation?.typeName as Node | undefined)?.name ?? "") as string;
    return annotation?.type === "TSTypeReference" && KEY_TYPES.has(name);
  });
}

function lookupsIn(programs: readonly { program: Node }[]): Set<string> {
  const names = new Set(LOOKUPS);
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isNode(n)) return;
    if (n.type === "FunctionDeclaration" && takesKey(n)) names.add(String((n.id as Node | null)?.name ?? ""));
    if (n.type === "VariableDeclarator" && isNode(n.init) && /FunctionExpression$/.test(String(n.init.type)) && takesKey(n.init)) names.add(String((n.id as Node).name ?? ""));
    children(n, walk);
  };
  for (const p of programs) walk(p.program);
  return names;
}

function constsIn(program: Node): Map<string, string> {
  const consts = new Map<string, string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isNode(n)) return;
    if (n.type === "VariableDeclaration" && n.kind === "const")
      for (const d of n.declarations as Node[]) {
        const init = d.init as Node | null;
        const id = d.id as Node;
        if (id.type === "Identifier" && init && isText(init)) consts.set(String(id.name), init.value);
      }
    children(n, walk);
  };
  walk(program);
  return consts;
}

function partsOf(n: Node, consts: ReadonlyMap<string, string>): Part[] {
  if (isText(n)) return [n.value];
  if (n.type === "Identifier" && consts.has(String(n.name))) return [consts.get(String(n.name))!];
  if (isConcat(n)) return [...partsOf(n.left as Node, consts), ...partsOf(n.right as Node, consts)];
  if (n.type === "TemplateLiteral") {
    const quasis = n.quasis as { value: { cooked: string | null } }[];
    const exprs = n.expressions as Node[];
    return quasis.flatMap((q, i) => [q.value.cooked ?? "", ...(exprs[i] ? partsOf(exprs[i], consts) : [])]);
  }
  return [WILD];
}

function placeOf(parent: Node | null, field: string, lookups: ReadonlySet<string>): Place {
  if (!parent || NOT_A_READ.has(String(parent.type))) return "none";
  if (parent.type === "CallExpression") return field === "arguments" && lookups.has(String((parent.callee as Node).name ?? "")) ? "lookup" : "none";
  if (parent.type === "BinaryExpression") return "none";
  if (parent.type === "Property" && field === "key") return "none";
  return "data";
}

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalized(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const last = out.at(-1);
    if (p === "") continue;
    if (typeof p === "string" && typeof last === "string") out[out.length - 1] = last + p;
    else if (!(p === WILD && last === WILD)) out.push(p);
  }
  return out;
}

function keyShaped(parts: readonly Part[]): boolean {
  const texts = parts.filter((p): p is string => typeof p === "string");
  return texts.every((s) => /^[\w.-]+$/.test(s)) && texts.some((s) => /[a-z]/i.test(s)) && texts.join("").includes(".");
}

export function readersIn(sources: readonly Source[]): Readers {
  const literals = new Set<string>();
  const patterns: RegExp[] = [];
  const programs = parsedAll(sources);
  const lookups = lookupsIn(programs);
  const read = (raw: Part[], place: Place): void => {
    if (place === "none") return;
    const parts = normalized(raw);
    if (parts.every((p) => typeof p === "string")) return void literals.add(parts.join(""));
    const bridge = parts.length === 2 && parts[0] === EVENTS && parts[1] === WILD;
    if (bridge || (place === "data" && !keyShaped(parts))) return;
    patterns.push(new RegExp(`^${parts.map((p) => (p === WILD ? ".*" : escaped(p))).join("")}$`));
  };
  for (const { program } of programs) {
    const consts = constsIn(program);
    const walk = (n: unknown, parent: Node | null, field: string): void => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, parent, field));
      if (!isNode(n) || TYPE_ONLY.has(String(n.type))) return;
      if ((n.type === "ExportNamedDeclaration" && n.source) || n.type === "ImportExpression") return;
      const inConcat = parent !== null && isConcat(parent);
      if (isText(n) || n.type === "TemplateLiteral" || (isConcat(n) && !inConcat)) read(partsOf(n, consts), inConcat ? "none" : placeOf(parent, field, lookups));
      children(n, (child, f) => walk(child, n, f));
    };
    walk(program, null, "");
  }
  return { literals, patterns };
}

const covered = (name: string, r: Readers): boolean => r.literals.has(name) || r.patterns.some((p) => p.test(name));

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
