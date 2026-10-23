import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export function plainApp(releaseDir: string, tmp: string): string {
  const artifacts = join(releaseDir, "artifacts");
  const payloads = readdirSync(artifacts).filter((n) => n.endsWith(".app.tar.zst"));
  if (payloads.length !== 1) throw new Error(`expected one .app.tar.zst under ${artifacts}, found ${payloads.length}`);
  const tar = join(tmp, "app.tar");
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(join(artifacts, payloads[0]!))));
  const out = join(tmp, "plain");
  mkdirSync(out);
  execFileSync("tar", ["-xf", tar, "-C", out]);
  const apps = readdirSync(out).filter((n) => n.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`expected one .app in ${payloads[0]}, found ${apps.length}`);
  return join(out, apps[0]!);
}

if (import.meta.main) {
  const [dir, into] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: bun desktop/scripts/eb-plain.ts <release-eb folder> [into]  (prints the plain .app it unpacked from the stable .app.tar.zst)");
    process.exit(2);
  }
  const at = into ? resolve(into) : mkdtempSync(join(tmpdir(), "eb-plain-"));
  mkdirSync(at, { recursive: true });
  console.log(plainApp(resolve(dir), at));
}
