import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sealApp } from "./eb-seal.ts";

export function only(found: string[], what: string): string {
  if (found.length !== 1) throw new Error(`expected one ${what}, found ${found.length}`);
  return found[0] as string;
}

export function payloadOf(artifacts: string): string {
  return only(
    readdirSync(artifacts)
      .filter((name) => name.endsWith(".app.tar.zst"))
      .map((name) => join(artifacts, name)),
    `.app.tar.zst under ${artifacts}`,
  );
}

function plainApp(payload: string, into: string): string {
  const tar = join(into, "app.tar");
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(payload)));
  const unpacked = join(into, "app");
  mkdirSync(unpacked);
  execFileSync("tar", ["-xf", tar, "-C", unpacked]);
  return only(
    readdirSync(unpacked)
      .filter((n) => n.endsWith(".app"))
      .map((n) => join(unpacked, n)),
    `.app in ${payload}`,
  );
}

export function shippedApp(payload: string, into: string): string {
  const app = plainApp(payload, into);
  sealApp(app);
  return app;
}
