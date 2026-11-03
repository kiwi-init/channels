import { Glob } from "bun";
import { join } from "node:path";

export interface Breach {
  file: string;
  line: number;
  what: string;
}

const PX = /(?<![\w.-])-?\d*\.?\d+px\b/;
const TYPE = new Set(["font", "font-size", "line-height"]);
const BOX = new Set(["height", "min-height"]);
const SCALES = /\d(?:r?em|ch)\b|var\(--/;

interface Decl {
  prop: string;
  value: string;
  line: number;
}

function lineAt(css: string, index: number): number {
  return css.slice(0, index).split("\n").length;
}

export function breachesIn(css: string, file: string): Breach[] {
  const found: Breach[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  for (const m of stripped.matchAll(/@container\b([^{]*)\{/g)) {
    if (PX.test(m[1] ?? "")) found.push({ file, line: lineAt(stripped, m.index), what: `@container${(m[1] ?? "").trimEnd()} measures in px: write rem so it follows the text size` });
  }
  for (const m of stripped.matchAll(/\{([^{}]*)\}/g)) {
    const body = m[1] ?? "";
    const start = m.index + 1;
    const decls: Decl[] = [];
    for (const d of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) {
      decls.push({ prop: (d[1] ?? "").toLowerCase(), value: (d[2] ?? "").trim(), line: lineAt(stripped, start + d.index) });
    }
    const sized = decls.some((d) => (d.prop === "font" || d.prop === "font-size") && d.value !== "inherit");
    for (const d of decls) {
      if (TYPE.has(d.prop) && PX.test(d.value)) found.push({ file, line: d.line, what: `${d.prop}: ${d.value} sets type in px: use a --t-* token or rem` });
      else if (sized && BOX.has(d.prop) && PX.test(d.value) && !SCALES.test(d.value))
        found.push({ file, line: d.line, what: `${d.prop}: ${d.value} fixes a text box in px: use rem so it grows with the text` });
    }
  }
  return found;
}

export function cssFiles(root: string): string[] {
  return [...new Glob("ui/src/styles/*.css").scanSync({ cwd: root })].sort();
}

export async function check(root: string): Promise<Breach[]> {
  const found: Breach[] = [];
  for (const file of cssFiles(root)) found.push(...breachesIn(await Bun.file(join(root, file)).text(), file));
  return found;
}

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const found = await check(root);
  const annotate = process.env.GITHUB_ACTIONS === "true";
  for (const b of found) {
    console.log(`${b.file}:${b.line}: ${b.what}`);
    if (annotate) console.log(`::error file=${b.file},line=${b.line}::${b.what}`);
  }
  if (found.length) {
    console.error(`${found.length} size(s) in px that should follow Settings > Appearance > Text size.`);
    process.exit(1);
  }
  console.log(`type and text boxes in ${cssFiles(root).length} stylesheets follow the text size.`);
}
