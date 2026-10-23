import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MB = 1024 ** 2;

export const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)}MB`;

export function sizeOf(path: string): number {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

export function only(found: string[], what: string): string {
  if (found.length !== 1) throw new Error(`expected one ${what}, found ${found.length}`);
  return found[0] as string;
}

export interface StableBuild {
  wrapper: string;
  wrapperDmg: string;
  payload: string;
}

export function stableBuild(releaseEb: string): StableBuild {
  const builds = join(releaseEb, "build");
  const artifacts = join(releaseEb, "artifacts");
  const wrapper = only(
    readdirSync(builds)
      .filter((name) => name.startsWith("stable-macos-"))
      .flatMap((name) =>
        readdirSync(join(builds, name))
          .filter((n) => n.endsWith(".app"))
          .map((app) => join(builds, name, app)),
      ),
    `stable Mac .app under ${builds}`,
  );
  const listed = readdirSync(artifacts);
  const wrapperDmg = only(
    listed.filter((n) => n.endsWith(".dmg")).map((n) => join(artifacts, n)),
    `.dmg under ${artifacts}`,
  );
  const payload = only(
    listed.filter((n) => n.endsWith(".app.tar.zst")).map((n) => join(artifacts, n)),
    `.app.tar.zst under ${artifacts}`,
  );
  return { wrapper, wrapperDmg, payload };
}

export function unpackApp(payload: string, into: string): string {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const tar = join(into, ".app.tar");
  writeFileSync(tar, Bun.zstdDecompressSync(readFileSync(payload)));
  execFileSync("tar", ["-xf", tar, "-C", into]);
  rmSync(tar);
  return only(
    readdirSync(into)
      .filter((n) => n.endsWith(".app"))
      .map((n) => join(into, n)),
    `.app in ${payload}`,
  );
}
