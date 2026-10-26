import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const core = join(root, "packages/core");
const ts = new Bun.Transpiler({ loader: "ts" });
const tsx = new Bun.Transpiler({ loader: "tsx" });

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === "dist") return [];
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

function imports(file: string): string[] {
  return (file.endsWith(".tsx") ? tsx : ts).scanImports(readFileSync(file, "utf8").replace(/^#!.*/, "")).map((i) => i.path);
}

describe("packages/core (@kiwi/core)", () => {
  test("imports nothing outside the package but effect, and node: only under src/node", () => {
    const bad: string[] = [];
    for (const f of sources(join(core, "src"))) {
      const rel = relative(core, f);
      const nodeOnly = rel.startsWith("src/node/");
      for (const spec of imports(f)) {
        if (spec.startsWith(".")) {
          if (relative(core, resolve(dirname(f), spec)).startsWith("..")) bad.push(`${rel}: ${spec}`);
        } else if (spec.startsWith("node:")) {
          if (!nodeOnly) bad.push(`${rel}: ${spec}`);
        } else if (!spec.startsWith("effect/")) bad.push(`${rel}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("its browser part uses no Node or Bun globals", () => {
    const bad = sources(join(core, "src"))
      .filter((f) => !relative(core, f).startsWith("src/node/"))
      .filter((f) => /\b(Bun|process|Buffer|require|__dirname)\s*[.(]/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f));
    expect(bad).toEqual([]);
  });

  test("web/src never imports its Node-only modules", () => {
    const bad = sources(join(root, "web/src"))
      .filter((f) => imports(f).some((spec) => spec.startsWith("@kiwi/core/node/")))
      .map((f) => relative(root, f));
    expect(bad).toEqual([]);
  });

  test("everything else reaches it by package name, never by a relative path", () => {
    const bad: string[] = [];
    for (const dir of ["src", "test", "scripts", "web/src", "desktop/src", "desktop/scripts"])
      for (const f of sources(join(root, dir))) for (const spec of imports(f)) if (spec.startsWith(".") && resolve(dirname(f), spec).startsWith(core + "/")) bad.push(`${relative(root, f)}: ${spec}`);
    expect(bad).toEqual([]);
  });
});
