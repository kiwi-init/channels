import { basename } from "node:path";
import type { PlaceRequest, Placed, PlaceTools, TerminalPlugin } from "../plugin.ts";
import { pairs, quote } from "../shared/launch.ts";
import { run, said } from "../shared/run.ts";
import { appManifest } from "./manifest.ts";

export function terminalLine(shell: string, req: PlaceRequest): string {
  const fish = basename(shell) === "fish";
  const env = pairs(req.env ?? {});
  return `cd ${quote(req.folder, fish)} && exec ${[...(env.length ? ["env", ...env] : []), ...req.argv].map((word) => quote(word, fish)).join(" ")}`;
}

const DO_SCRIPT = [
  "on run argv",
  'set started to not (application "Terminal" is running)',
  'tell application "Terminal"',
  "if started then",
  "repeat 50 times",
  "if (count of windows) > 0 then exit repeat",
  "delay 0.1",
  "end repeat",
  "if (count of windows) > 0 then return do script (item 1 of argv) in window 1",
  "end if",
  "return do script (item 1 of argv)",
  "end tell",
  "end run",
];

async function openTerminal(t: PlaceTools & { osascript: string }, req: PlaceRequest): Promise<Placed> {
  const r = await run([t.osascript, ...DO_SCRIPT.flatMap((line) => ["-e", line]), terminalLine(t.shell, req)], 120_000);
  if (r.status === 0) {
    const window = Number(/window id (\d+)/.exec(r.stdout)?.[1]);
    return { ok: true, place: "terminal", ...(window > 0 ? { window } : {}) };
  }
  if (r.stderr.includes("-1743")) return { ok: false, why: "not-allowed", detail: "Allow control of Terminal in System Settings → Privacy & Security → Automation" };
  return { ok: false, why: "failed", detail: `Terminal: ${said(r)}` };
}

export function appTerminal(t: PlaceTools): TerminalPlugin {
  const ready = t.platform === "darwin" && !!t.osascript;
  return {
    manifest: appManifest,
    detect: async () => ({ found: ready, running: ready }),
    open: async (req) => (ready && t.osascript ? openTerminal({ ...t, osascript: t.osascript }, req) : { ok: false, why: "no-place", detail: "Terminal opens only on a Mac" }),
  };
}
