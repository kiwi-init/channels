import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.argv.includes("--help")) {
  console.log(`Where the app's first-load JS comes from: builds ui/ with source maps into a temp dir and splits the entry script and every chunk it modulepreloads by package and by module.

  bun scripts/bundle-why.ts [--top 40]`);
  process.exit(0);
}

interface SourceMap {
  sources: string[];
  mappings: string;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

function bytesBySource(code: string, map: SourceMap): Map<string, number> {
  const by = new Map<string, number>();
  const lines = code.split("\n");
  let source = 0;
  map.mappings.split(";").forEach((mapped, row) => {
    const line = lines[row] ?? "";
    let column = 0;
    const points: { column: number; source: number }[] = [];
    for (const segment of mapped.split(",").filter(Boolean).map(vlq)) {
      column += segment[0] ?? 0;
      if (segment.length > 1) source += segment[1] ?? 0;
      points.push({ column, source: segment.length > 1 ? source : -1 });
    }
    points.forEach((p, i) => {
      const name = p.source >= 0 ? (map.sources[p.source] ?? "?") : "(unmapped)";
      by.set(name, (by.get(name) ?? 0) + (points[i + 1]?.column ?? line.length) - p.column);
    });
  });
  return by;
}

const group = (source: string): { pkg: string; module: string } => {
  const pkg = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)/.exec(source);
  if (pkg) return { pkg: pkg[1]!, module: `${pkg[1]}/${pkg[2]}` };
  const kiwi = /packages\/([^/]+)\/src\/(.*)/.exec(source);
  if (kiwi) return { pkg: `@kiwi/${kiwi[1]}`, module: `${kiwi[1]}/${kiwi[2]}` };
  const ui = /ui\/src\/(.*)/.exec(source);
  if (ui) return { pkg: "ui", module: `ui/${ui[1]}` };
  return { pkg: "other", module: source.replace(/^(\.\.\/)+/, "") };
};

const at = process.argv.indexOf("--top");
const top = at > 0 ? Number(process.argv[at + 1]) : 40;
const root = resolve(import.meta.dir, "..");
const out = mkdtempSync(join(tmpdir(), "kiwi-bundle-why-"));
try {
  const built = spawnSync("bunx", ["vite", "build", "--sourcemap", "--outDir", out, "--emptyOutDir"], { cwd: join(root, "ui"), encoding: "utf8" });
  if (built.status !== 0) {
    console.error(built.stderr || built.stdout);
    process.exit(1);
  }
  const html = readFileSync(join(out, "index.html"), "utf8");
  const files = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g), ...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]!);
  const packages = new Map<string, number>();
  const modules = new Map<string, number>();
  let total = 0;
  for (const file of files) {
    const code = readFileSync(join(out, file), "utf8");
    total += Buffer.byteLength(code);
    const mapFile = join(out, `${file}.map`);
    if (!existsSync(mapFile)) {
      packages.set("(no source map)", (packages.get("(no source map)") ?? 0) + code.length);
      modules.set(file, (modules.get(file) ?? 0) + code.length);
      continue;
    }
    const map = JSON.parse(readFileSync(mapFile, "utf8")) as SourceMap;
    for (const [source, bytes] of bytesBySource(code, map)) {
      const { pkg, module } = group(source);
      packages.set(pkg, (packages.get(pkg) ?? 0) + bytes);
      modules.set(module, (modules.get(module) ?? 0) + bytes);
    }
  }
  const table = (m: Map<string, number>, n: number) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${String(v).padStart(9)}  ${k}`)
      .join("\n");
  console.log(`first-load JS: ${total} bytes in ${files.length} files\n\nby package:\n${table(packages, 15)}\n\nby module:\n${table(modules, top)}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
