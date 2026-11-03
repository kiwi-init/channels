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

interface Piece {
  text: string;
  line: number;
}

interface Block {
  prelude: Piece;
  pieces: Piece[];
}

function blocksOf(css: string): Block[] {
  const done: Block[] = [];
  const root: Block = { prelude: { text: "", line: 1 }, pieces: [] };
  const stack: Block[] = [root];
  let piece: Piece = { text: "", line: 1 };
  let line = 1;
  let quote = "";
  const top = () => stack[stack.length - 1] ?? root;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i] ?? "";
    if (quote) {
      piece.text += ch;
      if (ch === "\\") {
        const escaped = css[++i] ?? "";
        piece.text += escaped;
        if (escaped === "\n") line++;
      } else if (ch === quote) quote = "";
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      line += css.slice(i, stop).split("\n").length - 1;
      i = stop - 1;
      continue;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      piece.text += ch;
    } else if (ch === "{") {
      stack.push({ prelude: piece, pieces: [] });
      piece = { text: "", line };
    } else if (ch === "}") {
      if (stack.length > 1) {
        top().pieces.push(piece);
        const closed = stack.pop();
        if (closed) done.push(closed);
      }
      piece = { text: "", line };
    } else if (ch === ";") {
      top().pieces.push(piece);
      piece = { text: "", line };
    } else {
      if (!piece.text.trim() && ch.trim()) piece.line = line;
      piece.text += ch;
    }
    if (ch === "\n") line++;
  }
  top().pieces.push(piece);
  return [...done, ...stack.slice(1).reverse()];
}

function declsOf(block: Block): Decl[] {
  return block.pieces.flatMap((p) => {
    const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(p.text);
    return m ? [{ prop: (m[1] ?? "").toLowerCase(), value: m[2] ?? "", line: p.line }] : [];
  });
}

export function breachesIn(css: string, file: string): Breach[] {
  const found: Breach[] = [];
  for (const block of blocksOf(css)) {
    const head = block.prelude.text.trim();
    if (head.startsWith("@container") && PX.test(head)) found.push({ file, line: block.prelude.line, what: `${head} measures in px: write rem so it follows the text size` });
    const decls = declsOf(block);
    const sized = decls.some((d) => (d.prop === "font" || d.prop === "font-size") && d.value !== "inherit");
    for (const d of decls) {
      if (TYPE.has(d.prop) && PX.test(d.value)) found.push({ file, line: d.line, what: `${d.prop}: ${d.value} sets type in px: use a --t-* token or rem` });
      else if (sized && BOX.has(d.prop) && PX.test(d.value) && !SCALES.test(d.value))
        found.push({ file, line: d.line, what: `${d.prop}: ${d.value} fixes a text box in px: use rem so it grows with the text` });
    }
  }
  return found.sort((a, b) => a.line - b.line);
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
