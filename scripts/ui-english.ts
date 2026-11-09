import { Glob } from "bun";
import { join, relative } from "node:path";
import { parseSync } from "oxc-parser";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "ui/src");
const ALLOW = join(import.meta.dir, "ui-english.json");
const SKIP = /(?:\.test\.tsx?|\.page\.ts|\.d\.ts)$|^(?:demo|i18n)\//;
const SHOWN_ATTRS = new Set(["label", "title", "aria-label", "aria-description", "placeholder", "alt", "hint", "lede", "sub", "tip", "verb"]);
const SENTENCE = /^[A-Z][a-z']+(?:\s|[.,:;!?…]|$)|[a-z]{2,}\s+[a-z]{2,}.*[.?!…]$/;

type Node = { type?: string; [k: string]: unknown };

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null;

function looksShown(text: string): boolean {
  const s = text.trim();
  return /[A-Za-z]{2,}/.test(s) && SENTENCE.test(s);
}

function calleeName(n: Node): string {
  const c = n.callee as Node | undefined;
  if (!c) return "";
  if (c.type === "Identifier") return String(c.name);
  if (c.type === "MemberExpression" || c.type === "StaticMemberExpression") return `${calleeName({ callee: c.object } as Node)}.${String((c.property as Node)?.name ?? "")}`;
  return "";
}

const QUIET_CALLS =
  /^(?:t|console\.\w+|require|import|cx|querySelector|\w+\.querySelector(?:All)?|\w+\.(?:get|set|remove)Item|\w+\.startsWith|\w+\.endsWith|\w+\.includes|\w+\.(?:add|remove|toggle|contains))$/;

function englishIn(file: string, code: string): number {
  const { program } = parseSync(file, code);
  let found = 0;
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
        if (/[A-Za-z]{2,}/.test(String(n.value))) found++;
        return;
      case "JSXAttribute": {
        const name = String((n.name as Node)?.name ?? "");
        const value = n.value as Node | null;
        if (value?.type === "Literal" && typeof value.value === "string") {
          if (SHOWN_ATTRS.has(name) && /[A-Za-z]{2,}/.test(value.value)) found++;
          return;
        }
        walk(value, quiet || !SHOWN_ATTRS.has(name));
        return;
      }
      case "CallExpression":
      case "NewExpression":
        if (QUIET_CALLS.test(calleeName(n))) return;
        break;
      case "BinaryExpression":
        if (n.operator !== "+") return;
        break;
      case "SwitchCase":
        walk(n.consequent, quiet);
        return;
      case "Property":
        walk(n.value, quiet);
        return;
      case "Literal":
        if (!quiet && typeof n.value === "string" && looksShown(n.value)) found++;
        return;
      case "TemplateLiteral": {
        const text = (n.quasis as Node[]).map((q) => String((q.value as Node)?.cooked ?? "")).join("{}");
        if (!quiet && looksShown(text.replace(/\{\}/g, "x"))) found++;
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
    if (SKIP.test(path)) continue;
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
  for (const [f, n] of grew) console.error(`${f}: ${n} user-facing English strings, ${allowed[f] ?? 0} allowed. Put new words in ui/src/i18n/en.ts and show them with t().`);
  for (const [f, n] of shrank) console.error(`${f}: ${now[f] ?? 0} English strings left, the allowlist still says ${n}. Run bun scripts/ui-english.ts --write.`);
  if (grew.length || shrank.length) process.exit(1);
  console.log(`ui-english: ${Object.values(now).reduce((a, b) => a + b, 0)} English strings left in ${Object.keys(now).length} files, none new`);
}
