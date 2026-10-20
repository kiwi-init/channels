import { statSync } from "node:fs";
import { delimiter } from "node:path";
import { KNOWN_HARNESSES, type HarnessRow, type KnownHarness } from "@kiwi/core/harnesses.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { viaOf, wakePath, wakeWords } from "@kiwi/core/wake.ts";
import { REWAKE_SINCE } from "../hooks/install/claude.ts";
import { loginPath } from "./shell.ts";

interface Binary {
  bin: string;
  not?: RegExp;
}

const BINARIES: Record<KnownHarness, readonly Binary[]> = {
  claude: [{ bin: "claude" }],
  codex: [{ bin: "codex" }],
  gemini: [{ bin: "gemini" }],
  cursor: [{ bin: "cursor-agent" }, { bin: "agent", not: /grok/i }],
  grok: [{ bin: "grok" }],
  opencode: [{ bin: "opencode" }],
  kimi: [{ bin: "kimi" }, { bin: "kimi-code" }],
  mimo: [{ bin: "mimo" }],
  pi: [{ bin: "pi" }],
};

const VERSION_MS = 5_000;

const said = new Map<string, Promise<string | null>>();

export function versionIn(text: string): string | null {
  return /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?/.exec(text)?.[0] ?? null;
}

async function runVersion(path: string, PATH: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const child = Bun.spawn([path, "--version"], { env: { ...process.env, PATH }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const text = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([out, err]) => `${out}\n${err}`.trim());
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, VERSION_MS);
    });
    return await Promise.race([text, late]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function versionText(path: string, PATH: string): Promise<string | null> {
  const st = statSync(path, { throwIfNoEntry: false });
  const key = `${path}\u0000${st?.ino}\u0000${st?.mtimeMs}\u0000${st?.size}`;
  const known = said.get(key);
  if (known) return known;
  const asked = runVersion(path, PATH).then((text) => {
    if (text === null) said.delete(key);
    return text;
  });
  said.set(key, asked);
  return asked;
}

function everyOnPath(bin: string, PATH: string): string[] {
  const found = PATH.split(delimiter).map((dir) => (dir ? Bun.which(bin, { PATH: dir }) : null));
  return [...new Set(found.filter((p): p is string => !!p))];
}

async function binaryOf(harness: KnownHarness, PATH: string): Promise<{ path: string; text: string | null } | null> {
  for (const { bin, not } of BINARIES[harness]) {
    if (!not) {
      const path = Bun.which(bin, { PATH });
      if (path) return { path, text: await versionText(path, PATH) };
      continue;
    }
    for (const path of everyOnPath(bin, PATH)) {
      const text = await versionText(path, PATH);
      if (text !== null && !not.test(text)) return { path, text };
    }
  }
  return null;
}

export function wakeOf(harness: KnownHarness, version: string | null): Pick<HarnessRow, "wake" | "why"> {
  const since = REWAKE_SINCE.join(".");
  if (harness === "claude" && version && compareVersions(version, since) < 0) return { wake: null, why: `Claude Code ${version} is older than ${since}, the first Kiwi can wake` };
  const path = wakePath({ harness, session: "new" }, true, false, { pi: true, mimo: true });
  const via = viaOf(path);
  return { wake: via, why: path.kind === "none" ? path.why : null };
}

export async function harnessInventory(PATH?: string): Promise<HarnessRow[]> {
  const dirs = PATH ?? (await loginPath());
  return Promise.all(
    KNOWN_HARNESSES.map(async (harness): Promise<HarnessRow> => {
      const found = await binaryOf(harness, dirs);
      const version = found?.text ? versionIn(found.text) : null;
      return { harness, path: found?.path ?? null, version, ...wakeOf(harness, version) };
    }),
  );
}

export function inventoryText(rows: HarnessRow[]): string {
  return rows
    .map((r) => {
      if (!r.path) return `${r.harness}: not installed`;
      const wake = r.wake ? `Kiwi wakes it via ${wakeWords(r.wake)}` : `Kiwi can't wake it: ${r.why ?? "no way known"}`;
      return `${r.harness}: ${r.version ?? "version unknown"} at ${r.path}; ${wake}`;
    })
    .join("\n");
}
