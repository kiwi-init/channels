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

function boundNames(pattern: unknown, out: string[] = []): string[] {
  if (!isNode(pattern)) return out;
  if (pattern.type === "Identifier") out.push(String(pattern.name));
  else if (pattern.type === "AssignmentPattern") boundNames(pattern.left, out);
  else if (pattern.type === "RestElement") boundNames(pattern.argument, out);
  else if (pattern.type === "ArrayPattern") for (const e of pattern.elements as unknown[]) boundNames(e, out);
  else if (pattern.type === "ObjectPattern") for (const p of pattern.properties as Node[]) boundNames(p.type === "RestElement" ? p : p.value, out);
  return out;
}

function bindingCounts(program: Node): Map<string, number> {
  const counts = new Map<string, number>();
  const bind = (names: string[]) => names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isNode(n)) return;
    if (n.type === "VariableDeclarator") bind(boundNames(n.id));
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(String(n.type))) {
      bind(((n.params ?? []) as unknown[]).flatMap((p) => boundNames(p)));
      if (isNode(n.id)) bind(boundNames(n.id));
    }
    if (n.type === "ClassDeclaration" && isNode(n.id)) bind(boundNames(n.id));
    if (n.type === "CatchClause") bind(boundNames(n.param));
    if (n.type === "ImportDeclaration") bind(((n.specifiers ?? []) as Node[]).flatMap((s) => boundNames(s.local)));
    children(n, walk);
  };
  walk(program);
  return counts;
}

function constsIn(program: Node): Map<string, string> {
  const once = bindingCounts(program);
  const consts = new Map<string, string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isNode(n)) return;
    if (n.type === "VariableDeclaration" && n.kind === "const")
      for (const d of n.declarations as Node[]) {
        const init = d.init as Node | null;
        const id = d.id as Node;
        if (id.type === "Identifier" && init && isText(init) && once.get(String(id.name)) === 1) consts.set(String(id.name), init.value);
      }
    children(n, walk);
  };
  walk(program);
  return consts;
}

function namesIn(n: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(n)) {
    for (const x of n) namesIn(x, out);
    return out;
  }
  if (!isNode(n) || TYPE_ONLY.has(String(n.type))) return out;
  if (n.type === "Identifier") out.add(String(n.name));
  for (const [field, v] of Object.entries(n)) {
    if (field === "parent" || field === "typeAnnotation" || field === "returnType") continue;
    if ((n.type === "Property" && field === "key" && !n.computed) || (/MemberExpression$/.test(String(n.type)) && field === "property" && !n.computed)) continue;
    namesIn(v, out);
  }
  return out;
}

const isFunction = (n: Node) => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(String(n.type));

const keyTypes = new Set(KEY_TYPES);

function keyTyped(annotation: unknown): boolean {
  if (!isNode(annotation)) return false;
  if (annotation.type === "TSTypeReference" && keyTypes.has(String((annotation.typeName as Node | undefined)?.name ?? ""))) return true;
  return Object.entries(annotation).some(([field, v]) => field !== "parent" && (Array.isArray(v) ? v.some(keyTyped) : keyTyped(v)));
}

function learnKeyTypes(programs: readonly { program: Node }[]): void {
  keyTypes.clear();
  for (const k of KEY_TYPES) keyTypes.add(k);
  const shapes: { name: string; body: unknown }[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isNode(n)) return;
    if (n.type === "TSInterfaceDeclaration" || n.type === "TSTypeAliasDeclaration")
      shapes.push({ name: String((n.id as Node).name), body: n.type === "TSInterfaceDeclaration" ? n.body : n.typeAnnotation });
    children(n, walk);
  };
  for (const p of programs) walk(p.program);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of shapes) if (!keyTypes.has(s.name) && keyTyped(s.body)) grew = !!keyTypes.add(s.name);
  }
}

type Flow = { fed: Set<string>; imports: Map<string, string> };

function flowIn(program: Node, lookups: ReadonlySet<string>, fedElsewhere: ReadonlySet<string>): Flow {
  const deps = new Map<string, Set<string>>();
  const fed = new Set<string>();
  const imports = new Map<string, string>();
  const depend = (name: string, from: unknown) => deps.set(name, namesIn(from, deps.get(name) ?? new Set()));
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isNode(n) || TYPE_ONLY.has(String(n.type))) {
      if (isNode(n) && n.type === "ImportDeclaration")
        for (const s of (n.specifiers ?? []) as Node[]) imports.set(String((s.local as Node).name), String(((s.imported as Node | undefined)?.name ?? (s.local as Node).name) as string));
      return;
    }
    if (n.type === "CallExpression" && lookups.has(String((n.callee as Node).name ?? ""))) namesIn(n.arguments, fed);
    if (n.type === "VariableDeclarator") for (const name of boundNames(n.id)) depend(name, n.init);
    if (n.type === "FunctionDeclaration" && isNode(n.id)) depend(String(n.id.name), n.body);
    if (n.type === "AssignmentExpression" && isNode(n.left)) for (const name of namesIn(n.left)) depend(name, n.right);
    if (n.type === "ForOfStatement" || n.type === "ForInStatement") for (const name of boundNames(((n.left as Node).declarations as Node[] | undefined)?.[0]?.id ?? n.left)) depend(name, n.right);
    if (n.type === "CallExpression" && /MemberExpression$/.test(String((n.callee as Node).type)))
      for (const arg of n.arguments as Node[]) if (isFunction(arg)) for (const name of ((arg.params ?? []) as unknown[]).flatMap((p) => boundNames(p))) depend(name, (n.callee as Node).object);
    children(n, walk);
  };
  walk(program);
  for (const [name] of deps) if (fedElsewhere.has(name)) fed.add(name);
  for (const [local, imported] of imports) if (fedElsewhere.has(imported)) fed.add(local);
  const queue = [...fed];
  while (queue.length) for (const dep of deps.get(queue.pop()!) ?? []) if (!fed.has(dep)) queue.push(fed.add(dep) && dep);
  return { fed, imports };
}

