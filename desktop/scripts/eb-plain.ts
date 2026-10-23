import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
