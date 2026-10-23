import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

const src = join(import.meta.dir, "../desktop/src");
const transpiler = new Bun.Transpiler({ loader: "ts" });

function walk(entry: string): { files: number; electron: string[] | null } {
  const seen = new Set<string>();
  const visit = (file: string, trail: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path === "electron" || path.startsWith("electron/")) return [...trail, file, path];
      if (path.startsWith("node:") || path.startsWith("bun:")) continue;
      const next = Bun.resolveSync(path, dirname(file));
      if (!isAbsolute(next) || next.includes("/node_modules/")) continue;
      const found = visit(next, [...trail, file]);
      if (found) return found;
    }
    return null;
  };
  const electron = visit(join(src, entry), []);
  return { files: seen.size, electron: electron?.map((f) => f.replace(`${src}/`, "")) ?? null };
}

test("the modules both shells share never reach electron, however deep the import", () => {
  for (const entry of ["ipc/handlers.ts", "calls.ts", "host.ts", "store.ts", "updater.ts", "bundled-daemon.ts", "deep-links.ts", "main-log.ts", "signin.ts"]) {
    expect({ entry, electron: walk(entry).electron }).toEqual({ entry, electron: null });
  }
  expect(walk("ipc/handlers.ts").files).toBeGreaterThan(30);
});

test("the walk does find electron where it is: the Electron shell's own modules", () => {
  expect(walk("electron-host.ts").electron).toEqual(["electron-host.ts", "electron"]);
  expect(walk("main.ts").electron).toEqual(["main.ts", "electron"]);
});