const WRAPPERS = new Set([
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "ConditionalExpression",
  "LogicalExpression",
  "ParenthesizedExpression",
  "TSNonNullExpression",
  "SpreadElement",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "BinaryExpression",
  "TemplateLiteral",
]);

function fnName(fn: Node, up: readonly Node[]): string {
  if (isNode(fn.id)) return String(fn.id.name);
  const holder = up.at(-1);
  if (holder?.type === "VariableDeclarator") return String((holder.id as Node).name ?? "");
  if (holder?.type === "Property") return String((holder.key as Node).name ?? (holder.key as Node).value ?? "");
  return "";
}

function feedsLookup(stack: readonly { node: Node; field: string }[], flow: Flow, lookups: ReadonlySet<string>): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const { node, field } = stack[i]!;
    if ((node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") && keyTyped(node.typeAnnotation)) return true;
    if (node.type === "ConditionalExpression" && field === "test") return false;
    if (node.type === "Property" && field === "key") return false;
    if (WRAPPERS.has(String(node.type))) continue;
    if (node.type === "CallExpression") return field === "arguments" && lookups.has(String((node.callee as Node).name ?? ""));
    if (node.type === "VariableDeclarator") return field === "init" && (keyTyped((node.id as Node).typeAnnotation) || boundNames(node.id).some((name) => flow.fed.has(name)));
    if (node.type === "AssignmentExpression") return field === "right" && [...namesIn(node.left)].some((name) => flow.fed.has(name));
    if (node.type === "ReturnStatement" || (isFunction(node) && field === "body")) {
      const at = node.type === "ReturnStatement" ? stack.findLastIndex((s, j) => j < i && isFunction(s.node)) : i;
      const fn = stack[at]?.node;
      return (
        !!fn &&
        (keyTyped(fn.returnType) ||
          flow.fed.has(
            fnName(
              fn,
              stack.slice(0, at).map((s) => s.node),
            ),
          ))
      );
    }
    if (node.type === "BlockStatement") continue;
    return false;
  }
  return false;
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

function placeOf(stack: readonly { node: Node; field: string }[], flow: Flow, lookups: ReadonlySet<string>): Place {
  const top = stack.at(-1);
  if (!top || NOT_A_READ.has(String(top.node.type))) return "none";
  if (top.node.type === "CallExpression") return top.field === "arguments" && lookups.has(String((top.node.callee as Node).name ?? "")) ? "lookup" : "none";
  if (top.node.type === "BinaryExpression" && top.node.operator !== "+") return "none";
  return feedsLookup(stack, flow, lookups) ? "data" : "none";
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
  learnKeyTypes(programs);
  const read = (raw: Part[], place: Place): void => {
    if (place === "none") return;
    const parts = normalized(raw);
    if (parts.every((p) => typeof p === "string")) return void literals.add(parts.join(""));
    const bridge = parts.length === 2 && parts[0] === EVENTS && parts[1] === WILD;
    if (bridge || (place === "data" && !keyShaped(parts))) return;
    patterns.push(new RegExp(`^${parts.map((p) => (p === WILD ? ".*" : escaped(p))).join("")}$`));
  };
  let fedElsewhere = new Set<string>();
  let flows: Flow[] = [];
  for (let round = 0; round < 4; round++) {
    flows = programs.map(({ program }) => flowIn(program, lookups, fedElsewhere));
    const next = new Set(flows.flatMap((f) => [...f.imports].filter(([local]) => f.fed.has(local)).map(([, imported]) => imported)));
    if (next.size === fedElsewhere.size) break;
    fedElsewhere = next;
  }
  programs.forEach(({ program }, i) => {
    const consts = constsIn(program);
    const flow = flows[i]!;
    const stack: { node: Node; field: string }[] = [];
    const walk = (n: unknown, field: string): void => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, field));
      if (!isNode(n) || TYPE_ONLY.has(String(n.type))) return;
      if ((n.type === "ExportNamedDeclaration" && n.source) || n.type === "ImportExpression") return;
      const parent = stack.at(-1)?.node;
      const inside = parent !== undefined && (isConcat(parent) || parent.type === "TemplateLiteral");
      if (!inside && (isText(n) || n.type === "TemplateLiteral" || isConcat(n))) read(partsOf(n, consts), placeOf(stack, flow, lookups));
      children(n, (child, f) => {
        stack.push({ node: n, field: f });
        walk(child, f);
        stack.pop();
      });
    };
    walk(program, "");
  });
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
