import { Glob } from "bun";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "ui/src");
const ALLOW = join(import.meta.dir, "ui-english.json");
const SKIP = /(?:\.test\.tsx?|\.page\.ts|\.d\.ts)$|^(?:demo|i18n)\/|^sent\.ts$|^chat\/thumb(?:s|-shrink)\.ts$|^kit\/typing-(?:record|trace)\.ts$/;
const SHOWN_ATTRS = new Set(["label", "title", "aria-label", "aria-description", "placeholder", "alt", "hint", "lede", "sub", "tip", "verb"]);
const SENTENCE = /^[A-Z][a-z']+(?:\s|[.,:;!?…]|$)|[a-z]{2,}\s+[a-z]{2,}.*[.?!…]$/;
const PHRASE = /^(?:[a-z']+|§)(?: (?:[a-z']+|§))+$/;
const AS_IS = new Set(["Channels", "channels", "Channels is not a harness", "GitHub", "Linux", "Windows", "Inter", "Lato", "Atkinson", "Esc", "kiwi login", "kiwi doctor"]);
const ID_TEMPLATE = /^T\{\}(?:(?: | · )\{\})*\s?$/;
const DEV_ERRORS = /^(?:TypeError|RangeError|SyntaxError|ReferenceError)$/;
const THEME_TYPE = /\bColorTheme\b/;

type Node = { type?: string; [k: string]: unknown };

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null;

function looksShown(text: string): boolean {
  const s = text.trim();
  return /[A-Za-z]{2,}/.test(s) && SENTENCE.test(s) && !AS_IS.has(s);
}

const isPhrase = (text: string): boolean => PHRASE.test(text.trim()) && /[a-z]{3,}/.test(text) && !AS_IS.has(text.trim());

const hasWords = (text: string): boolean => /[A-Za-z]{2,}/.test(text) && !AS_IS.has(text.trim());

function keyName(n: Node | undefined): string {
  if (!n) return "";
  if (n.type === "Identifier") return String(n.name);
  if (n.type === "Literal") return String(n.value);
  return "";
}

const QUIET_KEYS = new Set(["type", "key", "rel"]);

const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "ParenthesizedExpression"]);

const unwrapped = (n: Node): Node => (isNode(n) && WRAPPERS.has(String(n.type)) ? unwrapped(n.expression as Node) : n);

function calleeName(n: Node): string {
  const c = n.callee as Node | undefined;
  if (!c) return "";
  if (c.type === "Identifier") return String(c.name);
  if (c.type === "MemberExpression" || c.type === "StaticMemberExpression") return `${calleeName({ callee: c.object } as Node)}.${String((c.property as Node)?.name ?? "")}`;
  return "";
}

const QUIET_CALLS =
  /^(?:t|console\.\w+|require|import|cx|noteTyping|event|send|sends|\w+\.send|querySelector|\w+\.querySelector(?:All)?|\w+\.(?:get|set|remove)Item|\w+\.startsWith|\w+\.endsWith|\w+\.includes|\w+\.(?:add|remove|toggle|contains))$/;

export const skipped = (path: string): boolean => SKIP.test(path);

export function englishIn(file: string, code: string): number {
  const { program } = parseSync(file, code);
  let found = 0;
  const themes = new Set<Node>();
  const walk = (n: unknown, quiet: boolean): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x, quiet);
      return;
    }
    if (!isNode(n)) return;
    switch (n.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "TSTypeAnnotation":
      case "TSTypeAliasDeclaration":
      case "TSInterfaceDeclaration":
      case "TSLiteralType":
        return;
      case "ExportNamedDeclaration":
        if (n.source) return;
        break;
      case "JSXText":
        if (hasWords(String(n.value))) found++;
        return;
      case "JSXAttribute": {
        const name = String((n.name as Node)?.name ?? "");
        const value = n.value as Node | null;
        if (value?.type === "Literal" && typeof value.value === "string") {
          if (SHOWN_ATTRS.has(name) && hasWords(value.value)) found++;
          return;
        }
        walk(value, quiet || !SHOWN_ATTRS.has(name));
        return;
      }
      case "CallExpression":
        if (QUIET_CALLS.test(calleeName(n))) return;
        break;
      case "NewExpression":
        if (QUIET_CALLS.test(calleeName(n)) || DEV_ERRORS.test(calleeName(n))) return;
        break;
      case "VariableDeclarator": {
        if (QUIET_KEYS.has(keyName(n.id as Node))) return;
        const typed = (n.id as Node)?.typeAnnotation as Node | undefined;
        if (typed && THEME_TYPE.test(code.slice(Number(typed.start), Number(typed.end)))) themes.add(unwrapped(n.init as Node));
        break;
      }
      case "ObjectExpression":
        if (themes.has(n)) for (const p of n.properties as Node[]) if (keyName(p.key as Node) === "name") themes.add(p);
        break;
      case "ArrayExpression":
        if (themes.has(n)) for (const e of n.elements as Node[]) if (isNode(e)) themes.add(unwrapped(e));
        break;
      case "AssignmentExpression": {
        const left = n.left as Node;
        if (keyName(left?.property as Node) === "type") return;
        break;
      }
      case "BinaryExpression":
        if (n.operator !== "+") return;
        break;
      case "SwitchCase":
        walk(n.consequent, quiet);
        return;
      case "Property":
        if (themes.has(n) || QUIET_KEYS.has(keyName(n.key as Node))) return;
        walk(n.value, quiet);
        return;
      case "Literal":
        if (!quiet && typeof n.value === "string" && (looksShown(n.value) || isPhrase(n.value))) found++;
        return;
      case "TemplateLiteral": {
        const text = (n.quasis as Node[]).map((q) => String((q.value as Node)?.cooked ?? "")).join("{}");
        if (!quiet && !ID_TEMPLATE.test(text) && (looksShown(text.replace(/\{\}/g, "x")) || isPhrase(text.replace(/\{\}/g, "§")))) found++;
        walk(n.expressions, quiet);
        return;
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== "type" && k !== "start" && k !== "end") walk(v, quiet);
  };
  walk(program.body, false);
  return found;
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for await (const path of new Glob("**/*.{ts,tsx}").scan(SRC)) {
    if (skipped(path)) continue;
    const n = englishIn(path, await Bun.file(join(SRC, path)).text());
    if (n) out[`ui/src/${path}`] = n;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (import.meta.main) {
  const now = await counts();
  if (process.argv.includes("--write")) {
    await Bun.write(ALLOW, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`ui-english: ${Object.values(now).reduce((a, b) => a + b, 0)} English strings left in ${Object.keys(now).length} files, written to ${relative(ROOT, ALLOW)}`);
    process.exit(0);
  }
  const allowed = (await Bun.file(ALLOW).json()) as Record<string, number>;
  const grew = Object.entries(now).filter(([f, n]) => n > (allowed[f] ?? 0));
  const shrank = Object.entries(allowed).filter(([f, n]) => (now[f] ?? 0) < n);
  for (const [f, n] of grew)
    console.error(
      `${f}: ${n} user-facing English strings, ${allowed[f] ?? 0} allowed. Put new words in an English area file under ui/src/i18n/en/ and show them with t(); text sent to the channel goes in ui/src/sent.ts.`,
    );
  for (const [f, n] of shrank) console.error(`${f}: ${now[f] ?? 0} English strings left, the allowlist still says ${n}. Run bun scripts/ui-english.ts --write.`);
  if (grew.length || shrank.length) process.exit(1);
  console.log(`ui-english: ${Object.values(now).reduce((a, b) => a + b, 0)} English strings left in ${Object.keys(now).length} files, none new`);
}
