import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CHANNELS_DARK, CHANNELS_LIGHT } from "../ui/src/theme/channels.ts";
import { TOKENS, type Colors } from "../ui/src/theme/derive.ts";

export const TOKENS_CSS = join(import.meta.dir, "../ui/src/styles/tokens.css");

export const BLOCKS = [
  { name: "dark", open: /^:root \{$/m, colors: CHANNELS_DARK.colors },
  { name: "light", open: /^:root\[data-theme="light"\] \{$/m, colors: CHANNELS_LIGHT.colors },
  { name: "auto-light", open: /^ {2}:root:not\(\[data-theme="dark"\]\) \{$/m, colors: CHANNELS_LIGHT.colors },
] as const;

export type Drift = { block: string; token: string; css: string | null; source: string };

function blockRange(css: string, open: RegExp): { from: number; to: number } {
  const all = [...css.matchAll(new RegExp(open.source, "gm"))].filter((m) => {
    const from = (m.index ?? 0) + m[0].length;
    return /\n\s*--bg:/.test(css.slice(from, css.indexOf("}", from)));
  });
  if (all.length !== 1) throw new Error(`expected one ${open.source} block holding --bg in tokens.css, found ${all.length}`);
  const from = (all[0]?.index ?? 0) + (all[0]?.[0].length ?? 0);
  return { from, to: css.indexOf("}", from) };
}

export function syncTokens(css: string): { css: string; drift: Drift[] } {
  const drift: Drift[] = [];
  let out = css;
  for (const block of BLOCKS) {
    const { from, to } = blockRange(out, block.open);
    let body = out.slice(from, to);
    for (const token of TOKENS) {
      const source = (block.colors as Colors)[token];
      const line = new RegExp(`^(\\s*--${token}: )([^;]*)(;)$`, "gm");
      const hits = [...body.matchAll(line)];
      if (hits.length !== 1) {
        drift.push({ block: block.name, token, css: null, source });
        continue;
      }
      const css = hits[0]?.[2] ?? "";
      if (css !== source) drift.push({ block: block.name, token, css, source });
      body = body.replace(line, `$1${source}$3`);
    }
    out = out.slice(0, from) + body + out.slice(to);
  }
  return { css: out, drift };
}

if (import.meta.main) {
  const at = process.argv.indexOf("--css");
  const file = at > 0 ? (process.argv[at + 1] ?? TOKENS_CSS) : TOKENS_CSS;
  const write = process.argv.includes("--write");
  if (process.argv.includes("--help")) {
    console.log(
      "usage: bun scripts/theme-tokens.ts [--write] [--css PATH]\n\nThe built-in theme colours in ui/src/styles/tokens.css come from ui/src/theme/channels.ts: the dark :root block from CHANNELS_DARK, and both light blocks from CHANNELS_LIGHT. Without --write it fails when the CSS differs; with --write it rewrites only those colour values.",
    );
    process.exit(0);
  }
  const { css, drift } = syncTokens(readFileSync(file, "utf8"));
  const lost = drift.filter((d) => d.css === null);
  if (write && lost.length) {
    for (const d of lost) console.error(`${d.block} --${d.token}: tokens.css has no single declaration to rewrite`);
    process.exit(1);
  }
  if (write) {
    writeFileSync(file, css);
    console.log(drift.length ? `theme-tokens: rewrote ${drift.length} colour values in ${file}` : `theme-tokens: ${file} already matches channels.ts`);
  } else if (drift.length) {
    for (const d of drift) console.error(`${d.block} --${d.token}: tokens.css has ${d.css ?? "no single declaration"}, channels.ts has ${d.source}`);
    console.error(`\ntheme-tokens: ${drift.length} colour values in ${file} differ from ui/src/theme/channels.ts; edit channels.ts and run bun scripts/theme-tokens.ts --write`);
    process.exit(1);
  } else {
    console.log(`theme-tokens: the 3 colour blocks in ${file} match channels.ts (${TOKENS.length} tokens each)`);
  }
}
