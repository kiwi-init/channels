import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Step = { quality: number } & ({ longest: number } | { share: number });

type Tool = { kind: "sips"; bin: string } | { kind: "magick"; bin: string[] };

let found: Tool | null | undefined;

function tool(): Tool | null {
  if (found !== undefined) return found;
  const sips = process.platform === "darwin" ? Bun.which("sips") : null;
  const magick = Bun.which("magick");
  const convert = Bun.which("convert");
  found = sips ? { kind: "sips", bin: sips } : magick ? { kind: "magick", bin: [magick] } : convert ? { kind: "magick", bin: [convert] } : null;
  return found;
}

export const canShrink = (): boolean => tool() !== null;

const run = (cmd: string[]): string | null => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", timeout: 30_000 });
  return r.status === 0 ? r.stdout : null;
};

function longestSide(t: Tool, path: string): number | null {
  if (t.kind === "sips") {
    const out = run([t.bin, "-g", "pixelWidth", "-g", "pixelHeight", path]);
    const sides = [...(out ?? "").matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1]));
    return sides.length === 2 ? Math.max(...sides) : null;
  }
  const out = run([...t.bin, `${path}[0]`, "-format", "%w %h", "info:"]);
  const sides = (out ?? "").trim().split(" ").map(Number);
  return sides.length === 2 && sides.every((n) => n > 0) ? Math.max(...sides) : null;
}

function encode(t: Tool, path: string, out: string, longest: number, quality: number): boolean {
  const cmd =
    t.kind === "sips"
      ? [t.bin, "-s", "format", "jpeg", "-s", "formatOptions", String(quality), "-Z", String(longest), path, "--out", out]
      : [...t.bin, `${path}[0]`, "-resize", `${longest}x${longest}>`, "-quality", String(quality), out];
  return run(cmd) !== null;
}

export function shrinkToJpeg(path: string, limit: number, steps: readonly Step[]): Buffer | null {
  const t = tool();
  if (!t) return null;
  const side = longestSide(t, path);
  if (!side) return null;
  const dir = mkdtempSync(join(tmpdir(), "kiwi-shrink-"));
  try {
    for (const [i, step] of steps.entries()) {
      const out = join(dir, `${i}.jpg`);
      const longest = Math.max(1, Math.min(side, Math.round("share" in step ? side * step.share : step.longest)));
      if (!encode(t, path, out, longest, step.quality)) return null;
      const bytes = readFileSync(out);
      if (bytes.length <= limit) return bytes;
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
