import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const MOD_GLOBALS = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "@kiwi/mod"] as const;

const ENTRIES = ["index.tsx", "index.ts", "index.jsx", "index.js"];

const MAX_BYTES = 4_000_000;

const CODE: Record<string, "tsx" | "ts" | "jsx" | "js" | "json"> = { ".tsx": "tsx", ".ts": "ts", ".mts": "ts", ".jsx": "jsx", ".js": "js", ".mjs": "js", ".json": "json" };

const DATA: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export type ModBundle = { ok: true; code: string; hash: string } | { ok: false; why: string };

const inside = (file: string, dir: string): boolean => file === dir || file.startsWith(dir + path.sep);

const globalPattern = new RegExp(`^(?:${MOD_GLOBALS.map((g) => g.replace(/[/.@-]/g, (c) => `\\${c}`)).join("|")})$`);

export async function bundleMod(folder: string): Promise<ModBundle> {
  let dir: string;
  try {
    dir = realpathSync(folder);
  } catch {
    return { ok: false, why: "its folder can't be read" };
  }
  const entry = ENTRIES.map((f) => path.join(dir, f)).find((f) => existsSync(f));
  if (!entry) return { ok: false, why: "it has no index.tsx" };
  let built: Awaited<ReturnType<typeof Bun.build>>;
  try {
    built = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      format: "iife",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      throw: false,
      plugins: [
        {
          name: "kiwi-mod",
          setup(b) {
            b.onResolve({ filter: globalPattern }, (a) => ({ path: a.path, namespace: "kiwi-mod-global" }));
            b.onLoad({ filter: /.*/, namespace: "kiwi-mod-global" }, (a) => ({ contents: `module.exports = globalThis.__kiwiMod[${JSON.stringify(a.path)}];`, loader: "js" }));
            b.onLoad({ filter: /.*/, namespace: "file" }, (a) => {
              const real = realpathSync(a.path);
              if (!inside(real, dir)) throw new Error(`it imports ${a.path}, which is outside its folder`);
              const ext = path.extname(real).toLowerCase();
              const loader = CODE[ext];
              if (loader) return { contents: readFileSync(real, "utf8"), loader };
              if (ext === ".css") return { contents: `{const s=document.createElement("style");s.textContent=${JSON.stringify(readFileSync(real, "utf8"))};document.head.append(s)}`, loader: "js" };
              const type = DATA[ext];
              if (type) return { contents: `export default ${JSON.stringify(`data:${type};base64,${readFileSync(real).toString("base64")}`)};`, loader: "js" };
              throw new Error(`it imports ${path.relative(dir, real)}, a kind of file mods can't import`);
            });
          },
        },
      ],
    });
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
  if (!built.success) {
    const first = built.logs.find((l) => l.level === "error") ?? built.logs[0];
    return { ok: false, why: first ? String(first.message ?? first) : "it didn't build" };
  }
  const out = built.outputs.find((o) => o.kind === "entry-point");
  if (!out) return { ok: false, why: "it didn't build" };
  const code = await out.text();
  if (code.length > MAX_BYTES) return { ok: false, why: `it builds to ${(code.length / 1_000_000).toFixed(1)} MB, over the ${MAX_BYTES / 1_000_000} MB a mod may be` };
  return { ok: true, code, hash: createHash("sha256").update(code).digest("hex").slice(0, 16) };
}
