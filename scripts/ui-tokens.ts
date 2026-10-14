// The web's sizes come from six type steps and four radii (web/src/index.css). This fails on
// any arbitrary text-[Npx] or rounded-[Npx] in web/src, so the drift that made the UI feel loose
// can't creep back. A real exception goes in ALLOWED, with its reason.
//
//   bun scripts/ui-tokens.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../web/src");
const ALLOWED: Record<string, string> = {
  "text-[34px]": "the 6-digit verification code an owner compares by eye",
  "text-[44px]": "the same code, on a page of its own",
  "text-[40px]": "the wordmark",
  "text-[8px]": "initials inside a 20px colour swatch",
};

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.(tsx?|css)$/.test(n) ? [join(dir, n)] : []));

const bad: string[] = [];
for (const f of files(ROOT)) {
  readFileSync(f, "utf8")
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(/\b(?:text|rounded(?:-[trbl]{1,2})?)-\[\d+(?:\.\d+)?px\]/g)) if (!(m[0] in ALLOWED)) bad.push(`${relative(ROOT, f)}:${i + 1}  ${m[0]}`);
    });
}
if (bad.length) {
  console.error(`Use the type steps (text-stamp, text-meta, text-ui, text-body, text-title, text-display) and radii (rounded-row, rounded-ctl, rounded-card, rounded-bubble, rounded-dock):\n${bad.map((b) => `  ${b}`).join("\n")}`);
  process.exit(1);
}
console.log("ui tokens: ok");
