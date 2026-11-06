import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleMod } from "@kiwi/core/node/mod-bundle.ts";

const roots: string[] = [];

function mod(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kiwi-mod-bundle-"));
  roots.push(root);
  const dir = join(root, "mods", "demo");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("bundling a mod", () => {
  test("its TSX, its own files, CSS and images build to one script that takes React and the kit from the frame", async () => {
    const dir = mod({
      "index.tsx": `import { useState } from "react"\nimport { panel } from "@kiwi/mod"\nimport { label } from "./parts/label"\nimport "./look.css"\nimport icon from "./icon.svg"\nexport function View() { const [n] = useState(0); return <img alt={label + n} src={icon} /> }\npanel({ title: label, render: View })\n`,
      "parts/label.ts": `export const label = "Demo"\n`,
      "look.css": `.demo { color: red }`,
      "icon.svg": `<svg xmlns="http://www.w3.org/2000/svg"/>`,
    });
    const r = await bundleMod(dir);
    if (!r.ok) throw new Error(r.why);
    expect(r.code).toContain("__kiwiMod");
    expect(r.code).toContain('"@kiwi/mod"');
    expect(r.code).toContain("react/jsx");
    expect(r.code).toContain("data:image/svg+xml;base64,");
    expect(r.code).toContain(".demo");
    expect(r.code).not.toContain("useState=function");
    expect(r.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a file outside its folder is refused, by path or through a symlink, so nothing local gets bundled in", async () => {
    const dir = mod({ "index.ts": `import secret from "../../secret.json"\nconsole.log(secret)\n` });
    writeFileSync(join(dir, "..", "..", "secret.json"), `{"key":"do not ship"}`);
    const byPath = await bundleMod(dir);
    expect(byPath.ok).toBe(false);
    if (!byPath.ok) expect(byPath.why).toContain("outside its folder");

    const linked = mod({ "index.ts": `import secret from "./secret.json"\nconsole.log(secret)\n` });
    writeFileSync(join(linked, "..", "..", "secret.json"), `{"key":"do not ship"}`);
    symlinkSync(join(linked, "..", "..", "secret.json"), join(linked, "secret.json"));
    const bySymlink = await bundleMod(linked);
    expect(bySymlink.ok).toBe(false);
    if (!bySymlink.ok) expect(bySymlink.why).toContain("outside its folder");
  });

  test("a package that isn't one the frame provides is refused, not looked up outside the folder", async () => {
    const r = await bundleMod(mod({ "index.ts": `import x from "zod"\nconsole.log(x)\n` }));
    expect(r.ok).toBe(false);
  });

  test("a file kind mods can't import, a mod with no entry, and code that doesn't parse say why", async () => {
    const wasm = await bundleMod(mod({ "index.ts": `import w from "./x.txt"\nconsole.log(w)\n`, "x.txt": "hi" }));
    expect(wasm).toEqual({ ok: false, why: "it imports x.txt, a kind of file mods can't import" });
    expect(await bundleMod(mod({ "readme.md": "hi" }))).toEqual({ ok: false, why: "it has no index.tsx" });
    const broken = await bundleMod(mod({ "index.tsx": "export const = <div" }));
    expect(broken.ok).toBe(false);
  });
});
