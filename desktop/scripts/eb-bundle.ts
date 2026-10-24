import { builtinModules } from "node:module";
import { parseSync, type Argument, type Class, type Directive, type Expression, type Statement } from "oxc-parser";

export const RELEASE_ID = "com.kiwiinit.channels";

export const TEST_ID = "com.kiwiinit.channels.test";

export function testBuildProblems(testBuild: boolean, identifier: string, versionJson: string): string[] {
  if (!testBuild) return [];
  let channel: unknown;
  try {
    channel = (JSON.parse(versionJson) as { channel?: unknown }).channel;
  } catch {
    // An unreadable version.json names no channel, so it can't show the test build is a dev one.
    channel = undefined;
  }
  return [
    ...(channel === "dev" ? [] : [`CHANNELS_EB_TEST=1 built a ${String(channel)} app: the test driver goes only into dev builds, never a stable or canary one`]),
    ...(identifier === TEST_ID ? [] : [`CHANNELS_EB_TEST=1 built ${identifier}: a test build is always ${TEST_ID}`]),
  ];
}

export function bundleProblems(main: string, preload: string): string[] {
  const problems: string[] = [];
  const tables = main.match(/webviewTagExecuteJavascript\s*:\s*\(/g)?.length ?? 0;
  if (tables !== 1) problems.push(`the main bundle defines Electrobun's internal RPC table ${tables} times, so lockInternalRpc may not reach the one Electrobun dispatches from`);
  if (preload.length === 0) problems.push("the preload bundle is empty: window.kiwi would never exist");
  if (/\bWebSocket\b/.test(preload)) problems.push("the preload bundle uses a WebSocket: the bridge must go only through the native postMessage bridge");
  return problems;
}

export function urlSchemeProblems(infoPlist: string, identifier: string, scheme: string): string[] {
  const listed = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(infoPlist)?.[1] ?? "";
  const schemes = [...listed.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  const has = schemes.includes(scheme);
  if (identifier === RELEASE_ID) return has ? [] : [`the app registers no ${scheme}:// scheme (CFBundleURLSchemes in Info.plist), so macOS never sends it a ${scheme}:// link`];
  return has ? [`the test build ${identifier} registers ${scheme}://, so it could take links meant for the installed Channels`] : [];
}

const plistString = (infoPlist: string, key: string): string | null => new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(infoPlist)?.[1] ?? null;

export function shortVersion(version: string): string {
  return version.replace(/[-+].*$/, "");
}

export function versionProblems(infoPlist: string): string[] {
  const version = plistString(infoPlist, "CFBundleVersion");
  const short = plistString(infoPlist, "CFBundleShortVersionString");
  if (!version) return ["Info.plist names no CFBundleVersion"];
  if (!short) return ["Info.plist names no CFBundleShortVersionString, so Finder and About show no version"];
  return short === shortVersion(version) && /^\d+\.\d+\.\d+$/.test(short) ? [] : [`Info.plist's CFBundleShortVersionString is ${short}, not ${shortVersion(version)} from CFBundleVersion ${version}`];
}

const KEY_CHANNEL = "launcherKeys";
const PURE_CALLS = new Set(["__esm", "__commonJS", "__export", "createRequire", "Symbol"]);
const PURE_STATICS: Record<string, ReadonlySet<string>> = {
  Object: new Set(["defineProperty", "freeze", "create", "assign", "keys", "entries", "fromEntries", "getOwnPropertyNames", "getOwnPropertyDescriptor", "getPrototypeOf"]),
  Buffer: new Set(["from", "alloc"]),
  Array: new Set(["from", "isArray"]),
  JSON: new Set(["stringify", "parse"]),
};
const PURE_METHODS = new Set([
  "encode",
  "decode",
  "map",
  "filter",
  "includes",
  "indexOf",
  "some",
  "every",
  "find",
  "join",
  "concat",
  "slice",
  "split",
  "trim",
  "toLowerCase",
  "toUpperCase",
  "replace",
]);
const PURE_NEW = new Set(["Map", "Set", "WeakMap", "WeakSet", "TextEncoder", "TextDecoder", "RegExp", "Error"]);
const BUILTINS = new Set(builtinModules);

const builtin = (source: string): boolean => source.startsWith("node:") || source.startsWith("bun:") || source === "bun" || BUILTINS.has(source);

function inertness(helpers: ReadonlyMap<string, Expression>): { inert: (e: Expression | null) => boolean; statement: (st: Directive | Statement) => boolean } {
  const visiting = new Set<string>();

  const inertClass = (c: Class): boolean =>
    c.decorators.length === 0 &&
    inert(c.superClass) &&
    c.body.body.every((m) => {
      if (m.type === "StaticBlock") return false;
      if (m.type === "TSIndexSignature") return true;
      if (m.computed && m.key.type !== "PrivateIdentifier" && !inert(m.key as Expression)) return false;
      return !(m.type === "PropertyDefinition" || m.type === "AccessorProperty") || !m.static || inert(m.value);
    });

  const inertArgument = (a: Argument): boolean => {
    if (a.type === "SpreadElement") return inert(a.argument);
    if (a.type === "ArrowFunctionExpression") return a.body.type !== "BlockStatement" && inert(a.body);
    return a.type !== "FunctionExpression" && inert(a);
  };

  const inertHelper = (name: string): boolean => {
    const body = helpers.get(name);
    if (body === undefined || visiting.has(name)) return false;
    visiting.add(name);
    try {
      return inert(body);
    } finally {
      visiting.delete(name);
    }
  };

  const asValue = (a: Argument): boolean => (a.type === "SpreadElement" ? inert(a.argument) : inert(a));

  const inertCall = (callee: Expression, args: Argument[]): boolean => {
    if (callee.type === "Identifier") return (PURE_CALLS.has(callee.name) || inertHelper(callee.name)) && args.every(asValue);
    if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return false;
    const method = callee.property.name;
    if (callee.object.type === "Identifier" && PURE_STATICS[callee.object.name]?.has(method)) return args.every(asValue);
    return PURE_METHODS.has(method) && inert(callee.object) && args.every(inertArgument);
  };

  function inert(e: Expression | null): boolean {
    if (e === null) return true;
    switch (e.type) {
      case "Literal":
      case "Identifier":
      case "ThisExpression":
      case "MetaProperty":
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return true;
      case "TemplateLiteral":
        return e.expressions.every(inert);
      case "ClassExpression":
        return inertClass(e);
      case "ArrayExpression":
        return e.elements.every((x) => x === null || (x.type === "SpreadElement" ? inert(x.argument) : inert(x)));
      case "ObjectExpression":
        return e.properties.every((p) => (p.type === "SpreadElement" ? inert(p.argument) : (!p.computed || inert(p.key as Expression)) && inert(p.value as Expression)));
      case "UnaryExpression":
        return e.operator !== "delete" && inert(e.argument);
      case "BinaryExpression":
        return (e.left.type === "PrivateIdentifier" || inert(e.left)) && inert(e.right);
      case "LogicalExpression":
        return inert(e.left) && inert(e.right);
      case "ConditionalExpression":
        return inert(e.test) && inert(e.consequent) && inert(e.alternate);
      case "SequenceExpression":
        return e.expressions.every(inert);
      case "ParenthesizedExpression":
        return inert(e.expression);
      case "ChainExpression":
        return e.expression.type === "CallExpression" ? inertCall(e.expression.callee, e.expression.arguments) : inert(e.expression);
      case "MemberExpression":
        return inert(e.object) && (!e.computed || inert(e.property));
      case "AssignmentExpression":
        return e.operator === "=" && e.left.type === "Identifier" && inert(e.right);
      case "CallExpression":
        return inertCall(e.callee, e.arguments);
      case "NewExpression":
        return e.callee.type === "Identifier" && PURE_NEW.has(e.callee.name) && e.arguments.every(inertArgument);
      default:
        return false;
    }
  }

  const statement = (st: Directive | Statement): boolean => {
    switch (st.type) {
      case "ImportDeclaration":
      case "FunctionDeclaration":
      case "EmptyStatement":
        return true;
      case "ClassDeclaration":
        return inertClass(st);
      case "VariableDeclaration":
        return st.declarations.every((d) => inert(d.init));
      case "ExpressionStatement":
        return inert(st.expression);
      default:
        return false;
    }
  };

  return { inert, statement };
}

function helpersIn(body: (Directive | Statement)[]): Map<string, Expression> {
  const helpers = new Map<string, Expression>();
  for (const st of body) {
    if (st.type === "FunctionDeclaration" && st.id && st.body?.body.length === 1) {
      const only = st.body.body[0];
      if (only?.type === "ReturnStatement" && only.argument) helpers.set(st.id.name, only.argument);
    }
    if (st.type === "VariableDeclaration")
      for (const d of st.declarations) if (d.id.type === "Identifier" && d.init?.type === "ArrowFunctionExpression" && d.init.body.type !== "BlockStatement") helpers.set(d.id.name, d.init.body);
  }
  return helpers;
}

type Walked = { type: string } & Record<string, unknown>;

const walked = (v: unknown): v is Walked => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";

function calls(name: string, node: unknown): boolean {
  if (Array.isArray(node)) return node.some((n) => calls(name, n));
  if (!walked(node)) return false;
  const callee = node["callee"];
  if (node.type === "CallExpression" && walked(callee) && callee.type === "Identifier" && callee["name"] === name) return true;
  return Object.entries(node).some(([k, v]) => k !== "parent" && calls(name, v));
}

const declares = (st: Directive | Statement, name: string): boolean => st.type === "VariableDeclaration" && st.declarations.some((d) => d.id.type === "Identifier" && d.id.name === name);

export function keyChannelProblems(main: string): string[] {
  const { program, errors } = parseSync("index.js", main, { sourceType: "module" });
  if (errors.length) return [`the main bundle doesn't parse: ${errors[0]?.message ?? ""}`];
  const shown = (st: { start: number; end: number }): string => main.slice(st.start, Math.min(st.end, st.start + 100)).replace(/\s+/g, " ");
  const problems = program.body
    .filter((st) => st.type === "ImportDeclaration" && !builtin(st.source.value))
    .map((st) => `the main bundle imports ${st.type === "ImportDeclaration" ? st.source.value : ""}, whose top level runs before the key channel is taken: ${shown(st)}`);
  const at = program.body.findIndex((st) => declares(st, KEY_CHANNEL));
  if (at < 0) return [...problems, `the main bundle never takes the launcher's key channel (${KEY_CHANNEL} from desktop/src/launcher-channel-eb.ts)`];
  const channel = program.body[at];
  const declarator = channel?.type === "VariableDeclaration" ? channel.declarations.find((d) => d.id.type === "Identifier" && d.id.name === KEY_CHANNEL) : undefined;
  if (!declarator?.init || !calls("keySources", declarator.init))
    return [
      ...problems,
      `the main bundle declares ${KEY_CHANNEL} without calling keySources() there: Bun wrapped launcher-channel-eb.ts in __esm (it does when a module is also import()ed or require()d), so where the declaration sits doesn't say when the channel is taken; import launcher-channel-eb.ts only statically, as main-eb's first import`,
    ];
  const before = program.body.slice(0, at);
  const { statement } = inertness(helpersIn(before));
  const early = before.filter((st) => !statement(st));
  if (early.length)
    problems.push(
      `${early.length} top-level statement${early.length === 1 ? " runs" : "s run"} before the key channel is taken, so a child started there would inherit fd 3; launcher-channel-eb.ts must stay main-eb's first import: ${early.slice(0, 3).map(shown).join(" | ")}`,
    );
  return problems;
}
