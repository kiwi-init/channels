import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import pinned from "../electrobun-pins.json" with { type: "json" };

export interface HutchPin {
  url: string;
  size: number;
  sha256: string;
  files: Record<string, string>;
}

export interface ArchiveTreePin {
  url: string;
  keep: string;
  tree: string;
}

export interface Pins {
  electrobun: string;
  releasesBaseUrl: string;
  hutch: { version: string; platforms: Record<string, HutchPin> };
  devkit: Record<string, string>;
  nativeWrapper: { source: ArchiveTreePin; cef: ArchiveTreePin; dawn: ArchiveTreePin };
  app: Record<string, Record<string, string>>;
}

export const PINS: Pins = pinned;

export function hostKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === "darwin" ? "macos" : platform === "linux" ? "linux" : null;
  if (!os || (arch !== "arm64" && arch !== "x64")) throw new Error(`Electrobun doesn't build on ${platform}-${arch}`);
  return `${os}-${arch}`;
}

export function pinFor<T>(table: Record<string, T>, key: string, what: string): T {
  const v = table[key];
  if (v === undefined) throw new Error(`desktop/electrobun-pins.json pins no ${what} for ${key}`);
  return v;
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const fileSha256 = (file: string): string => sha256(fs.readFileSync(file));

export function treeSha256(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string): void => {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) lines.push(`${r}\0${fileSha256(path.join(dir, r))}`);
      else throw new Error(`${r} in ${dir} is neither a file nor a folder`);
    }
  };
  walk("");
  return sha256(new TextEncoder().encode(lines.sort().join("\n")));
}

export function mismatches(root: string, files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([rel, want]) => {
    let got: string;
    try {
      got = fileSha256(path.join(root, rel));
    } catch {
      // A pinned file that isn't there is a mismatch like any other.
      return [`${rel}: missing`];
    }
    return got === want ? [] : [`${rel}: ${got}, pinned ${want}`];
  });
}
